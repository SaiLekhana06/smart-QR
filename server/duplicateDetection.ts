import type Database from 'better-sqlite3';

export interface DuplicateEvaluation {
  suspiciousActivity: boolean;
  reasons: string[];
  priorSuccessCount: number;
  priorFailedCount: number;
}

export function evaluateDuplicateActivity(
  db: Database.Database,
  qrId: string,
  currentFingerprint: string,
  currentSessionToken: string
): DuplicateEvaluation {
  const reasons: string[] = [];

  // 1. Prior successful verifications for this QR code
  const successRows = db
    .prepare(
      `SELECT DISTINCT session_token, client_fingerprint
       FROM verification_logs
       WHERE qr_id = ? AND result IN ('GENUINE', 'GENUINE_DUPLICATE_WARNING')`
    )
    .all(qrId) as Array<{ session_token: string; client_fingerprint: string }>;

  const priorSuccessCount = successRows.length;
  const distinctOtherSessions = successRows.filter(
    (r) => r.session_token !== currentSessionToken
  ).length;
  const otherDeviceFingerprints = new Set(
    successRows
      .filter((r) => r.client_fingerprint !== currentFingerprint)
      .map((r) => r.client_fingerprint)
  );

  if (otherDeviceFingerprints.size >= 1) {
    reasons.push(
      `QR code was previously verified on ${otherDeviceFingerprints.size} other device/browser fingerprint(s).`
    );
  }

  // Repeated successful verifications across >= 3 separate sessions (not flagging a single benign re-scan)
  if (distinctOtherSessions >= 2) {
    reasons.push(
      `Repeated verifications across ${distinctOtherSessions + 1} separate verification sessions.`
    );
  }

  // 2. Unusual high-frequency verification burst (last 5 minutes)
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const burstRow = db
    .prepare(
      `SELECT COUNT(*) as cnt
       FROM verification_logs
       WHERE qr_id = ? AND created_at >= ?`
    )
    .get(qrId, fiveMinAgo) as { cnt: number };

  if (burstRow.cnt >= 4) {
    reasons.push(
      `Unusual scan frequency detected (${burstRow.cnt + 1} attempts within the last 5 minutes).`
    );
  }

  // 3. Prior failed batch-number attempts or locked sessions on this QR
  const failedRow = db
    .prepare(
      `SELECT COUNT(*) as cnt
       FROM verification_logs
       WHERE qr_id = ? AND result IN ('BATCH_MISMATCH', 'LOCKED')`
    )
    .get(qrId) as { cnt: number };

  const lockedSessionsRow = db
    .prepare(
      `SELECT COUNT(*) as cnt
       FROM verification_sessions
       WHERE qr_id = ? AND status = 'locked'`
    )
    .get(qrId) as { cnt: number };

  if (lockedSessionsRow.cnt >= 1 || failedRow.cnt >= 3) {
    reasons.push(
      `Prior batch-guessing or locked verification attempts recorded for this QR (${failedRow.cnt} failed attempt(s)).`
    );
  }

  return {
    suspiciousActivity: reasons.length > 0,
    reasons,
    priorSuccessCount,
    priorFailedCount: failedRow.cnt
  };
}
