import express from 'express';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { createApiRouter } from './routes';

export interface BackendTestCaseResult {
  id: string;
  name: string;
  description: string;
  expectedStatus: string;
  actualStatus: string;
  passed: boolean;
  inputPayload: string;
  details: string;
  durationMs: number;
}

class CookieJar {
  private cookies = new Map<string, string>();

  updateFromHeaders(headers: Headers) {
    const raw = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() || [];
    for (const line of raw) {
      const firstPart = line.split(';')[0];
      const eq = firstPart.indexOf('=');
      if (eq === -1) continue;
      const name = firstPart.slice(0, eq).trim();
      const val = firstPart.slice(eq + 1).trim();
      if (!val || line.toLowerCase().includes('max-age=0')) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, val);
      }
    }
  }

  headerValue(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
}

async function apiReq(
  baseUrl: string,
  jar: CookieJar | null,
  method: string,
  route: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = {
    ...(extraHeaders || {})
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (jar && jar.headerValue()) {
    headers['Cookie'] = jar.headerValue();
  }
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (jar) {
    jar.updateFromHeaders(res.headers);
  }
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

export async function runIsolatedBackendTestSuite(): Promise<BackendTestCaseResult[]> {
  const tempDb = path.join(
    os.tmpdir(),
    `smartqr_suite_${Date.now()}_${Math.random().toString(16).slice(2)}.db`
  );

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', createApiRouter(tempDb));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  const results: BackendTestCaseResult[] = [];

  try {
    const adminJar = new CookieJar();
    const userJar = new CookieJar();

    // Fetch public sample QR
    const sampleRes = await apiReq(baseUrl, userJar, 'GET', '/demo/sample-qrs');
    const validQrPayload: string = sampleRes.json.validQrPayload;
    const tamperedQrPayload: string = sampleRes.json.tamperedQrPayload;
    const unregisteredQrPayload: string = sampleRes.json.unregisteredQrPayload;

    // 1. Stage 1 valid QR validation returns BATCH_REQUIRED without exposing batchNumber
    {
      const t0 = Date.now();
      const r = await apiReq(baseUrl, userJar, 'POST', '/verify/validate-qr', {
        rawPayload: validQrPayload
      });
      const noLeak =
        r.json.batchNumber === undefined &&
        r.json.manufacturingDate === undefined &&
        r.json.productName === undefined;
      results.push({
        id: 'TC-01',
        name: 'Stage 1 QR Validation & Zero Metadata Leak',
        description: 'Valid signed QR enters Stage 2 batch prompt without returning batchNumber or mfgDate.',
        expectedStatus: 'BATCH_REQUIRED',
        actualStatus: String(r.json.status),
        passed: r.status === 200 && r.json.status === 'BATCH_REQUIRED' && noLeak && Boolean(r.json.qrId),
        inputPayload: validQrPayload,
        details: noLeak
          ? `Validated QR ${r.json.qrId}; batch & product specs withheld pending Stage 2.`
          : 'Failed: Confidential product fields leaked in Stage 1.',
        durationMs: Date.now() - t0
      });
    }

    // 2. Stage 2 matching batch -> GENUINE + counts = 1
    {
      const t0 = Date.now();
      const r = await apiReq(baseUrl, userJar, 'POST', '/verify/submit-batch', {
        batchNumber: 'B001'
      });
      results.push({
        id: 'TC-02',
        name: 'Stage 2 Exact Batch Match -> Genuine',
        description: 'Submitting matching registered batch B001 returns GENUINE PRODUCT with counts & history.',
        expectedStatus: 'GENUINE',
        actualStatus: String(r.json.status),
        passed:
          r.status === 200 &&
          r.json.status === 'GENUINE' &&
          r.json.batchNumber === 'B001' &&
          r.json.totalScanAttempts === 1 &&
          r.json.successfulVerifications === 1,
        inputPayload: 'Batch: B001',
        details: `Result=${r.json.status}, Batch=${r.json.batchNumber}, Attempts=${r.json.totalScanAttempts}, Success=${r.json.successfulVerifications}`,
        durationMs: Date.now() - t0
      });
    }

    // 3. Unregistered QR rejected with UNRECOGNIZED_QR and no batch prompt
    {
      const t0 = Date.now();
      const r = await apiReq(baseUrl, userJar, 'POST', '/verify/validate-qr', {
        rawPayload: unregisteredQrPayload
      });
      results.push({
        id: 'TC-03',
        name: 'Unregistered QR Code Rejection',
        description: 'Unrecognized QR ID returns UNRECOGNIZED QR CODE with no batch prompt.',
        expectedStatus: 'UNRECOGNIZED_QR',
        actualStatus: String(r.json.status),
        passed: r.status === 200 && r.json.status === 'UNRECOGNIZED_QR' && !r.json.sessionToken,
        inputPayload: unregisteredQrPayload,
        details: r.json.message || 'Rejected as unrecognized.',
        durationMs: Date.now() - t0
      });
    }

    // 4. Tampered HMAC signature rejected
    {
      const t0 = Date.now();
      const r = await apiReq(baseUrl, userJar, 'POST', '/verify/validate-qr', {
        rawPayload: tamperedQrPayload
      });
      results.push({
        id: 'TC-04',
        name: 'Tampered QR Signature Detection',
        description: '1-char signature modification fails HMAC timingSafeEqual check.',
        expectedStatus: 'UNRECOGNIZED_QR',
        actualStatus: String(r.json.status),
        passed: r.status === 200 && r.json.status === 'UNRECOGNIZED_QR',
        inputPayload: tamperedQrPayload,
        details: 'Tampered HMAC rejected cleanly and logged in security_events.',
        durationMs: Date.now() - t0
      });
    }

    // 5. Malformed non-signed string rejected cleanly
    {
      const t0 = Date.now();
      const malformed = 'Product: Smart Battery; ID: SB001; Manufacturer: ABC Electronics';
      const r = await apiReq(baseUrl, userJar, 'POST', '/verify/validate-qr', {
        rawPayload: malformed
      });
      results.push({
        id: 'TC-05',
        name: 'Unsigned / Malformed Payload Rejection',
        description: 'Legacy unsigned or truncated QR strings are rejected without entering Stage 2.',
        expectedStatus: 'UNRECOGNIZED_QR',
        actualStatus: String(r.json.status),
        passed: r.status === 200 && r.json.status === 'UNRECOGNIZED_QR',
        inputPayload: malformed,
        details: 'Unsigned payload refused without incrementing product scan attempts.',
        durationMs: Date.now() - t0
      });
    }

    // 6. Wrong batch mismatch with retry & zero batch leakage
    {
      const t0 = Date.now();
      const jar6 = new CookieJar();
      await apiReq(baseUrl, jar6, 'POST', '/verify/validate-qr', {
        rawPayload: validQrPayload
      });
      const r = await apiReq(baseUrl, jar6, 'POST', '/verify/submit-batch', {
        batchNumber: 'WRONG_BATCH'
      });
      const noLeak = r.json.batchNumber === undefined && r.json.manufacturingDate === undefined;
      results.push({
        id: 'TC-06',
        name: 'Stage 2 Wrong Batch Mismatch & Zero Leak',
        description: 'Wrong batch returns BATCH_MISMATCH with 2 attempts left and hides real batch.',
        expectedStatus: 'BATCH_MISMATCH',
        actualStatus: String(r.json.status),
        passed:
          r.status === 200 &&
          r.json.status === 'BATCH_MISMATCH' &&
          r.json.attemptsRemaining === 2 &&
          noLeak,
        inputPayload: 'Batch: WRONG_BATCH',
        details: `Attempt ${r.json.attemptCount}/${r.json.maxAttempts}, remaining=${r.json.attemptsRemaining}, no batch leaked.`,
        durationMs: Date.now() - t0
      });

      // 7. Persistent session across refresh (GET /verify/session/current)
      const t1 = Date.now();
      const cur = await apiReq(baseUrl, jar6, 'GET', '/verify/session/current');
      results.push({
        id: 'TC-07',
        name: 'Attempt Persistence Across Page Refresh',
        description: 'GET /verify/session/current preserves attemptCount=1 and attemptsRemaining=2.',
        expectedStatus: 'BATCH_REQUIRED',
        actualStatus: String(cur.json.status),
        passed:
          cur.json.hasSession === true &&
          cur.json.attemptCount === 1 &&
          cur.json.attemptsRemaining === 2,
        inputPayload: 'GET /api/verify/session/current',
        details: `Restored session for ${cur.json.qrId}: attemptCount=${cur.json.attemptCount}, remaining=${cur.json.attemptsRemaining}`,
        durationMs: Date.now() - t1
      });

      // 8. 3-Attempt Maximum Lockout Enforcement (attempt 2 fail -> attempt 3 LOCKED)
      const t2 = Date.now();
      await apiReq(baseUrl, jar6, 'POST', '/verify/submit-batch', { batchNumber: 'BAD_2' });
      const r3 = await apiReq(baseUrl, jar6, 'POST', '/verify/submit-batch', { batchNumber: 'BAD_3' });
      const r4 = await apiReq(baseUrl, jar6, 'POST', '/verify/submit-batch', { batchNumber: 'B001' });
      results.push({
        id: 'TC-08',
        name: '3-Attempt Lockout Blocks Subsequent Valid Batch',
        description: '3rd incorrect batch locks session (423); even valid B001 is blocked while locked.',
        expectedStatus: 'LOCKED',
        actualStatus: `${r3.json.status} (${r3.status}) -> retry: ${r4.status}`,
        passed: r3.status === 423 && r3.json.status === 'LOCKED' && r4.status === 423,
        inputPayload: '3 wrong batches followed by B001',
        details: `Locked after attempt ${r3.json.attemptCount}/3; 4th submission returned HTTP ${r4.status}.`,
        durationMs: Date.now() - t2
      });
    }

    // 9. Admin Auth + Product Registration + Duplicate Activity Detection on Multi-Device Reuse
    {
      const t0 = Date.now();
      const unauth = await apiReq(baseUrl, null, 'GET', '/products');
      await apiReq(baseUrl, adminJar, 'POST', '/auth/login', {
        username: process.env.ADMIN_USERNAME || 'admin',
        password: process.env.ADMIN_PASSWORD || 'admin123'
      });
      const created = await apiReq(baseUrl, adminJar, 'POST', '/products', {
        productId: 'TST900',
        productName: 'Test Secure Module',
        manufacturer: 'SmartQR Labs',
        batchNumber: 'BT900',
        manufacturingDate: '2026-11-01'
      });
      results.push({
        id: 'TC-09',
        name: 'Admin RBAC & Signed QR Generation',
        description: 'Unauthenticated /products blocked (401); Admin creates product with signed QR & mfg date.',
        expectedStatus: '401 -> 201',
        actualStatus: `${unauth.status} -> ${created.status}`,
        passed:
          unauth.status === 401 &&
          created.status === 201 &&
          Boolean(created.json.product?.qrPayload),
        inputPayload: 'POST /api/products (TST900)',
        details: `Unauth HTTP ${unauth.status}; created ${created.json.product?.qrId} cleanly.`,
        durationMs: Date.now() - t0
      });

      // 10. Multi-device duplicate warning without false fake claim
      const tDup = Date.now();
      const qrPayloadNew = created.json.product.qrPayload;
      const dev1 = new CookieJar();
      const dev2 = new CookieJar();
      await apiReq(baseUrl, dev1, 'POST', '/verify/validate-qr', { rawPayload: qrPayloadNew }, {
        'User-Agent': 'Device-Alpha/1.0'
      });
      const firstOk = await apiReq(baseUrl, dev1, 'POST', '/verify/submit-batch', { batchNumber: 'BT900' }, {
        'User-Agent': 'Device-Alpha/1.0'
      });

      await apiReq(baseUrl, dev2, 'POST', '/verify/validate-qr', { rawPayload: qrPayloadNew }, {
        'User-Agent': 'Device-Beta/2.0'
      });
      const secondWarn = await apiReq(baseUrl, dev2, 'POST', '/verify/submit-batch', { batchNumber: 'BT900' }, {
        'User-Agent': 'Device-Beta/2.0'
      });

      results.push({
        id: 'TC-10',
        name: 'Suspicious Multi-Device Reuse Warning',
        description: 'Same QR verified from a 2nd distinct device flags GENUINE_DUPLICATE_WARNING without calling it fake.',
        expectedStatus: 'GENUINE -> GENUINE_DUPLICATE_WARNING',
        actualStatus: `${firstOk.json.status} -> ${secondWarn.json.status}`,
        passed:
          firstOk.json.status === 'GENUINE' &&
          secondWarn.json.status === 'GENUINE_DUPLICATE_WARNING' &&
          Array.isArray(secondWarn.json.suspiciousReasons) &&
          secondWarn.json.suspiciousReasons.length > 0,
        inputPayload: `QR ${created.json.product.qrId} across Device-Alpha & Device-Beta`,
        details: `Reasons: ${(secondWarn.json.suspiciousReasons || []).join(' | ')}`,
        durationMs: Date.now() - tDup
      });

      // 11. QR Revocation blocks further verification
      const tRev = Date.now();
      await apiReq(baseUrl, adminJar, 'PATCH', `/qr/${created.json.product.qrId}/status`, {
        status: 'revoked'
      });
      const revRes = await apiReq(baseUrl, userJar, 'POST', '/verify/validate-qr', {
        rawPayload: qrPayloadNew
      });
      results.push({
        id: 'TC-11',
        name: 'QR Revocation Enforcement',
        description: 'Revoked QR code cannot enter Stage 2 batch verification.',
        expectedStatus: 'REVOKED_QR',
        actualStatus: String(revRes.json.status),
        passed: revRes.status === 200 && revRes.json.status === 'REVOKED_QR',
        inputPayload: `PATCH /qr/${created.json.product.qrId}/status -> revoked`,
        details: revRes.json.message || 'Revoked QR blocked.',
        durationMs: Date.now() - tRev
      });
    }

    // 12. Dashboard statistics accurately distinguish valid batch submissions from invalid QR scans
    {
      const t0 = Date.now();
      const dash = await apiReq(baseUrl, userJar, 'GET', '/dashboard/stats');
      // On QR-8F72A91C + TST900: 1 genuine + 3 mismatch + 2 genuine = 6 verification logs; invalidQrEvents >= 4
      const exactValid = dash.json.totalScanAttempts === 6 && dash.json.successfulVerifications === 3;
      const secLogged = dash.json.invalidQrEvents >= 4;
      results.push({
        id: 'TC-12',
        name: 'Dashboard & Audit Count Integrity',
        description: 'Unrecognized/tampered QR scans increment securityEvents only, not valid batch attempt counters.',
        expectedStatus: 'ACCURATE_COUNTS',
        actualStatus: `attempts=${dash.json.totalScanAttempts}, success=${dash.json.successfulVerifications}, secEvents=${dash.json.invalidQrEvents}`,
        passed: dash.status === 200 && exactValid && secLogged,
        inputPayload: 'GET /api/dashboard/stats',
        details: `TotalAttempts=${dash.json.totalScanAttempts}, Success=${dash.json.successfulVerifications}, Failed=${dash.json.failedAttempts}, SecurityEvents=${dash.json.invalidQrEvents}`,
        durationMs: Date.now() - t0
      });
    }

    // 13. Registered QR Scan History & Prior Scan Alert Detection + Idempotency
    {
      const t0 = Date.now();
      const prodsRes = await apiReq(baseUrl, adminJar, 'GET', '/products');
      const ssProduct = (prodsRes.json.products || []).find((p: any) => p.productId === 'SS002');
      const ssPayload: string = ssProduct?.qrPayload || '';

      const s1Jar = new CookieJar();
      const event1 = `evt_${Date.now()}_1`;
      const scan1 = await apiReq(baseUrl, s1Jar, 'POST', '/verify/validate-qr', {
        rawPayload: ssPayload,
        scanEventId: event1
      });
      // Simulate accidental duplicate API retry with same scanEventId (must NOT log a second scan)
      const scan1Dup = await apiReq(baseUrl, s1Jar, 'POST', '/verify/validate-qr', {
        rawPayload: ssPayload,
        scanEventId: event1
      });
      // Complete 1st scan batch verification
      await apiReq(baseUrl, s1Jar, 'POST', '/verify/submit-batch', { batchNumber: 'B002' });

      // 2nd scan in a fresh session must see previousScanCount === 1 and return prior scan UTC timestamp
      const s2Jar = new CookieJar();
      const scan2 = await apiReq(baseUrl, s2Jar, 'POST', '/verify/validate-qr', {
        rawPayload: ssPayload,
        scanEventId: `evt_${Date.now()}_2`
      });

      const passed13 =
        Boolean(ssPayload) &&
        scan1.json.previousScanCount === 0 &&
        scan1Dup.json.deduplicated === true &&
        scan1Dup.json.previousScanCount === 0 &&
        scan2.json.status === 'BATCH_REQUIRED' &&
        scan2.json.previousScanCount === 1 &&
        Array.isArray(scan2.json.previousScans) &&
        scan2.json.previousScans.length === 1 &&
        scan2.json.previousScans[0].scanResult === 'GENUINE';

      results.push({
        id: 'TC-13',
        name: 'QR Scan History, Repeat Alert & Idempotency',
        description: 'First scan has 0 prior scans; duplicate scanEventId is deduplicated; second scan reports previousScanCount=1 before Stage 2 batch check.',
        expectedStatus: 'prev=0 (dedup) -> prev=1',
        actualStatus: `scan1=${scan1.json.previousScanCount}, dup=${Boolean(scan1Dup.json.deduplicated)}, scan2Prev=${scan2.json.previousScanCount}`,
        passed: passed13,
        inputPayload: `SS002 (${ssProduct?.qrId || 'missing'}) across 2 sessions + retry`,
        details: `Scan1 prior=${scan1.json.previousScanCount}, Retry deduplicated=${Boolean(scan1Dup.json.deduplicated)}, Scan2 prior=${scan2.json.previousScanCount} (${scan2.json.previousScans?.[0]?.scannedAt || 'n/a'}).`,
        durationMs: Date.now() - t0
      });
    }

    // 14. Independent Scan / Success / Failed Counters + Refresh Non-Duplication
    {
      const t0 = Date.now();
      const beforeDash = await apiReq(baseUrl, userJar, 'GET', '/dashboard/stats');
      // Refresh active session check (GET /verify/session/current) must NOT increment totalQrScans
      await apiReq(baseUrl, userJar, 'GET', '/verify/session/current');
      const afterDash = await apiReq(baseUrl, userJar, 'GET', '/dashboard/stats');
      const histRes = await apiReq(baseUrl, adminJar, 'GET', '/history');

      const passed14 =
        beforeDash.json.totalQrScans === afterDash.json.totalQrScans &&
        afterDash.json.totalQrScans === 6 &&
        afterDash.json.successfulVerifications === 4 &&
        afterDash.json.failedAttempts === 3 &&
        Array.isArray(histRes.json.qrScans) &&
        histRes.json.qrScans.length === 6;

      results.push({
        id: 'TC-14',
        name: 'Independent Scan/Success/Failed Counters & Refresh Safety',
        description: 'totalQrScans, successfulVerifications, and failedVerifications stay independent and unchanged on session refresh.',
        expectedStatus: 'scans=6, ok=4, fail=3',
        actualStatus: `scans=${afterDash.json.totalQrScans}, ok=${afterDash.json.successfulVerifications}, fail=${afterDash.json.failedAttempts}`,
        passed: passed14,
        inputPayload: 'GET /verify/session/current + GET /dashboard/stats + GET /history',
        details: `QR Scans=${afterDash.json.totalQrScans}, Successful=${afterDash.json.successfulVerifications}, Failed=${afterDash.json.failedAttempts}, HistoryRows=${histRes.json.qrScans?.length ?? 0}.`,
        durationMs: Date.now() - t0
      });
    }

    // 15. Removed /api/qr/generate endpoint + ESP32 atomic job claim (no double-dispatch)
    {
      const t0 = Date.now();
      const removedRes = await apiReq(baseUrl, adminJar, 'POST', '/qr/generate', {
        productId: 'SB001'
      });

      const espProd = await apiReq(baseUrl, adminJar, 'POST', '/products', {
        productId: 'ESP901',
        productName: 'ESP32 Hardware Verified Sensor',
        manufacturer: 'SmartQR Hardware Lab',
        batchNumber: 'BE901',
        manufacturingDate: '2026-11-10'
      });

      // Drain older TST900 pending job if present, then claim ESP901 and verify second claim is null
      let claimedTarget: any = null;
      for (let i = 0; i < 4; i++) {
        const c = await apiReq(baseUrl, adminJar, 'POST', '/esp32/jobs/claim', {
          deviceId: 'ESP32-TEST-1'
        });
        if (c.json.job?.productId === 'ESP901') {
          claimedTarget = c.json.job;
          break;
        } else if (c.json.job) {
          await apiReq(baseUrl, adminJar, 'POST', `/esp32/jobs/${c.json.job.jobId}/status`, {
            status: 'COMPLETED',
            deviceId: 'ESP32-TEST-1'
          });
        }
      }
      const secondClaim = await apiReq(baseUrl, adminJar, 'POST', '/esp32/jobs/claim', {
        deviceId: 'ESP32-TEST-2'
      });

      const passed15 =
        removedRes.status === 404 &&
        espProd.status === 201 &&
        espProd.json.generationJob?.status === 'PENDING' &&
        claimedTarget?.status === 'DISPATCHING' &&
        secondClaim.json.job === null;

      results.push({
        id: 'TC-15',
        name: 'Website QR Endpoint Removed & Atomic ESP32 Job Claim',
        description: 'POST /api/qr/generate returns 404; product registration auto-queues a PENDING ESP32 job; claim() atomically dispatches once without duplicate sending.',
        expectedStatus: '404 + PENDING -> DISPATCHING -> null',
        actualStatus: `qrGen=${removedRes.status}, claim1=${claimedTarget?.status}, claim2=${String(secondClaim.json.job)}`,
        passed: passed15,
        inputPayload: 'POST /qr/generate + POST /products (ESP901) + 2x POST /esp32/jobs/claim',
        details: `Legacy /qr/generate HTTP ${removedRes.status}; claimed job ${claimedTarget?.jobId} (${claimedTarget?.qrId}); second claim returned null.`,
        durationMs: Date.now() - t0
      });

      // 16. ESP32 Heartbeat, IN_PROGRESS -> COMPLETED Thermal Log, and Failed Job Retry
      const t1 = Date.now();
      await apiReq(baseUrl, adminJar, 'POST', '/esp32/heartbeat', {
        deviceId: 'ESP32-TEST-1',
        hotspotUrl: 'http://192.168.4.1',
        bridgeConnected: true,
        esp32Connected: true
      });
      const espStatus = await apiReq(baseUrl, userJar, 'GET', '/esp32/status');

      await apiReq(baseUrl, adminJar, 'POST', `/esp32/jobs/${claimedTarget.jobId}/status`, {
        status: 'IN_PROGRESS',
        deviceId: 'ESP32-TEST-1'
      });
      const doneRes = await apiReq(baseUrl, adminJar, 'POST', `/esp32/jobs/${claimedTarget.jobId}/status`, {
        status: 'COMPLETED',
        deviceId: 'ESP32-TEST-1'
      });
      const printsRes = await apiReq(baseUrl, adminJar, 'GET', '/prints');
      const hasThermalPrint = (printsRes.json.printLogs || []).some(
        (pl: any) => pl.qrId === claimedTarget.qrId && pl.format === 'THERMAL' && pl.printStatus === 'ESP32_PRINTED'
      );

      // Test FAILED -> retry creates a fresh PENDING job
      const reqFail = await apiReq(baseUrl, adminJar, 'POST', '/qr-jobs/request', {
        productId: 'ESP901'
      });
      const failJobId = reqFail.json.job?.jobId;
      await apiReq(baseUrl, adminJar, 'POST', '/esp32/jobs/claim', { deviceId: 'ESP32-TEST-1' });
      await apiReq(baseUrl, adminJar, 'POST', `/esp32/jobs/${failJobId}/status`, {
        status: 'FAILED',
        deviceId: 'ESP32-TEST-1',
        errorMessage: 'Thermal printer paper out'
      });
      const retryRes = await apiReq(baseUrl, adminJar, 'POST', `/qr-jobs/${failJobId}/retry`);

      const passed16 =
        espStatus.json.esp32Connected === true &&
        espStatus.json.hotspotUrl === 'http://192.168.4.1' &&
        doneRes.json.job?.status === 'COMPLETED' &&
        hasThermalPrint &&
        retryRes.status === 201 &&
        retryRes.json.job?.status === 'PENDING' &&
        retryRes.json.job?.jobId !== failJobId;

      results.push({
        id: 'TC-16',
        name: 'ESP32 Hotspot Status, Thermal Print Log & Retry Workflow',
        description: 'Heartbeat updates ESP32 hotspot status; COMPLETED logs THERMAL/ESP32_PRINTED; FAILED job retries cleanly with a new PENDING job.',
        expectedStatus: 'COMPLETED + THERMAL + RETRY_PENDING',
        actualStatus: `esp32=${espStatus.json.esp32Connected}, thermal=${hasThermalPrint}, retry=${retryRes.json.job?.status}`,
        passed: passed16,
        inputPayload: `Job ${claimedTarget?.jobId} + Hotspot Heartbeat + Retry ${failJobId}`,
        details: `ESP32 hotspot=${espStatus.json.hotspotUrl}, thermalLog=${hasThermalPrint}, retryJob=${retryRes.json.job?.jobId} (${retryRes.json.job?.status}).`,
        durationMs: Date.now() - t1
      });
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        if (fs.existsSync(`${tempDb}${suffix}`)) {
          fs.unlinkSync(`${tempDb}${suffix}`);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  return results;
}
