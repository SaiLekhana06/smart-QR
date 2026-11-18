import Database from 'better-sqlite3';
import path from 'path';
import { buildSignedQrPayload, generateSecureToken, generateUid } from './crypto';

let dbInstance: Database.Database | null = null;

export function getDb(customPath?: string): Database.Database {
  if (dbInstance && !customPath) return dbInstance;

  const dbPath =
    customPath ||
    process.env.SMARTQR_DB_PATH ||
    path.resolve(process.cwd(), 'smartqr.db');

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);
  seedInitialDataIfEmpty(db);

  if (!customPath) {
    dbInstance = db;
  }
  return db;
}

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_unique_id TEXT NOT NULL UNIQUE,
      product_name TEXT NOT NULL,
      manufacturer TEXT NOT NULL,
      batch_number TEXT NOT NULL,
      manufacturing_date TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_products_unique_id ON products(product_unique_id);
    CREATE INDEX IF NOT EXISTS idx_products_batch_number ON products(batch_number);

    CREATE TABLE IF NOT EXISTS qr_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      qr_id TEXT NOT NULL UNIQUE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      token_nonce TEXT NOT NULL,
      payload_text TEXT NOT NULL,
      hmac_signature TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'revoked')) DEFAULT 'active',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_qr_codes_qr_id ON qr_codes(qr_id);
    CREATE INDEX IF NOT EXISTS idx_qr_codes_product_id ON qr_codes(product_id);
    CREATE INDEX IF NOT EXISTS idx_qr_codes_status ON qr_codes(status);

    CREATE TABLE IF NOT EXISTS verification_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_token TEXT NOT NULL UNIQUE,
      qr_id TEXT NOT NULL REFERENCES qr_codes(qr_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL CHECK(status IN ('active', 'successful', 'locked', 'expired')) DEFAULT 'active',
      client_fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      locked_until TEXT,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token ON verification_sessions(session_token);
    CREATE INDEX IF NOT EXISTS idx_sessions_qr_fp ON verification_sessions(qr_id, client_fingerprint, status);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON verification_sessions(status);

    CREATE TABLE IF NOT EXISTS verification_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      log_uid TEXT NOT NULL UNIQUE,
      qr_id TEXT NOT NULL REFERENCES qr_codes(qr_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      session_token TEXT NOT NULL REFERENCES verification_sessions(session_token) ON DELETE CASCADE,
      attempt_number INTEGER NOT NULL,
      result TEXT NOT NULL CHECK(result IN ('GENUINE', 'GENUINE_DUPLICATE_WARNING', 'BATCH_MISMATCH', 'LOCKED')),
      suspicious_activity INTEGER NOT NULL DEFAULT 0,
      suspicious_reasons TEXT NOT NULL DEFAULT '[]',
      client_fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_vlogs_qr_id ON verification_logs(qr_id);
    CREATE INDEX IF NOT EXISTS idx_vlogs_product_id ON verification_logs(product_id);
    CREATE INDEX IF NOT EXISTS idx_vlogs_session ON verification_logs(session_token);
    CREATE INDEX IF NOT EXISTS idx_vlogs_created_at ON verification_logs(created_at);

    CREATE TABLE IF NOT EXISTS security_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_uid TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL CHECK(event_type IN ('UNRECOGNIZED_QR', 'INVALID_SIGNATURE', 'MODIFIED_PAYLOAD', 'REVOKED_QR', 'RATE_LIMITED', 'SESSION_ABUSE')),
      qr_id_attempted TEXT,
      payload_hash TEXT NOT NULL,
      details TEXT NOT NULL,
      client_fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sec_events_type ON security_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_sec_events_created ON security_events(created_at);

    CREATE TABLE IF NOT EXISTS print_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      print_uid TEXT NOT NULL UNIQUE,
      qr_id TEXT NOT NULL REFERENCES qr_codes(qr_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      format TEXT NOT NULL DEFAULT 'PNG',
      print_status TEXT NOT NULL DEFAULT 'GENERATED',
      operator_name TEXT NOT NULL DEFAULT 'Admin',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_print_logs_qr_id ON print_logs(qr_id);
    CREATE INDEX IF NOT EXISTS idx_print_logs_created ON print_logs(created_at);

    CREATE TABLE IF NOT EXISTS qr_scan_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_unique_id TEXT NOT NULL,
      qr_id TEXT,
      scanned_at TEXT NOT NULL,
      session_id TEXT NOT NULL,
      scan_result TEXT NOT NULL DEFAULT 'SCANNED',
      scan_event_id TEXT UNIQUE,
      client_fingerprint TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_qsh_product_uid ON qr_scan_history(product_unique_id);
    CREATE INDEX IF NOT EXISTS idx_qsh_session_id ON qr_scan_history(session_id);
    CREATE INDEX IF NOT EXISTS idx_qsh_scanned_at ON qr_scan_history(scanned_at);

    CREATE TABLE IF NOT EXISTS qr_generation_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_uid TEXT NOT NULL UNIQUE,
      qr_id TEXT NOT NULL REFERENCES qr_codes(qr_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      product_unique_id TEXT NOT NULL,
      payload_text TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('PENDING', 'DISPATCHING', 'IN_PROGRESS', 'COMPLETED', 'FAILED')) DEFAULT 'PENDING',
      device_id TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL,
      dispatched_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_qgj_status ON qr_generation_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_qgj_qr_id ON qr_generation_jobs(qr_id);
    CREATE INDEX IF NOT EXISTS idx_qgj_product_id ON qr_generation_jobs(product_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_qgj_active_qr
      ON qr_generation_jobs(qr_id)
      WHERE status IN ('PENDING', 'DISPATCHING', 'IN_PROGRESS');

    CREATE TABLE IF NOT EXISTS esp32_bridge_status (
      device_id TEXT PRIMARY KEY,
      hotspot_url TEXT,
      bridge_connected INTEGER NOT NULL DEFAULT 0,
      esp32_connected INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT NOT NULL,
      last_error TEXT,
      firmware_info TEXT
    );
  `);

  const bridgeCols = db
    .prepare('PRAGMA table_info(esp32_bridge_status)')
    .all() as Array<{ name: string }>;
  if (!bridgeCols.some((c) => c.name === 'hotspot_url')) {
    db.exec('ALTER TABLE esp32_bridge_status ADD COLUMN hotspot_url TEXT;');
  }
}

export const SAMPLE_SEED_PRODUCTS = [
  {
    productUniqueId: 'SB001',
    productName: 'Smart Battery',
    manufacturer: 'ABC Electronics',
    batchNumber: 'B001',
    manufacturingDate: '2026-10-01',
    notes: 'Primary reference lithium battery pack - authorized batch.',
    defaultQrId: 'QR-8F72A91C'
  },
  {
    productUniqueId: 'SS002',
    productName: 'Smart Sensor',
    manufacturer: 'XYZ Electronics',
    batchNumber: 'B002',
    manufacturingDate: '2026-10-05',
    notes: 'Industrial IoT environmental telemetry sensor.',
    defaultQrId: 'QR-4B19D30E'
  },
  {
    productUniqueId: 'SC003',
    productName: 'Smart Controller',
    manufacturer: 'Tech Solutions',
    batchNumber: 'B003',
    manufacturingDate: '2026-10-10',
    notes: 'ARM Cortex embedded telemetry master controller.',
    defaultQrId: 'QR-9C51E74A'
  }
];

export function seedInitialDataIfEmpty(db: Database.Database): void {
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM products').get() as { cnt: number };
  if (countRow.cnt > 0) return;

  const insertProduct = db.prepare(`
    INSERT INTO products (product_unique_id, product_name, manufacturer, batch_number, manufacturing_date, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertQr = db.prepare(`
    INSERT INTO qr_codes (qr_id, product_id, token_nonce, payload_text, hmac_signature, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?)
  `);
  const insertPrint = db.prepare(`
    INSERT INTO print_logs (print_uid, qr_id, product_id, format, print_status, operator_name, created_at)
    VALUES (?, ?, ?, 'SVG', 'GENERATED', 'System Seed', ?)
  `);

  const now = new Date().toISOString();

  const seedTx = db.transaction(() => {
    for (const item of SAMPLE_SEED_PRODUCTS) {
      const info = insertProduct.run(
        item.productUniqueId,
        item.productName,
        item.manufacturer,
        item.batchNumber,
        item.manufacturingDate,
        item.notes,
        now
      );
      const productId = Number(info.lastInsertRowid);
      const nonce = generateSecureToken(12);
      const { payloadText, hmacSignature } = buildSignedQrPayload(
        item.defaultQrId,
        item.productUniqueId,
        nonce
      );
      insertQr.run(item.defaultQrId, productId, nonce, payloadText, hmacSignature, now);
      insertPrint.run(generateUid('PRT'), item.defaultQrId, productId, now);
    }
  });

  seedTx();
}
