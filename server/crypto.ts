import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

interface DevSecrets {
  hmacSecret: string;
  adminSessionSecret: string;
}

let cachedSecrets: DevSecrets | null = null;

function getSecrets(): DevSecrets {
  if (cachedSecrets) return cachedSecrets;

  const envHmac = process.env.HMAC_SECRET?.trim();
  const envSession = process.env.ADMIN_SESSION_SECRET?.trim();

  if (envHmac && envSession) {
    cachedSecrets = {
      hmacSecret: envHmac,
      adminSessionSecret: envSession
    };
    return cachedSecrets;
  }

  // Persist locally generated development secrets so restarts do not invalidate existing signed QRs
  const secretFilePath = path.resolve(process.cwd(), '.smartqr-dev-secret');
  let fileSecrets: Partial<DevSecrets> = {};
  if (fs.existsSync(secretFilePath)) {
    try {
      fileSecrets = JSON.parse(fs.readFileSync(secretFilePath, 'utf8'));
    } catch {
      fileSecrets = {};
    }
  }

  const hmacSecret = envHmac || fileSecrets.hmacSecret || crypto.randomBytes(32).toString('hex');
  const adminSessionSecret =
    envSession || fileSecrets.adminSessionSecret || crypto.randomBytes(32).toString('hex');

  if (!envHmac || !envSession) {
    try {
      fs.writeFileSync(
        secretFilePath,
        JSON.stringify({ hmacSecret, adminSessionSecret }, null, 2),
        { mode: 0o600 }
      );
    } catch {
      // Non-writable filesystem fallback; keep in-memory
    }
  }

  cachedSecrets = { hmacSecret, adminSessionSecret };
  return cachedSecrets;
}

export function generateSecureToken(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString('hex');
}

export function generateQrId(): string {
  return `QR-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

export function generateUid(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

export function computeQrHmac(qrId: string, productUniqueId: string, tokenNonce: string): string {
  const { hmacSecret } = getSecrets();
  const canonical = `${qrId}|${productUniqueId}|${tokenNonce}`;
  return crypto.createHmac('sha256', hmacSecret).update(canonical, 'utf8').digest('hex');
}

export function buildSignedQrPayload(qrId: string, productUniqueId: string, tokenNonce: string): {
  payloadText: string;
  hmacSignature: string;
} {
  const hmacSignature = computeQrHmac(qrId, productUniqueId, tokenNonce);
  // Note: Batch number & manufacturing date are NEVER encoded in the public QR payload
  const payloadText = `SQR1|${qrId}|${productUniqueId}|${tokenNonce}|${hmacSignature}`;
  return { payloadText, hmacSignature };
}

export interface ParsedSignedQr {
  validFormat: boolean;
  qrId?: string;
  productUniqueId?: string;
  tokenNonce?: string;
  hmacSignature?: string;
}

export function parseSignedQrPayload(rawText: string): ParsedSignedQr {
  const trimmed = (rawText || '').trim();
  if (!trimmed) return { validFormat: false };

  // Compact format: SQR1|<qrId>|<productUniqueId>|<tokenNonce>|<hmacSignature>
  if (trimmed.startsWith('SQR1|')) {
    const parts = trimmed.split('|');
    if (parts.length !== 5) {
      return { validFormat: false };
    }
    const [, qrId, productUniqueId, tokenNonce, hmacSignature] = parts;
    if (!qrId || !productUniqueId || !tokenNonce || !hmacSignature) {
      return { validFormat: false };
    }
    return {
      validFormat: true,
      qrId: qrId.trim(),
      productUniqueId: productUniqueId.trim(),
      tokenNonce: tokenNonce.trim(),
      hmacSignature: hmacSignature.trim()
    };
  }

  // Optional JSON signed format: { "v": 1, "qrId": "...", "pid": "...", "nonce": "...", "sig": "..." }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj && obj.qrId && obj.pid && obj.nonce && obj.sig) {
        return {
          validFormat: true,
          qrId: String(obj.qrId).trim(),
          productUniqueId: String(obj.pid).trim(),
          tokenNonce: String(obj.nonce).trim(),
          hmacSignature: String(obj.sig).trim()
        };
      }
    } catch {
      return { validFormat: false };
    }
  }

  return { validFormat: false };
}

export function verifyQrHmac(
  qrId: string,
  productUniqueId: string,
  tokenNonce: string,
  providedSignature: string
): boolean {
  const expected = computeQrHmac(qrId, productUniqueId, tokenNonce);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from((providedSignature || '').trim(), 'utf8');

  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export function hashForAudit(input: string): string {
  return crypto.createHash('sha256').update(input || '', 'utf8').digest('hex').slice(0, 16);
}

export function createClientFingerprint(ip: string, userAgent: string): string {
  const { hmacSecret } = getSecrets();
  return crypto
    .createHmac('sha256', hmacSecret)
    .update(`${ip || 'unknown'}|${userAgent || 'unknown'}`)
    .digest('hex')
    .slice(0, 24);
}

export function signAdminSession(username: string, ttlMs = 1000 * 60 * 60 * 12): string {
  const { adminSessionSecret } = getSecrets();
  const payload = Buffer.from(
    JSON.stringify({
      sub: username,
      exp: Date.now() + ttlMs,
      jti: crypto.randomBytes(8).toString('hex')
    })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', adminSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyAdminSession(token: string | undefined): { valid: boolean; username?: string } {
  if (!token || !token.includes('.')) return { valid: false };
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return { valid: false };

  const { adminSessionSecret } = getSecrets();
  const expectedSig = crypto
    .createHmac('sha256', adminSessionSecret)
    .update(payload)
    .digest('base64url');

  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  const sigBuf = Buffer.from(sig, 'utf8');
  if (expectedBuf.length !== sigBuf.length || !crypto.timingSafeEqual(expectedBuf, sigBuf)) {
    return { valid: false };
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded.sub || typeof decoded.exp !== 'number' || decoded.exp < Date.now()) {
      return { valid: false };
    }
    return { valid: true, username: String(decoded.sub) };
  } catch {
    return { valid: false };
  }
}

export function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    // Compare against dummy buffer of same length to reduce timing leak
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}
