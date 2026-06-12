const path = require('path');
const fs = require('fs');

let Database = null;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.warn('better-sqlite3 not available; SQLite helpers will be disabled until dependency is installed.');
}

let db = null;

function init(userDataPath) {
  if (!Database) return false;
  const dbDir = path.join(userDataPath || '.', 'data');
  try { fs.mkdirSync(dbDir, { recursive: true }); } catch (e) { /* ignore */ }
  const dbPath = path.join(dbDir, 'vd-overlay-tools.db');
  db = new Database(dbPath);
  // Simple license_keys cache table
  db.exec(`
    CREATE TABLE IF NOT EXISTS license_keys (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE,
      key_type TEXT,
      used INTEGER DEFAULT 0,
      used_at TEXT,
      activated_device_id TEXT,
      activated_at TEXT,
      updated_at TEXT
    );
  `);
  return true;
}

function close() {
  if (db) try { db.close(); } catch (e) { /* ignore */ }
  db = null;
}

function upsertLicense(record) {
  if (!db) throw new Error('SQLite not initialized');
  const stmt = db.prepare(`INSERT INTO license_keys (id,key,key_type,used,used_at,activated_device_id,activated_at,updated_at)
    VALUES (@id,@key,@key_type,@used,@used_at,@activated_device_id,@activated_at,@updated_at)
    ON CONFLICT(id) DO UPDATE SET
      key=excluded.key,
      key_type=excluded.key_type,
      used=excluded.used,
      used_at=excluded.used_at,
      activated_device_id=excluded.activated_device_id,
      activated_at=excluded.activated_at,
      updated_at=excluded.updated_at;`);
  stmt.run({
    id: String(record.id || ''),
    key: String(record.key || ''),
    key_type: String(record.key_type || ''),
    used: record.used ? 1 : 0,
    used_at: record.used_at || null,
    activated_device_id: record.activated_device_id || record.activated_device || null,
    activated_at: record.activated_at || null,
    updated_at: new Date().toISOString(),
  });
}

function getByKey(key) {
  if (!db) throw new Error('SQLite not initialized');
  const stmt = db.prepare('SELECT * FROM license_keys WHERE key = ? LIMIT 1');
  return stmt.get(String(key || '')) || null;
}

module.exports = { init, close, upsertLicense, getByKey };
