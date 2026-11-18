import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { getDb, SAMPLE_SEED_PRODUCTS } from './db';
import {
  buildSignedQrPayload,
  createClientFingerprint,
  generateQrId,
  generateSecureToken,
  generateUid,
  hashForAudit,
  parseSignedQrPayload,
  signAdminSession,
  timingSafeEqualStrings,
  verifyAdminSession,
  verifyQrHmac
} from './crypto';
import { evaluateDuplicateActivity } from './duplicateDetection';
import { SlidingWindowLimiter } from './rateLimit';
import { runIsolatedBackendTestSuite } from './testHarness';

const COOKIE_ADMIN = 'smartqr_admin';
const COOKIE_VERIFY_SESSION = 'smartqr_sid';
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    result[key] = val;
  }
  return result;
}

function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

function getClientFingerprint(req: Request): string {
  const ip = getClientIp(req);
  const ua = String(req.headers['user-agent'] || 'unknown');
  return createClientFingerprint(ip, ua);
}

function setCookie(
  req: Request,
  res: Response,
  name: string,
  value: string,
  maxAgeMs: number
): void {
  const isHttps =
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https' ||
    process.env.NODE_ENV === 'production';

  const flags = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    isHttps ? 'SameSite=None' : 'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`
  ];
  if (isHttps) {
    flags.push('Secure');
  }

  const existing = res.getHeader('Set-Cookie');
  const nextCookie = flags.join('; ');
  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, nextCookie]);
  } else if (typeof existing === 'string') {
    res.setHeader('Set-Cookie', [existing, nextCookie]);
  } else {
    res.setHeader('Set-Cookie', nextCookie);
  }
}

function clearCookie(req: Request, res: Response, name: string): void {
  const isHttps =
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https' ||
    process.env.NODE_ENV === 'production';
  const existing = res.getHeader('Set-Cookie');
  const cleared = `${name}=; Path=/; HttpOnly; ${isHttps ? 'SameSite=None; Secure; ' : 'SameSite=Lax; '}Max-Age=0`;
  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cleared]);
  } else if (typeof existing === 'string') {
    res.setHeader('Set-Cookie', [existing, cleared]);
  } else {
    res.setHeader('Set-Cookie', cleared);
  }
}

export function createApiRouter(customDbPath?: string): express.Router {
  const router = express.Router();
  const db = getDb(customDbPath);

  // Rate limiters
  const qrValidateLimiter = new SlidingWindowLimiter({
    windowMs: 60 * 1000,
    maxRequests: 40,
    message: 'Too many QR validation requests. Please wait before trying again.'
  });

  const batchSubmitLimiter = new SlidingWindowLimiter({
    windowMs: 60 * 1000,
    maxRequests: 20,
    message: 'Too many batch verification attempts. Please wait before trying again.'
  });

  const postLockoutSessionLimiter = new SlidingWindowLimiter({
    windowMs: 10 * 60 * 1000,
    maxRequests: 2,
    message: 'New verification sessions are temporarily rate-limited following repeated failed attempts.'
  });

  const loginLimiter = new SlidingWindowLimiter({
    windowMs: 15 * 60 * 1000,
    maxRequests: 15,
    message: 'Too many login attempts. Please try again later.'
  });

  const extractAdminToken = (req: Request): string | undefined => {
    const cookies = parseCookies(req);
    const bearer = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7).trim()
      : undefined;
    if (bearer && verifyAdminSession(bearer).valid) return bearer;
    return cookies[COOKIE_ADMIN] || bearer;
  };

  // Admin auth middleware
  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    const token = extractAdminToken(req);
    const verified = verifyAdminSession(token);
    if (!verified.valid) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Admin authentication is required for this operation.'
      });
      return;
    }
    (req as Request & { adminUser?: string }).adminUser = verified.username;
    next();
  };

  // Bridge auth middleware (accepts Admin session token OR server-configured BRIDGE_API_TOKEN)
  const requireAdminOrBridge = (req: Request, res: Response, next: NextFunction) => {
    const bearer = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7).trim()
      : undefined;
    const bridgeToken = process.env.BRIDGE_API_TOKEN?.trim();
    if (bridgeToken && bearer && timingSafeEqualStrings(bearer, bridgeToken)) {
      (req as Request & { adminUser?: string }).adminUser = 'ESP32-Bridge';
      next();
      return;
    }
    requireAdmin(req, res, next);
  };

  // --- HEALTH ---
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // --- ADMIN AUTH ---
  router.get('/auth/me', (req, res) => {
    const verified = verifyAdminSession(extractAdminToken(req));
    res.json({
      authenticated: verified.valid,
      username: verified.username || null
    });
  });

  router.post('/auth/login', loginLimiter.middleware(), (req, res) => {
    const { username, password } = req.body || {};
    const expectedUser = process.env.ADMIN_USERNAME || 'admin';
    const expectedPass = process.env.ADMIN_PASSWORD || 'admin123';

    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      !timingSafeEqualStrings(username.trim(), expectedUser) ||
      !timingSafeEqualStrings(password, expectedPass)
    ) {
      res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid administrator username or password.'
      });
      return;
    }

    const token = signAdminSession(expectedUser);
    setCookie(req, res, COOKIE_ADMIN, token, 12 * 60 * 60 * 1000);
    res.json({
      authenticated: true,
      username: expectedUser,
      token
    });
  });

  router.post('/auth/logout', (req, res) => {
    clearCookie(req, res, COOKIE_ADMIN);
    res.json({ authenticated: false });
  });

  // --- PUBLIC TWO-STAGE VERIFICATION ---

  // Stage 1: Validate QR signature, registration, and active status.
  // Does NOT count as a batch verification attempt and NEVER returns batchNumber or manufacturingDate.
  router.post('/verify/validate-qr', qrValidateLimiter.middleware(), (req, res) => {
    const rawPayload = typeof req.body?.rawPayload === 'string' ? req.body.rawPayload.trim() : '';
    const rawScanEventId = typeof req.body?.scanEventId === 'string' ? req.body.scanEventId.trim() : '';
    const scanEventId = rawScanEventId ? rawScanEventId.slice(0, 128) : '';
    const fp = getClientFingerprint(req);
    const nowIso = new Date().toISOString();

    const recordSecurityEvent = (
      eventType:
        | 'UNRECOGNIZED_QR'
        | 'INVALID_SIGNATURE'
        | 'MODIFIED_PAYLOAD'
        | 'REVOKED_QR'
        | 'RATE_LIMITED'
        | 'SESSION_ABUSE',
      details: string,
      qrIdAttempted?: string
    ) => {
      db.prepare(
        `INSERT INTO security_events (event_uid, event_type, qr_id_attempted, payload_hash, details, client_fingerprint, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        generateUid('SEC'),
        eventType,
        qrIdAttempted || null,
        hashForAudit(rawPayload),
        details,
        fp,
        nowIso
      );
    };

    if (!rawPayload) {
      recordSecurityEvent('UNRECOGNIZED_QR', 'Empty QR payload submitted.');
      res.json({
        status: 'UNRECOGNIZED_QR',
        title: 'NOT MANUFACTURED BY US',
        message: 'This QR code is not registered in our product database. Not manufactured by us.'
      });
      return;
    }

    const parsed = parseSignedQrPayload(rawPayload);
    if (!parsed.validFormat || !parsed.qrId || !parsed.productUniqueId || !parsed.tokenNonce || !parsed.hmacSignature) {
      recordSecurityEvent('UNRECOGNIZED_QR', 'QR payload does not match signed SmartQR format.');
      res.json({
        status: 'UNRECOGNIZED_QR',
        title: 'NOT MANUFACTURED BY US',
        message: 'This QR code is not registered in our product database. Not manufactured by us.'
      });
      return;
    }

    const qrRow = db
      .prepare(
        `SELECT q.qr_id, q.product_id, q.token_nonce, q.hmac_signature, q.status,
                p.product_unique_id
         FROM qr_codes q
         JOIN products p ON p.id = q.product_id
         WHERE q.qr_id = ?`
      )
      .get(parsed.qrId) as
      | {
          qr_id: string;
          product_id: number;
          token_nonce: string;
          hmac_signature: string;
          status: 'active' | 'revoked';
          product_unique_id: string;
        }
      | undefined;

    if (!qrRow) {
      recordSecurityEvent(
        'UNRECOGNIZED_QR',
        `QR ID ${parsed.qrId} is not registered in the database.`,
        parsed.qrId
      );
      res.json({
        status: 'UNRECOGNIZED_QR',
        title: 'NOT MANUFACTURED BY US',
        message: 'This QR code is not registered in our product database. Not manufactured by us.'
      });
      return;
    }

    // Check payload fields against registered QR + timing-safe HMAC check
    const sigValid =
      parsed.productUniqueId === qrRow.product_unique_id &&
      parsed.tokenNonce === qrRow.token_nonce &&
      timingSafeEqualStrings(parsed.hmacSignature, qrRow.hmac_signature) &&
      verifyQrHmac(qrRow.qr_id, qrRow.product_unique_id, qrRow.token_nonce, parsed.hmacSignature);

    if (!sigValid) {
      const payloadChanged =
        parsed.productUniqueId !== qrRow.product_unique_id ||
        parsed.tokenNonce !== qrRow.token_nonce;
      recordSecurityEvent(
        payloadChanged ? 'MODIFIED_PAYLOAD' : 'INVALID_SIGNATURE',
        payloadChanged
          ? `Modified QR payload fields detected for QR ${qrRow.qr_id}.`
          : `Invalid HMAC signature for QR ${qrRow.qr_id}.`,
        qrRow.qr_id
      );
      res.json({
        status: 'UNRECOGNIZED_QR',
        title: 'NOT MANUFACTURED BY US',
        message: 'This QR code failed cryptographic verification and could not be matched to our records. Not manufactured by us.'
      });
      return;
    }

    if (qrRow.status === 'revoked') {
      recordSecurityEvent(
        'REVOKED_QR',
        `Attempted scan of revoked QR code ${qrRow.qr_id}.`,
        qrRow.qr_id
      );
      res.json({
        status: 'REVOKED_QR',
        qrId: qrRow.qr_id,
        productUniqueId: qrRow.product_unique_id,
        title: 'QR CODE REVOKED / INACTIVE',
        message: 'This QR code has been revoked by the manufacturer and is no longer active for verification.'
      });
      return;
    }

    const cookies = parseCookies(req);
    const cookieSid = cookies[COOKIE_VERIFY_SESSION];

    const txResult = db.transaction(() => {
      // Idempotency check: prevent accidental duplicate logging from React rerenders or repeated API requests for the same scan event
      if (scanEventId) {
        const dupScan = db
          .prepare(
            `SELECT id, product_unique_id, qr_id, scanned_at, session_id, scan_result
             FROM qr_scan_history
             WHERE scan_event_id = ?`
          )
          .get(scanEventId) as
          | {
              id: number;
              product_unique_id: string;
              qr_id: string | null;
              scanned_at: string;
              session_id: string;
              scan_result: string;
            }
          | undefined;

        if (dupScan) {
          const dupSession = db
            .prepare(
              `SELECT session_token, qr_id, attempt_count, max_attempts, status, expires_at, locked_until
               FROM verification_sessions
               WHERE session_token = ?`
            )
            .get(dupScan.session_id) as
            | {
                session_token: string;
                qr_id: string;
                attempt_count: number;
                max_attempts: number;
                status: 'active' | 'successful' | 'locked' | 'expired';
                expires_at: string;
                locked_until: string | null;
              }
            | undefined;

          const previousScans = db
            .prepare(
              `SELECT id, product_unique_id as productUniqueId, qr_id as qrId,
                      scanned_at as scannedAt, session_id as sessionId, scan_result as scanResult
               FROM qr_scan_history
               WHERE product_unique_id = ? AND id < ?
               ORDER BY id ASC`
            )
            .all(dupScan.product_unique_id, dupScan.id);

          const isLockedDup = dupSession?.status === 'locked';
          return {
            httpStatus: 200,
            sessionTokenToCookie: dupSession?.session_token,
            body: {
              status: isLockedDup ? 'LOCKED' : 'BATCH_REQUIRED',
              title: isLockedDup
                ? 'BATCH VERIFICATION TEMPORARILY LOCKED'
                : 'QR CODE VALIDATED',
              message: isLockedDup
                ? 'Maximum incorrect batch-number attempts reached. This verification session is temporarily locked.'
                : 'Enter the batch number to check whether your product is genuine or fake.',
              qrId: qrRow.qr_id,
              productUniqueId: qrRow.product_unique_id,
              sessionToken: dupSession?.session_token || dupScan.session_id,
              attemptCount: dupSession?.attempt_count ?? 0,
              maxAttempts: dupSession?.max_attempts ?? 3,
              attemptsRemaining: isLockedDup
                ? 0
                : Math.max(0, (dupSession?.max_attempts ?? 3) - (dupSession?.attempt_count ?? 0)),
              lockedUntil: dupSession?.locked_until || null,
              expiresAt: dupSession?.expires_at,
              currentScanId: dupScan.id,
              previousScanCount: previousScans.length,
              hasPreviousScans: previousScans.length > 0,
              previousScans,
              deduplicated: true
            }
          };
        }
      }

      // Expire stale active sessions
      db.prepare(
        `UPDATE verification_sessions
         SET status = 'expired'
         WHERE status = 'active' AND expires_at <= ?`
      ).run(nowIso);

      // Check for an existing persistent active or locked session for this QR (via cookie or client fingerprint)
      let existingSession:
        | {
            session_token: string;
            qr_id: string;
            attempt_count: number;
            max_attempts: number;
            status: 'active' | 'successful' | 'locked' | 'expired';
            expires_at: string;
            locked_until: string | null;
          }
        | undefined;

      if (cookieSid) {
        existingSession = db
          .prepare(
            `SELECT session_token, qr_id, attempt_count, max_attempts, status, expires_at, locked_until
             FROM verification_sessions
             WHERE session_token = ? AND qr_id = ? AND status IN ('active', 'locked')`
          )
          .get(cookieSid, qrRow.qr_id) as typeof existingSession;
      }

      if (!existingSession) {
        existingSession = db
          .prepare(
            `SELECT session_token, qr_id, attempt_count, max_attempts, status, expires_at, locked_until
             FROM verification_sessions
             WHERE qr_id = ? AND client_fingerprint = ? AND status IN ('active', 'locked')
             ORDER BY id DESC LIMIT 1`
          )
          .get(qrRow.qr_id, fp) as typeof existingSession;
      }

      let resolvedSessionToken: string;
      let resolvedAttemptCount = 0;
      let resolvedMaxAttempts = 3;
      let resolvedStatus: 'active' | 'locked' = 'active';
      let resolvedExpiresAt: string;
      let resolvedLockedUntil: string | null = null;

      if (existingSession) {
        if (existingSession.status === 'locked') {
          const lockActive =
            existingSession.locked_until && existingSession.locked_until > nowIso;
          if (lockActive) {
            resolvedSessionToken = existingSession.session_token;
            resolvedAttemptCount = existingSession.attempt_count;
            resolvedMaxAttempts = existingSession.max_attempts;
            resolvedStatus = 'locked';
            resolvedExpiresAt = existingSession.expires_at;
            resolvedLockedUntil = existingSession.locked_until;
          } else {
            // Lockout window elapsed; mark old locked session expired before issuing rate-limited new session
            db.prepare(`UPDATE verification_sessions SET status = 'expired' WHERE session_token = ?`).run(
              existingSession.session_token
            );
            existingSession = undefined;
          }
        } else if (existingSession.status === 'active') {
          resolvedSessionToken = existingSession.session_token;
          resolvedAttemptCount = existingSession.attempt_count;
          resolvedMaxAttempts = existingSession.max_attempts;
          resolvedStatus = 'active';
          resolvedExpiresAt = existingSession.expires_at;
        }
      }

      if (!existingSession) {
        // If this client/QR had a recent locked session, enforce post-lockout session creation rate limiting
        const recentLockCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const priorLock = db
          .prepare(
            `SELECT COUNT(*) as cnt FROM verification_sessions
             WHERE qr_id = ? AND client_fingerprint = ? AND created_at >= ? AND attempt_count >= max_attempts`
          )
          .get(qrRow.qr_id, fp, recentLockCutoff) as { cnt: number };

        if (priorLock.cnt > 0) {
          const rateRes = postLockoutSessionLimiter.check(`${fp}:${qrRow.qr_id}`);
          if (!rateRes.allowed) {
            recordSecurityEvent(
              'RATE_LIMITED',
              `Post-lockout new session creation rate-limited for QR ${qrRow.qr_id}.`,
              qrRow.qr_id
            );
            return {
              httpStatus: 429,
              retryAfterSec: rateRes.retryAfterSec,
              body: {
                status: 'RATE_LIMITED',
                error: 'RATE_LIMITED',
                title: 'TOO MANY VERIFICATION ATTEMPTS',
                message:
                  'New verification sessions for this QR code are temporarily restricted due to prior lockouts. Please try again later.',
                retryAfterSec: rateRes.retryAfterSec
              }
            };
          }
        }

        resolvedSessionToken = generateSecureToken(32);
        resolvedExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

        db.prepare(
          `INSERT INTO verification_sessions
           (session_token, qr_id, product_id, attempt_count, max_attempts, status, client_fingerprint, created_at, expires_at)
           VALUES (?, ?, ?, 0, 3, 'active', ?, ?, ?)`
        ).run(resolvedSessionToken, qrRow.qr_id, qrRow.product_id, fp, nowIso, resolvedExpiresAt);
      }

      // Immediately record every registered QR scan in qr_scan_history (UTC timestamp)
      const initialScanResult = resolvedStatus === 'locked' ? 'LOCKED' : 'SCANNED';
      const scanInsert = db
        .prepare(
          `INSERT INTO qr_scan_history
           (product_unique_id, qr_id, scanned_at, session_id, scan_result, scan_event_id, client_fingerprint)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          qrRow.product_unique_id,
          qrRow.qr_id,
          nowIso,
          resolvedSessionToken!,
          initialScanResult,
          scanEventId || null,
          fp
        );

      const currentScanId = Number(scanInsert.lastInsertRowid);

      const previousScans = db
        .prepare(
          `SELECT id, product_unique_id as productUniqueId, qr_id as qrId,
                  scanned_at as scannedAt, session_id as sessionId, scan_result as scanResult
           FROM qr_scan_history
           WHERE product_unique_id = ? AND id < ?
           ORDER BY id ASC`
        )
        .all(qrRow.product_unique_id, currentScanId);

      return {
        httpStatus: 200,
        sessionTokenToCookie: resolvedSessionToken!,
        body: {
          status: resolvedStatus === 'locked' ? 'LOCKED' : 'BATCH_REQUIRED',
          title:
            resolvedStatus === 'locked'
              ? 'BATCH VERIFICATION TEMPORARILY LOCKED'
              : 'QR CODE VALIDATED',
          message:
            resolvedStatus === 'locked'
              ? 'Maximum incorrect batch-number attempts reached. This verification session is temporarily locked.'
              : 'Enter the batch number to check whether your product is genuine or fake.',
          qrId: qrRow.qr_id,
          productUniqueId: qrRow.product_unique_id,
          sessionToken: resolvedSessionToken!,
          attemptCount: resolvedAttemptCount,
          maxAttempts: resolvedMaxAttempts,
          attemptsRemaining:
            resolvedStatus === 'locked'
              ? 0
              : Math.max(0, resolvedMaxAttempts - resolvedAttemptCount),
          lockedUntil: resolvedLockedUntil,
          expiresAt: resolvedExpiresAt!,
          currentScanId,
          previousScanCount: previousScans.length,
          hasPreviousScans: previousScans.length > 0,
          previousScans
        }
      };
    })();

    if ('retryAfterSec' in txResult && txResult.retryAfterSec) {
      res.setHeader('Retry-After', String(txResult.retryAfterSec));
    }
    if ('sessionTokenToCookie' in txResult && txResult.sessionTokenToCookie) {
      setCookie(req, res, COOKIE_VERIFY_SESSION, txResult.sessionTokenToCookie, SESSION_TTL_MS);
    }

    res.status(txResult.httpStatus).json(txResult.body);
  });

  // Restore current persistent verification session across page refresh / browser reopen
  router.get('/verify/session/current', (req, res) => {
    const cookies = parseCookies(req);
    const headerToken =
      typeof req.headers['x-session-token'] === 'string'
        ? req.headers['x-session-token'].trim()
        : undefined;
    const token = cookies[COOKIE_VERIFY_SESSION] || headerToken;

    if (!token) {
      res.json({ hasSession: false });
      return;
    }

    const nowIso = new Date().toISOString();
    const session = db
      .prepare(
        `SELECT s.session_token, s.qr_id, s.attempt_count, s.max_attempts, s.status, s.expires_at, s.locked_until,
                p.product_unique_id
         FROM verification_sessions s
         JOIN products p ON p.id = s.product_id
         WHERE s.session_token = ?`
      )
      .get(token) as
      | {
          session_token: string;
          qr_id: string;
          attempt_count: number;
          max_attempts: number;
          status: 'active' | 'successful' | 'locked' | 'expired';
          expires_at: string;
          locked_until: string | null;
          product_unique_id: string;
        }
      | undefined;

    if (!session) {
      res.json({ hasSession: false });
      return;
    }

    if (session.status === 'active' && session.expires_at <= nowIso) {
      db.prepare(`UPDATE verification_sessions SET status = 'expired' WHERE session_token = ?`).run(
        session.session_token
      );
      res.json({ hasSession: false, expired: true });
      return;
    }

    // Do NOT resume completed sessions as pending Stage 2 prompts
    if (session.status === 'successful' || session.status === 'expired') {
      res.json({ hasSession: false });
      return;
    }

    if (session.status === 'locked' && session.locked_until && session.locked_until <= nowIso) {
      db.prepare(`UPDATE verification_sessions SET status = 'expired' WHERE session_token = ?`).run(
        session.session_token
      );
      res.json({ hasSession: false });
      return;
    }

    res.json({
      hasSession: true,
      status: session.status === 'locked' ? 'LOCKED' : 'BATCH_REQUIRED',
      qrId: session.qr_id,
      productUniqueId: session.product_unique_id,
      sessionToken: session.session_token,
      attemptCount: session.attempt_count,
      maxAttempts: session.max_attempts,
      attemptsRemaining: Math.max(0, session.max_attempts - session.attempt_count),
      lockedUntil: session.locked_until,
      expiresAt: session.expires_at,
      restoredFromSession: true
    });
  });

  // Clear local browser session cookie ONLY if session is already completed/expired (cannot clear active/locked attempts!)
  router.post('/verify/session/dismiss', (req, res) => {
    const cookies = parseCookies(req);
    const token = cookies[COOKIE_VERIFY_SESSION];
    if (token) {
      const session = db
        .prepare(`SELECT status FROM verification_sessions WHERE session_token = ?`)
        .get(token) as { status: string } | undefined;
      if (session && (session.status === 'active' || session.status === 'locked')) {
        res.status(403).json({
          error: 'CANNOT_DISMISS_ACTIVE_OR_LOCKED_SESSION',
          message: 'Active or locked verification sessions cannot be cleared from the client.'
        });
        return;
      }
    }
    clearCookie(req, res, COOKIE_VERIFY_SESSION);
    res.json({ cleared: true });
  });

  // Stage 2: Backend batch comparison + 3-attempt lockout + verification logs + duplicate detection
  router.post('/verify/submit-batch', batchSubmitLimiter.middleware(), (req, res) => {
    const cookies = parseCookies(req);
    const bodyToken =
      typeof req.body?.sessionToken === 'string' ? req.body.sessionToken.trim() : undefined;
    const sessionToken = cookies[COOKIE_VERIFY_SESSION] || bodyToken;
    const enteredBatch =
      typeof req.body?.batchNumber === 'string' ? req.body.batchNumber.trim() : '';

    if (!sessionToken) {
      res.status(400).json({
        error: 'MISSING_SESSION',
        message: 'No active verification session found. Please scan the QR code again.'
      });
      return;
    }

    if (!enteredBatch) {
      res.status(400).json({
        error: 'MISSING_BATCH_NUMBER',
        message: 'Please enter the batch number printed on your product.'
      });
      return;
    }

    const fp = getClientFingerprint(req);
    const now = new Date();
    const nowIso = now.toISOString();

    const txResult = db.transaction(() => {
      const session = db
        .prepare(
          `SELECT s.*, q.status as qr_status,
                  p.product_unique_id, p.product_name, p.manufacturer, p.batch_number, p.manufacturing_date
           FROM verification_sessions s
           JOIN qr_codes q ON q.qr_id = s.qr_id
           JOIN products p ON p.id = s.product_id
           WHERE s.session_token = ?`
        )
        .get(sessionToken) as
        | {
            id: number;
            session_token: string;
            qr_id: string;
            product_id: number;
            attempt_count: number;
            max_attempts: number;
            status: 'active' | 'successful' | 'locked' | 'expired';
            expires_at: string;
            locked_until: string | null;
            qr_status: 'active' | 'revoked';
            product_unique_id: string;
            product_name: string;
            manufacturer: string;
            batch_number: string;
            manufacturing_date: string;
          }
        | undefined;

      if (!session) {
        return { httpStatus: 404, body: { error: 'SESSION_NOT_FOUND', message: 'Verification session does not exist.' } };
      }

      if (session.qr_status !== 'active') {
        return {
          httpStatus: 403,
          body: {
            status: 'REVOKED_QR',
            title: 'QR CODE REVOKED / INACTIVE',
            message: 'This QR code has been revoked by the manufacturer.'
          }
        };
      }

      if (session.status === 'locked' || session.attempt_count >= session.max_attempts) {
        return {
          httpStatus: 423,
          body: {
            status: 'LOCKED',
            title: 'BATCH VERIFICATION TEMPORARILY LOCKED',
            message:
              'Maximum of 3 incorrect batch-number attempts reached. Verification is temporarily locked for this session.',
            qrId: session.qr_id,
            attemptCount: session.attempt_count,
            maxAttempts: session.max_attempts,
            attemptsRemaining: 0,
            lockedUntil: session.locked_until
          }
        };
      }

      if (session.status === 'expired' || session.expires_at <= nowIso) {
        db.prepare(`UPDATE verification_sessions SET status = 'expired' WHERE id = ?`).run(session.id);
        return {
          httpStatus: 410,
          body: {
            status: 'EXPIRED',
            error: 'SESSION_EXPIRED',
            message: 'Verification session expired. Please scan the QR code again.'
          }
        };
      }

      if (session.status === 'successful') {
        return {
          httpStatus: 409,
          body: {
            error: 'SESSION_ALREADY_COMPLETED',
            message: 'This verification session has already completed. Please scan again for a new verification.'
          }
        };
      }

      // Compare batch numbers strictly on the backend
      const nextAttempt = session.attempt_count + 1;
      const isMatch = timingSafeEqualStrings(enteredBatch, session.batch_number.trim());

      if (isMatch) {
        const dupEval = evaluateDuplicateActivity(db, session.qr_id, fp, session.session_token);
        const resultType = dupEval.suspiciousActivity
          ? 'GENUINE_DUPLICATE_WARNING'
          : 'GENUINE';

        db.prepare(
          `UPDATE verification_sessions
           SET attempt_count = ?, status = 'successful', completed_at = ?
           WHERE id = ?`
        ).run(nextAttempt, nowIso, session.id);

        db.prepare(
          `INSERT INTO verification_logs
           (log_uid, qr_id, product_id, session_token, attempt_number, result, suspicious_activity, suspicious_reasons, client_fingerprint, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          generateUid('LOG'),
          session.qr_id,
          session.product_id,
          session.session_token,
          nextAttempt,
          resultType,
          dupEval.suspiciousActivity ? 1 : 0,
          JSON.stringify(dupEval.reasons),
          fp,
          nowIso
        );

        db.prepare(
          `UPDATE qr_scan_history
           SET scan_result = ?
           WHERE id = (
             SELECT id FROM qr_scan_history
             WHERE session_id = ?
             ORDER BY id DESC LIMIT 1
           )`
        ).run(resultType, session.session_token);

        const counts = db
          .prepare(
            `SELECT
               COUNT(*) as totalScanAttempts,
               SUM(CASE WHEN result IN ('GENUINE', 'GENUINE_DUPLICATE_WARNING') THEN 1 ELSE 0 END) as successfulVerifications
             FROM verification_logs
             WHERE qr_id = ?`
          )
          .get(session.qr_id) as {
          totalScanAttempts: number;
          successfulVerifications: number;
        };

        const historyRows = db
          .prepare(
            `SELECT log_uid as id, result, attempt_number as attemptNumber, suspicious_activity as suspiciousActivity, created_at as timestamp
             FROM verification_logs
             WHERE qr_id = ?
             ORDER BY id DESC
             LIMIT 25`
          )
          .all(session.qr_id);

        return {
          httpStatus: 200,
          clearVerifyCookie: true,
          body: {
            status: resultType,
            title: dupEval.suspiciousActivity
              ? 'VERIFICATION SUCCESSFUL — POSSIBLE DUPLICATE ACTIVITY DETECTED'
              : 'GENUINE PRODUCT',
            message: dupEval.suspiciousActivity
              ? 'Although the QR code and batch number match our records, unusual reuse activity has been detected. Please contact the manufacturer for confirmation.'
              : 'The QR code signature and batch number match our registered product records.',
            qrId: session.qr_id,
            productUniqueId: session.product_unique_id,
            productName: session.product_name,
            manufacturer: session.manufacturer,
            manufacturingDate: session.manufacturing_date,
            batchNumber: session.batch_number,
            totalScanAttempts: Number(counts.totalScanAttempts || 0),
            successfulVerifications: Number(counts.successfulVerifications || 0),
            suspiciousActivity: dupEval.suspiciousActivity,
            suspiciousReasons: dupEval.reasons,
            verificationHistory: historyRows,
            timestamp: nowIso
          }
        };
      }

      // Batch mismatch path (NEVER reveal registered batch number or product details!)
      const reachedLimit = nextAttempt >= session.max_attempts;
      const lockedUntil = reachedLimit
        ? new Date(now.getTime() + LOCKOUT_DURATION_MS).toISOString()
        : null;

      db.prepare(
        `UPDATE verification_sessions
         SET attempt_count = ?, status = ?, locked_until = ?
         WHERE id = ?`
      ).run(nextAttempt, reachedLimit ? 'locked' : 'active', lockedUntil, session.id);

      db.prepare(
        `INSERT INTO verification_logs
         (log_uid, qr_id, product_id, session_token, attempt_number, result, suspicious_activity, suspicious_reasons, client_fingerprint, created_at)
         VALUES (?, ?, ?, ?, ?, 'BATCH_MISMATCH', 0, '[]', ?, ?)`
      ).run(
        generateUid('LOG'),
        session.qr_id,
        session.product_id,
        session.session_token,
        nextAttempt,
        fp,
        nowIso
      );

      db.prepare(
        `UPDATE qr_scan_history
         SET scan_result = ?
         WHERE id = (
           SELECT id FROM qr_scan_history
           WHERE session_id = ?
           ORDER BY id DESC LIMIT 1
         )`
      ).run(reachedLimit ? 'LOCKED' : 'BATCH_MISMATCH', session.session_token);

      if (reachedLimit) {
        return {
          httpStatus: 423,
          body: {
            status: 'LOCKED',
            title: 'BATCH VERIFICATION TEMPORARILY LOCKED',
            message:
              'The entered batch number does not match our registered product information. Maximum of 3 attempts reached; this session is now temporarily locked.',
            qrId: session.qr_id,
            attemptCount: nextAttempt,
            maxAttempts: session.max_attempts,
            attemptsRemaining: 0,
            lockedUntil,
            timestamp: nowIso
          }
        };
      }

      return {
        httpStatus: 200,
        body: {
          status: 'BATCH_MISMATCH',
          title: 'BATCH NUMBER MISMATCH — PRODUCT NOT AUTHENTICATED',
          message:
            'The entered batch number does not match our registered product information. The product could not be authenticated.',
          qrId: session.qr_id,
          attemptCount: nextAttempt,
          maxAttempts: session.max_attempts,
          attemptsRemaining: session.max_attempts - nextAttempt,
          timestamp: nowIso
        }
      };
    })();

    if ('clearVerifyCookie' in txResult && txResult.clearVerifyCookie) {
      clearCookie(req, res, COOKIE_VERIFY_SESSION);
    }

    res.status(txResult.httpStatus).json(txResult.body);
  });

  // --- DASHBOARD AGGREGATE STATS (Public non-confidential counts) ---
  router.get('/dashboard/stats', (_req, res) => {
    const prodCount = db.prepare('SELECT COUNT(*) as cnt FROM products').get() as { cnt: number };
    const qrCounts = db
      .prepare(
        `SELECT
           COUNT(*) as totalQrCodes,
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as activeQrCodes,
           SUM(CASE WHEN status = 'revoked' THEN 1 ELSE 0 END) as revokedQrCodes
         FROM qr_codes`
      )
      .get() as { totalQrCodes: number; activeQrCodes: number; revokedQrCodes: number };

    const logCounts = db
      .prepare(
        `SELECT
           COUNT(*) as totalScanAttempts,
           SUM(CASE WHEN result IN ('GENUINE', 'GENUINE_DUPLICATE_WARNING') THEN 1 ELSE 0 END) as successfulVerifications,
           SUM(CASE WHEN result IN ('BATCH_MISMATCH', 'LOCKED') THEN 1 ELSE 0 END) as failedAttempts,
           SUM(CASE WHEN suspicious_activity = 1 THEN 1 ELSE 0 END) as suspiciousDuplicateCount,
           MAX(created_at) as lastScanTimestamp
         FROM verification_logs`
      )
      .get() as {
      totalScanAttempts: number;
      successfulVerifications: number;
      failedAttempts: number;
      suspiciousDuplicateCount: number;
      lastScanTimestamp: string | null;
    };

    const secCount = db.prepare('SELECT COUNT(*) as cnt FROM security_events').get() as { cnt: number };
    const printCount = db.prepare('SELECT COUNT(*) as cnt FROM print_logs').get() as { cnt: number };
    const qrScanCount = db.prepare('SELECT COUNT(*) as cnt FROM qr_scan_history').get() as { cnt: number };

    // Anonymized recent activity (never exposes batch_number or manufacturing_date!)
    const recentActivity = db
      .prepare(
        `SELECT v.log_uid as id, v.qr_id as qrId, p.product_unique_id as productUniqueId,
                v.result, v.attempt_number as attemptNumber, v.suspicious_activity as suspiciousActivity,
                v.created_at as timestamp
         FROM verification_logs v
         JOIN products p ON p.id = v.product_id
         ORDER BY v.id DESC LIMIT 1`
      )
      .get() as
      | {
          id: string;
          qrId: string;
          productUniqueId: string;
          result: string;
          attemptNumber: number;
          suspiciousActivity: number;
          timestamp: string;
        }
      | undefined;

    const jobCounts = db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pendingJobs,
           SUM(CASE WHEN status IN ('DISPATCHING', 'IN_PROGRESS') THEN 1 ELSE 0 END) as inProgressJobs,
           SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completedJobs,
           SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failedJobs
         FROM qr_generation_jobs`
      )
      .get() as {
      pendingJobs: number | null;
      inProgressJobs: number | null;
      completedJobs: number | null;
      failedJobs: number | null;
    };

    const freshCutoff = new Date(Date.now() - 20 * 1000).toISOString();
    const activeBridge = db
      .prepare(
        `SELECT device_id as deviceId, hotspot_url as hotspotUrl, bridge_connected as bridgeConnected,
                esp32_connected as esp32Connected, last_seen_at as lastSeenAt, last_error as lastError
         FROM esp32_bridge_status
         WHERE last_seen_at >= ?
         ORDER BY esp32_connected DESC, last_seen_at DESC
         LIMIT 1`
      )
      .get(freshCutoff) as
      | {
          deviceId: string;
          hotspotUrl: string | null;
          bridgeConnected: number;
          esp32Connected: number;
          lastSeenAt: string;
          lastError: string | null;
        }
      | undefined;

    res.json({
      totalProducts: Number(prodCount.cnt || 0),
      totalQrCodes: Number(qrCounts.totalQrCodes || 0),
      activeQrCodes: Number(qrCounts.activeQrCodes || 0),
      revokedQrCodes: Number(qrCounts.revokedQrCodes || 0),
      totalQrScans: Number(qrScanCount.cnt || 0),
      totalScanAttempts: Number(logCounts.totalScanAttempts || 0),
      successfulVerifications: Number(logCounts.successfulVerifications || 0),
      failedAttempts: Number(logCounts.failedAttempts || 0),
      failedVerifications: Number(logCounts.failedAttempts || 0),
      suspiciousDuplicateCount: Number(logCounts.suspiciousDuplicateCount || 0),
      invalidQrEvents: Number(secCount.cnt || 0),
      totalPrints: Number(printCount.cnt || 0),
      lastScanTimestamp: logCounts.lastScanTimestamp || null,
      recentActivity: recentActivity || null,
      qrGenerationStats: {
        pending: Number(jobCounts.pendingJobs || 0),
        inProgress: Number(jobCounts.inProgressJobs || 0),
        completed: Number(jobCounts.completedJobs || 0),
        failed: Number(jobCounts.failedJobs || 0)
      },
      esp32Status: {
        bridgeConnected: Boolean(activeBridge && activeBridge.bridgeConnected === 1),
        esp32Connected: Boolean(activeBridge && activeBridge.esp32Connected === 1),
        deviceId: activeBridge?.deviceId || null,
        hotspotUrl: activeBridge?.hotspotUrl || null,
        lastSeenAt: activeBridge?.lastSeenAt || null,
        lastError: activeBridge?.lastError || null
      }
    });
  });

  // --- ADMIN PRODUCTS & ESP32 QR JOB QUEUE ---

  router.get('/products', requireAdmin, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT
           p.id,
           p.product_unique_id as productId,
           p.product_name as productName,
           p.manufacturer,
           p.batch_number as batchNumber,
           p.manufacturing_date as manufacturingDate,
           p.notes,
           p.created_at as registeredAt,
           q.qr_id as qrId,
           q.payload_text as qrPayload,
           q.status as qrStatus,
           j.job_uid as qrJobId,
           j.status as qrJobStatus,
           j.device_id as qrJobDeviceId,
           j.error_message as qrJobError,
           j.completed_at as qrJobCompletedAt,
           j.updated_at as qrJobUpdatedAt,
           (SELECT COUNT(*) FROM qr_scan_history qsh WHERE qsh.product_unique_id = p.product_unique_id) as totalQrScans,
           (SELECT COUNT(*) FROM verification_logs v WHERE v.product_id = p.id) as totalScanAttempts,
           (SELECT COUNT(*) FROM verification_logs v WHERE v.product_id = p.id AND v.result IN ('GENUINE', 'GENUINE_DUPLICATE_WARNING')) as successfulVerifications
         FROM products p
         LEFT JOIN qr_codes q ON q.id = (
           SELECT id FROM qr_codes WHERE product_id = p.id ORDER BY id DESC LIMIT 1
         )
         LEFT JOIN qr_generation_jobs j ON j.id = (
           SELECT id FROM qr_generation_jobs WHERE product_id = p.id ORDER BY id DESC LIMIT 1
         )
         ORDER BY p.id DESC`
      )
      .all();

    res.json({ products: rows });
  });

  router.post('/products', requireAdmin, (req, res) => {
    const productUniqueId = String(req.body?.productId || '').trim();
    const productName = String(req.body?.productName || '').trim();
    const manufacturer = String(req.body?.manufacturer || '').trim();
    const batchNumber = String(req.body?.batchNumber || '').trim();
    const manufacturingDate =
      String(req.body?.manufacturingDate || '').trim() || new Date().toISOString().slice(0, 10);
    const notes = String(req.body?.notes || '').trim();

    if (!productUniqueId || !productName || !manufacturer || !batchNumber) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Product ID, Product Name, Manufacturer, and Batch Number are all required.'
      });
      return;
    }

    const existing = db
      .prepare('SELECT id FROM products WHERE product_unique_id = ?')
      .get(productUniqueId);
    if (existing) {
      res.status(409).json({
        error: 'DUPLICATE_PRODUCT_ID',
        message: `Product with Unique ID "${productUniqueId}" already exists.`
      });
      return;
    }

    const nowIso = new Date().toISOString();
    const qrId = generateQrId();
    const nonce = generateSecureToken(12);
    const { payloadText, hmacSignature } = buildSignedQrPayload(qrId, productUniqueId, nonce);
    const jobUid = generateUid('JOB');

    const createTx = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO products
           (product_unique_id, product_name, manufacturer, batch_number, manufacturing_date, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          productUniqueId,
          productName,
          manufacturer,
          batchNumber,
          manufacturingDate,
          notes,
          nowIso
        );

      const dbProductId = Number(info.lastInsertRowid);
      db.prepare(
        `INSERT INTO qr_codes (qr_id, product_id, token_nonce, payload_text, hmac_signature, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?)`
      ).run(qrId, dbProductId, nonce, payloadText, hmacSignature, nowIso);

      db.prepare(
        `INSERT INTO qr_generation_jobs
         (job_uid, qr_id, product_id, product_unique_id, payload_text, status, attempts, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)`
      ).run(jobUid, qrId, dbProductId, productUniqueId, payloadText, nowIso, nowIso);
    });

    createTx();

    res.status(201).json({
      product: {
        productId: productUniqueId,
        productName,
        manufacturer,
        batchNumber,
        manufacturingDate,
        notes,
        registeredAt: nowIso,
        qrId,
        qrPayload: payloadText,
        qrStatus: 'active',
        qrJobId: jobUid,
        qrJobStatus: 'PENDING'
      },
      generationJob: {
        jobId: jobUid,
        qrId,
        productId: productUniqueId,
        status: 'PENDING',
        createdAt: nowIso,
        updatedAt: nowIso
      }
    });
  });

  router.put('/products/:productId', requireAdmin, (req, res) => {
    const productUniqueId = req.params.productId.trim();
    const productName = String(req.body?.productName || '').trim();
    const manufacturer = String(req.body?.manufacturer || '').trim();
    const batchNumber = String(req.body?.batchNumber || '').trim();
    const manufacturingDate =
      String(req.body?.manufacturingDate || '').trim() || new Date().toISOString().slice(0, 10);
    const notes = String(req.body?.notes || '').trim();

    if (!productName || !manufacturer || !batchNumber) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Product Name, Manufacturer, and Batch Number are required.'
      });
      return;
    }

    const info = db
      .prepare(
        `UPDATE products
         SET product_name = ?, manufacturer = ?, batch_number = ?, manufacturing_date = ?, notes = ?
         WHERE product_unique_id = ?`
      )
      .run(productName, manufacturer, batchNumber, manufacturingDate, notes, productUniqueId);

    if (info.changes === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Product not found.' });
      return;
    }

    res.json({ updated: true });
  });

  router.delete('/products/:productId', requireAdmin, (req, res) => {
    const productUniqueId = req.params.productId.trim();
    const info = db
      .prepare('DELETE FROM products WHERE product_unique_id = ?')
      .run(productUniqueId);
    if (info.changes === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Product not found.' });
      return;
    }
    res.json({ deleted: true });
  });

  router.post('/products/import', requireAdmin, (req, res) => {
    const { items, mode } = req.body || {};
    if (!Array.isArray(items)) {
      res.status(400).json({
        error: 'INVALID_JSON',
        message: 'Root JSON element must be an array of product objects.'
      });
      return;
    }

    const importMode: 'merge' | 'replace' = mode === 'replace' ? 'replace' : 'merge';
    const nowIso = new Date().toISOString();

    let imported = 0;
    let skippedDuplicates = 0;
    let invalidCount = 0;
    const errors: string[] = [];

    const tx = db.transaction(() => {
      if (importMode === 'replace') {
        db.prepare('DELETE FROM products').run();
      }

      const existingRows = db
        .prepare('SELECT product_unique_id FROM products')
        .all() as Array<{ product_unique_id: string }>;
      const existingSet = new Set(existingRows.map((r) => r.product_unique_id.toLowerCase()));

      const insertProd = db.prepare(
        `INSERT INTO products (product_unique_id, product_name, manufacturer, batch_number, manufacturing_date, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      const insertQr = db.prepare(
        `INSERT INTO qr_codes (qr_id, product_id, token_nonce, payload_text, hmac_signature, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?)`
      );
      const insertJob = db.prepare(
        `INSERT INTO qr_generation_jobs
         (job_uid, qr_id, product_id, product_unique_id, payload_text, status, attempts, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)`
      );

      for (let i = 0; i < items.length; i++) {
        const item = items[i] || {};
        const productName = String(item.productName || item.product || item.name || '').trim();
        const productId = String(item.productId || item.id || '').trim();
        const manufacturer = String(item.manufacturer || item.mfr || item.mfg || '').trim();
        const batchNumber = String(item.batchNumber || item.batch || '').trim();
        const manufacturingDate = String(item.manufacturingDate || '').trim() || nowIso.slice(0, 10);
        const notes = String(item.notes || '').trim();

        if (!productName || !productId || !manufacturer || !batchNumber) {
          invalidCount++;
          errors.push(`Record #${i + 1} is missing required fields.`);
          continue;
        }

        if (existingSet.has(productId.toLowerCase())) {
          skippedDuplicates++;
          continue;
        }

        const info = insertProd.run(
          productId,
          productName,
          manufacturer,
          batchNumber,
          manufacturingDate,
          notes,
          item.registeredAt ? String(item.registeredAt) : nowIso
        );
        const dbProductId = Number(info.lastInsertRowid);
        const qrId = generateQrId();
        const nonce = generateSecureToken(12);
        const { payloadText, hmacSignature } = buildSignedQrPayload(qrId, productId, nonce);
        insertQr.run(qrId, dbProductId, nonce, payloadText, hmacSignature, nowIso);
        insertJob.run(generateUid('JOB'), qrId, dbProductId, productId, payloadText, nowIso, nowIso);

        existingSet.add(productId.toLowerCase());
        imported++;
      }
    });

    tx();
    res.json({ imported, skippedDuplicates, invalidCount, errors });
  });

  router.post('/products/reset-sample', requireAdmin, (_req, res) => {
    const nowIso = new Date().toISOString();
    const tx = db.transaction(() => {
      const existing = db
        .prepare('SELECT product_unique_id FROM products')
        .all() as Array<{ product_unique_id: string }>;
      const existingSet = new Set(existing.map((e) => e.product_unique_id));

      for (const item of SAMPLE_SEED_PRODUCTS) {
        if (!existingSet.has(item.productUniqueId)) {
          const info = db
            .prepare(
              `INSERT INTO products (product_unique_id, product_name, manufacturer, batch_number, manufacturing_date, notes, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              item.productUniqueId,
              item.productName,
              item.manufacturer,
              item.batchNumber,
              item.manufacturingDate,
              item.notes,
              nowIso
            );
          const dbProductId = Number(info.lastInsertRowid);
          const nonce = generateSecureToken(12);
          const { payloadText, hmacSignature } = buildSignedQrPayload(
            item.defaultQrId,
            item.productUniqueId,
            nonce
          );
          db.prepare(
            `INSERT INTO qr_codes (qr_id, product_id, token_nonce, payload_text, hmac_signature, status, created_at)
             VALUES (?, ?, ?, ?, ?, 'active', ?)`
          ).run(item.defaultQrId, dbProductId, nonce, payloadText, hmacSignature, nowIso);
        }
      }
    });
    tx();
    res.json({ restored: true });
  });

  // --- ESP32 QR GENERATION JOB QUEUE & HARDWARE STATUS (NO WEBSITE QR IMAGE GENERATION) ---

  router.get('/esp32/status', (_req, res) => {
    const freshCutoff = new Date(Date.now() - 20 * 1000).toISOString();
    const activeBridge = db
      .prepare(
        `SELECT device_id as deviceId, hotspot_url as hotspotUrl, bridge_connected as bridgeConnected,
                esp32_connected as esp32Connected, last_seen_at as lastSeenAt,
                last_error as lastError, firmware_info as firmwareInfo
         FROM esp32_bridge_status
         WHERE last_seen_at >= ?
         ORDER BY esp32_connected DESC, last_seen_at DESC
         LIMIT 1`
      )
      .get(freshCutoff) as
      | {
          deviceId: string;
          hotspotUrl: string | null;
          bridgeConnected: number;
          esp32Connected: number;
          lastSeenAt: string;
          lastError: string | null;
          firmwareInfo: string | null;
        }
      | undefined;

    const counts = db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pendingJobs,
           SUM(CASE WHEN status IN ('DISPATCHING', 'IN_PROGRESS') THEN 1 ELSE 0 END) as inProgressJobs,
           SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completedJobs,
           SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failedJobs
         FROM qr_generation_jobs`
      )
      .get() as {
      pendingJobs: number | null;
      inProgressJobs: number | null;
      completedJobs: number | null;
      failedJobs: number | null;
    };

    res.json({
      bridgeConnected: Boolean(activeBridge && activeBridge.bridgeConnected === 1),
      esp32Connected: Boolean(activeBridge && activeBridge.esp32Connected === 1),
      deviceId: activeBridge?.deviceId || null,
      hotspotUrl: activeBridge?.hotspotUrl || null,
      lastSeenAt: activeBridge?.lastSeenAt || null,
      lastError: activeBridge?.lastError || null,
      firmwareInfo: activeBridge?.firmwareInfo || null,
      pendingJobs: Number(counts.pendingJobs || 0),
      inProgressJobs: Number(counts.inProgressJobs || 0),
      completedJobs: Number(counts.completedJobs || 0),
      failedJobs: Number(counts.failedJobs || 0)
    });
  });

  router.post('/esp32/heartbeat', requireAdminOrBridge, (req, res) => {
    const deviceId = String(req.body?.deviceId || 'ESP32-HOTSPOT').trim().slice(0, 80);
    const hotspotRaw = req.body?.hotspotUrl ?? req.body?.portName;
    const hotspotUrl = hotspotRaw ? String(hotspotRaw).trim().slice(0, 160) : null;
    const bridgeConnected = req.body?.bridgeConnected === false ? 0 : 1;
    const esp32Connected = req.body?.esp32Connected ? 1 : 0;
    const lastError = req.body?.lastError ? String(req.body.lastError).slice(0, 500) : null;
    const firmwareInfo = req.body?.firmwareInfo ? String(req.body.firmwareInfo).slice(0, 120) : null;
    const nowIso = new Date().toISOString();

    db.prepare(
      `INSERT INTO esp32_bridge_status
       (device_id, hotspot_url, bridge_connected, esp32_connected, last_seen_at, last_error, firmware_info)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(device_id) DO UPDATE SET
         hotspot_url = excluded.hotspot_url,
         bridge_connected = excluded.bridge_connected,
         esp32_connected = excluded.esp32_connected,
         last_seen_at = excluded.last_seen_at,
         last_error = excluded.last_error,
         firmware_info = COALESCE(excluded.firmware_info, esp32_bridge_status.firmware_info)`
    ).run(deviceId, hotspotUrl, bridgeConnected, esp32Connected, nowIso, lastError, firmwareInfo);

    res.json({ ok: true, deviceId, hotspotUrl, lastSeenAt: nowIso });
  });

  router.get('/qr-jobs', requireAdmin, (_req, res) => {
    const jobs = db
      .prepare(
        `SELECT j.job_uid as jobId, j.qr_id as qrId, j.product_unique_id as productId,
                p.product_name as productName, p.manufacturer,
                j.status, j.device_id as deviceId, j.attempts, j.error_message as errorMessage,
                j.created_at as createdAt, j.dispatched_at as dispatchedAt,
                j.completed_at as completedAt, j.updated_at as updatedAt
         FROM qr_generation_jobs j
         JOIN products p ON p.id = j.product_id
         ORDER BY j.id DESC
         LIMIT 100`
      )
      .all();
    res.json({ jobs });
  });

  router.get('/qr-jobs/:jobUid', requireAdmin, (req, res) => {
    const jobUid = req.params.jobUid.trim();
    const job = db
      .prepare(
        `SELECT j.job_uid as jobId, j.qr_id as qrId, j.product_unique_id as productId,
                p.product_name as productName, p.manufacturer,
                j.status, j.device_id as deviceId, j.attempts, j.error_message as errorMessage,
                j.created_at as createdAt, j.dispatched_at as dispatchedAt,
                j.completed_at as completedAt, j.updated_at as updatedAt
         FROM qr_generation_jobs j
         JOIN products p ON p.id = j.product_id
         WHERE j.job_uid = ?`
      )
      .get(jobUid);

    if (!job) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'QR generation job not found.' });
      return;
    }
    res.json({ job });
  });

  router.post('/qr-jobs/request', requireAdmin, (req, res) => {
    const productUniqueId = String(req.body?.productId || '').trim();
    const forceNew = Boolean(req.body?.forceNew);

    const product = db
      .prepare('SELECT * FROM products WHERE product_unique_id = ?')
      .get(productUniqueId) as
      | {
          id: number;
          product_unique_id: string;
          product_name: string;
          manufacturer: string;
        }
      | undefined;

    if (!product) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Product not found.' });
      return;
    }

    const nowIso = new Date().toISOString();

    const txResult = db.transaction(() => {
      let qrRow = !forceNew
        ? (db
            .prepare('SELECT qr_id, payload_text, status FROM qr_codes WHERE product_id = ? AND status = \'active\' ORDER BY id DESC LIMIT 1')
            .get(product.id) as
            | { qr_id: string; payload_text: string; status: string }
            | undefined)
        : undefined;

      if (!qrRow) {
        if (forceNew) {
          db.prepare(
            `UPDATE qr_generation_jobs
             SET status = 'FAILED', error_message = 'Superseded by new QR generation request', updated_at = ?
             WHERE product_id = ? AND status IN ('PENDING', 'DISPATCHING', 'IN_PROGRESS')`
          ).run(nowIso, product.id);
        }

        const qrId = generateQrId();
        const nonce = generateSecureToken(12);
        const { payloadText, hmacSignature } = buildSignedQrPayload(
          qrId,
          product.product_unique_id,
          nonce
        );
        db.prepare(
          `INSERT INTO qr_codes (qr_id, product_id, token_nonce, payload_text, hmac_signature, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?)`
        ).run(qrId, product.id, nonce, payloadText, hmacSignature, nowIso);
        qrRow = { qr_id: qrId, payload_text: payloadText, status: 'active' };
      }

      const activeJob = db
        .prepare(
          `SELECT job_uid as jobId, qr_id as qrId, product_unique_id as productId,
                  status, device_id as deviceId, attempts, error_message as errorMessage,
                  created_at as createdAt, dispatched_at as dispatchedAt,
                  completed_at as completedAt, updated_at as updatedAt
           FROM qr_generation_jobs
           WHERE qr_id = ? AND status IN ('PENDING', 'DISPATCHING', 'IN_PROGRESS')
           ORDER BY id DESC LIMIT 1`
        )
        .get(qrRow.qr_id) as Record<string, unknown> | undefined;

      if (activeJob) {
        return {
          alreadyQueued: true,
          job: {
            ...activeJob,
            productName: product.product_name,
            manufacturer: product.manufacturer
          }
        };
      }

      const jobUid = generateUid('JOB');
      db.prepare(
        `INSERT INTO qr_generation_jobs
         (job_uid, qr_id, product_id, product_unique_id, payload_text, status, attempts, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)`
      ).run(jobUid, qrRow.qr_id, product.id, product.product_unique_id, qrRow.payload_text, nowIso, nowIso);

      return {
        alreadyQueued: false,
        job: {
          jobId: jobUid,
          qrId: qrRow.qr_id,
          productId: product.product_unique_id,
          productName: product.product_name,
          manufacturer: product.manufacturer,
          status: 'PENDING',
          deviceId: null,
          attempts: 0,
          errorMessage: null,
          createdAt: nowIso,
          dispatchedAt: null,
          completedAt: null,
          updatedAt: nowIso
        }
      };
    })();

    res.status(txResult.alreadyQueued ? 200 : 201).json(txResult);
  });

  router.post('/qr-jobs/:jobUid/retry', requireAdmin, (req, res) => {
    const jobUid = req.params.jobUid.trim();
    const nowIso = new Date().toISOString();

    const txResult = db.transaction(() => {
      const job = db
        .prepare(
          `SELECT j.*, p.product_name, p.manufacturer
           FROM qr_generation_jobs j
           JOIN products p ON p.id = j.product_id
           WHERE j.job_uid = ?`
        )
        .get(jobUid) as
        | {
            id: number;
            job_uid: string;
            qr_id: string;
            product_id: number;
            product_unique_id: string;
            payload_text: string;
            status: string;
            product_name: string;
            manufacturer: string;
          }
        | undefined;

      if (!job) {
        return { httpStatus: 404, body: { error: 'NOT_FOUND', message: 'QR generation job not found.' } };
      }

      if (job.status === 'PENDING' || job.status === 'DISPATCHING' || job.status === 'IN_PROGRESS') {
        return {
          httpStatus: 200,
          body: {
            job: {
              jobId: job.job_uid,
              qrId: job.qr_id,
              productId: job.product_unique_id,
              productName: job.product_name,
              manufacturer: job.manufacturer,
              status: job.status
            }
          }
        };
      }

      const existingActive = db
        .prepare(
          `SELECT job_uid FROM qr_generation_jobs
           WHERE qr_id = ? AND status IN ('PENDING', 'DISPATCHING', 'IN_PROGRESS')`
        )
        .get(job.qr_id) as { job_uid: string } | undefined;

      if (existingActive) {
        return {
          httpStatus: 409,
          body: {
            error: 'JOB_ALREADY_ACTIVE',
            message: `An active ESP32 job (${existingActive.job_uid}) is already queued for QR ${job.qr_id}.`
          }
        };
      }

      const newJobUid = generateUid('JOB');
      db.prepare(
        `INSERT INTO qr_generation_jobs
         (job_uid, qr_id, product_id, product_unique_id, payload_text, status, attempts, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)`
      ).run(newJobUid, job.qr_id, job.product_id, job.product_unique_id, job.payload_text, nowIso, nowIso);

      return {
        httpStatus: 201,
        body: {
          job: {
            jobId: newJobUid,
            qrId: job.qr_id,
            productId: job.product_unique_id,
            productName: job.product_name,
            manufacturer: job.manufacturer,
            status: 'PENDING',
            deviceId: null,
            attempts: 0,
            errorMessage: null,
            createdAt: nowIso,
            dispatchedAt: null,
            completedAt: null,
            updatedAt: nowIso
          }
        }
      };
    })();

    res.status(txResult.httpStatus).json(txResult.body);
  });

  // Bridge claims the oldest PENDING job atomically (prevents double-sending the same job)
  router.post('/esp32/jobs/claim', requireAdminOrBridge, (req, res) => {
    const deviceId = String(req.body?.deviceId || 'ESP32-HOTSPOT').trim().slice(0, 80);
    const timeoutSec = Math.max(30, Math.min(600, Number(req.body?.reclaimTimeoutSec) || 120));
    const nowIso = new Date().toISOString();
    const staleCutoff = new Date(Date.now() - timeoutSec * 1000).toISOString();

    const claimed = db.transaction(() => {
      // Mark timed-out DISPATCHING / IN_PROGRESS jobs as FAILED so admin can inspect and retry explicitly without silent double-printing
      db.prepare(
        `UPDATE qr_generation_jobs
         SET status = 'FAILED',
             error_message = 'ESP32 acknowledgement timed out before completion.',
             updated_at = ?
         WHERE status IN ('DISPATCHING', 'IN_PROGRESS')
           AND dispatched_at IS NOT NULL
           AND dispatched_at <= ?`
      ).run(nowIso, staleCutoff);

      const nextPending = db
        .prepare(
          `SELECT j.id, j.job_uid, j.qr_id, j.product_id, j.product_unique_id, j.payload_text,
                  p.product_name, p.manufacturer
           FROM qr_generation_jobs j
           JOIN products p ON p.id = j.product_id
           WHERE j.status = 'PENDING'
           ORDER BY j.id ASC
           LIMIT 1`
        )
        .get() as
        | {
            id: number;
            job_uid: string;
            qr_id: string;
            product_id: number;
            product_unique_id: string;
            payload_text: string;
            product_name: string;
            manufacturer: string;
          }
        | undefined;

      if (!nextPending) {
        return null;
      }

      const upd = db
        .prepare(
          `UPDATE qr_generation_jobs
           SET status = 'DISPATCHING',
               device_id = ?,
               dispatched_at = ?,
               updated_at = ?,
               attempts = attempts + 1,
               error_message = NULL
           WHERE id = ? AND status = 'PENDING'`
        )
        .run(deviceId, nowIso, nowIso, nextPending.id);

      if (upd.changes === 0) {
        return null;
      }

      return {
        jobId: nextPending.job_uid,
        qrId: nextPending.qr_id,
        productId: nextPending.product_unique_id,
        productName: nextPending.product_name,
        manufacturer: nextPending.manufacturer,
        payloadText: nextPending.payload_text,
        status: 'DISPATCHING',
        deviceId,
        dispatchedAt: nowIso
      };
    })();

    res.json({ job: claimed });
  });

  // Bridge reports IN_PROGRESS, COMPLETED, or FAILED for a claimed job
  router.post('/esp32/jobs/:jobUid/status', requireAdminOrBridge, (req, res) => {
    const jobUid = req.params.jobUid.trim();
    const nextStatus = String(req.body?.status || '').trim().toUpperCase();
    const deviceId = req.body?.deviceId ? String(req.body.deviceId).trim().slice(0, 80) : undefined;
    const errorMessage = req.body?.errorMessage
      ? String(req.body.errorMessage).trim().slice(0, 500)
      : null;

    if (!['IN_PROGRESS', 'COMPLETED', 'FAILED'].includes(nextStatus)) {
      res.status(400).json({
        error: 'INVALID_STATUS',
        message: 'Job status must be IN_PROGRESS, COMPLETED, or FAILED.'
      });
      return;
    }

    const nowIso = new Date().toISOString();

    const txResult = db.transaction(() => {
      const job = db
        .prepare('SELECT * FROM qr_generation_jobs WHERE job_uid = ?')
        .get(jobUid) as
        | {
            id: number;
            job_uid: string;
            qr_id: string;
            product_id: number;
            product_unique_id: string;
            status: string;
            device_id: string | null;
          }
        | undefined;

      if (!job) {
        return { httpStatus: 404, body: { error: 'NOT_FOUND', message: 'QR generation job not found.' } };
      }

      if (job.status === 'COMPLETED') {
        return {
          httpStatus: 200,
          body: {
            job: {
              jobId: job.job_uid,
              qrId: job.qr_id,
              productId: job.product_unique_id,
              status: 'COMPLETED',
              deviceId: job.device_id
            }
          }
        };
      }

      const resolvedDevice = deviceId || job.device_id || 'ESP32-HOTSPOT';

      db.prepare(
        `UPDATE qr_generation_jobs
         SET status = ?,
             device_id = ?,
             error_message = ?,
             completed_at = CASE WHEN ? = 'COMPLETED' THEN ? ELSE completed_at END,
             updated_at = ?
         WHERE id = ?`
      ).run(
        nextStatus,
        resolvedDevice,
        nextStatus === 'FAILED' ? errorMessage || 'ESP32 reported QR generation failure.' : null,
        nextStatus,
        nowIso,
        nowIso,
        job.id
      );

      if (nextStatus === 'COMPLETED') {
        db.prepare(
          `INSERT INTO print_logs (print_uid, qr_id, product_id, format, print_status, operator_name, created_at)
           VALUES (?, ?, ?, 'THERMAL', 'ESP32_PRINTED', ?, ?)`
        ).run(generateUid('PRT'), job.qr_id, job.product_id, resolvedDevice, nowIso);
      }

      return {
        httpStatus: 200,
        body: {
          job: {
            jobId: job.job_uid,
            qrId: job.qr_id,
            productId: job.product_unique_id,
            status: nextStatus,
            deviceId: resolvedDevice,
            errorMessage: nextStatus === 'FAILED' ? errorMessage : null,
            completedAt: nextStatus === 'COMPLETED' ? nowIso : null,
            updatedAt: nowIso
          }
        }
      };
    })();

    res.status(txResult.httpStatus).json(txResult.body);
  });

  router.patch('/qr/:qrId/status', requireAdmin, (req, res) => {
    const qrId = req.params.qrId.trim();
    const status = req.body?.status === 'revoked' ? 'revoked' : req.body?.status === 'active' ? 'active' : null;
    if (!status) {
      res.status(400).json({ error: 'INVALID_STATUS', message: 'Status must be active or revoked.' });
      return;
    }

    const info = db.prepare('UPDATE qr_codes SET status = ? WHERE qr_id = ?').run(status, qrId);
    if (info.changes === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'QR code not found.' });
      return;
    }

    res.json({ qrId, status });
  });

  router.post('/prints', requireAdmin, (req, res) => {
    const qrId = String(req.body?.qrId || '').trim();
    const format = String(req.body?.format || 'PNG').toUpperCase();
    const printStatus = String(req.body?.printStatus || 'DOWNLOADED').toUpperCase();
    const operator = (req as Request & { adminUser?: string }).adminUser || 'Admin';

    const qr = db.prepare('SELECT product_id FROM qr_codes WHERE qr_id = ?').get(qrId) as
      | { product_id: number }
      | undefined;
    if (!qr) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'QR code not found.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const printUid = generateUid('PRT');
    db.prepare(
      `INSERT INTO print_logs (print_uid, qr_id, product_id, format, print_status, operator_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(printUid, qrId, qr.product_id, format, printStatus, operator, nowIso);

    res.status(201).json({ printUid, qrId, format, printStatus, createdAt: nowIso });
  });

  router.get('/prints', requireAdmin, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT pl.print_uid as id, pl.qr_id as qrId, p.product_unique_id as productId,
                p.product_name as productName, pl.format, pl.print_status as printStatus,
                pl.operator_name as operatorName, pl.created_at as createdAt
         FROM print_logs pl
         JOIN products p ON p.id = pl.product_id
         ORDER BY pl.id DESC
         LIMIT 100`
      )
      .all();

    res.json({ printLogs: rows });
  });

  // --- ADMIN VERIFICATION HISTORY & SECURITY EVENTS ---
  router.get('/history', requireAdmin, (_req, res) => {
    const logs = db
      .prepare(
        `SELECT v.log_uid as id, v.qr_id as qrId, v.session_token as sessionId,
                p.product_unique_id as productId, p.product_name as productName,
                p.manufacturer, p.batch_number as batchNumber,
                v.attempt_number as attemptNumber, v.result as status,
                v.suspicious_activity as suspiciousActivity, v.suspicious_reasons as suspiciousReasons,
                v.created_at as timestamp
         FROM verification_logs v
         JOIN products p ON p.id = v.product_id
         ORDER BY v.id DESC
         LIMIT 250`
      )
      .all()
      .map((row: any) => ({
        ...row,
        suspiciousActivity: Boolean(row.suspiciousActivity),
        suspiciousReasons: (() => {
          try {
            return JSON.parse(row.suspiciousReasons || '[]');
          } catch {
            return [];
          }
        })()
      }));

    const securityEvents = db
      .prepare(
        `SELECT event_uid as id, event_type as eventType, qr_id_attempted as qrIdAttempted,
                payload_hash as payloadHash, details, created_at as timestamp
         FROM security_events
         ORDER BY id DESC
         LIMIT 150`
      )
      .all();

    const qrScans = db
      .prepare(
        `SELECT qsh.id, qsh.product_unique_id as productUniqueId, qsh.qr_id as qrId,
                qsh.scanned_at as scannedAt, qsh.session_id as sessionId,
                qsh.scan_result as scanResult, p.product_name as productName, p.manufacturer
         FROM qr_scan_history qsh
         LEFT JOIN products p ON p.product_unique_id = qsh.product_unique_id
         ORDER BY qsh.id DESC
         LIMIT 250`
      )
      .all();

    res.json({ logs, securityEvents, qrScans });
  });

  // --- PUBLIC DEMO HELPER (Returns signed sample QR payload ONLY, never batchNumber or secrets) ---
  router.get('/demo/sample-qrs', (_req, res) => {
    const sampleQr = db
      .prepare(
        `SELECT q.qr_id as qrId, q.payload_text as payloadText
         FROM qr_codes q
         WHERE q.status = 'active'
         ORDER BY q.id ASC
         LIMIT 1`
      )
      .get() as { qrId: string; payloadText: string } | undefined;

    const validQrPayload = sampleQr?.payloadText || '';
    const lastChar = validQrPayload.slice(-1);
    const flippedChar = lastChar === '0' ? '1' : '0';
    const tamperedQrPayload = validQrPayload
      ? `${validQrPayload.slice(0, -1)}${flippedChar}`
      : 'SQR1|QR-8F72A91C|SB001|000000000000000000000000|0000000000000000000000000000000000000000000000000000000000000000';

    res.json({
      sampleQrId: sampleQr?.qrId || null,
      validQrPayload,
      tamperedQrPayload,
      unregisteredQrPayload:
        'SQR1|QR-0000DEAD|SD999|deadbeef01234567deadbeef|0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      malformedPayload: 'Product: Smart Battery; ID: SB001; Manufacturer: ABC Electronics'
    });
  });

  // --- ISOLATED BACKEND ACCEPTANCE TEST SUITE ---
  router.post('/testsuite/run', async (_req, res) => {
    try {
      const results = await runIsolatedBackendTestSuite();
      res.json({ results });
    } catch (err) {
      res.status(500).json({
        error: 'TEST_SUITE_ERROR',
        message: err instanceof Error ? err.message : 'Failed to execute backend test suite.'
      });
    }
  });

  return router;
}
