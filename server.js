
const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const app = express();
const db = new Database(process.env.DB_PATH || 'windir.db');

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS keys (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 key_hash TEXT UNIQUE NOT NULL,
 label TEXT DEFAULT '',
 expires_at TEXT,
 created_at TEXT NOT NULL,
 revoked INTEGER DEFAULT 0,
 used_by TEXT DEFAULT ''
)
`);

app.use(express.json());

// CORREGIDO: tus archivos están en la raíz
app.use(express.static(__dirname));

app.get('/', (req, res) => {
 res.sendFile(path.join(__dirname, 'index.html'));
});

const sessions = new Map();

const adminPassword = process.env.ADMIN_PASSWORD;
const sessionSecret = process.env.SESSION_SECRET;

if (!adminPassword || !sessionSecret) {
 console.warn('Set ADMIN_PASSWORD and SESSION_SECRET environment variables!');
}

function token() {
 return crypto.randomBytes(32).toString('hex');
}

function hash(s) {
 return crypto.createHash('sha256').update(s).digest('hex');
}

function auth(req, res, next) {
 const t = (req.headers.authorization || '').replace(/^Bearer /, '');

 if (!t || !sessions.has(t)) {
  return res.status(401).json({ error: 'Admin login required' });
 }

 next();
}

// LOGIN ADMIN
app.post('/api/admin/login', (req, res) => {
 if (!adminPassword || req.body.password !== adminPassword) {
  return res.status(401).json({ error: 'Incorrect password' });
 }

 const t = token();
 sessions.set(t, Date.now());

 res.json({ token: t });
});

// LOGOUT ADMIN
app.post('/api/admin/logout', auth, (req, res) => {
 sessions.delete(
  (req.headers.authorization || '').replace(/^Bearer /, '')
 );

 res.json({ ok: true });
});

// GENERAR KEY
app.post('/api/admin/keys', auth, (req, res) => {
 const days = Number(req.body.days || 7);
 const label = String(req.body.label || '').slice(0, 80);

 if (!Number.isInteger(days) || days < 1 || days > 3650) {
  return res.status(400).json({ error: 'Days must be 1–3650' });
 }

 const key = 'WINDIR-' +
  crypto.randomBytes(12).toString('hex').toUpperCase();

 const expires = new Date(
  Date.now() + days * 86400000
 ).toISOString();

 db.prepare(`
  INSERT INTO keys(key_hash,label,expires_at,created_at)
  VALUES(?,?,?,?)
 `).run(hash(key), label, expires, new Date().toISOString());

 res.json({ key, expires_at: expires });
});

// LISTAR KEYS
app.get('/api/admin/keys', auth, (req, res) => {
 res.json(
  db.prepare(`
   SELECT id,label,expires_at,created_at,revoked,used_by
   FROM keys ORDER BY id DESC LIMIT 200
  `).all()
 );
});

// REVOCAR KEY
app.post('/api/admin/keys/:id/revoke', auth, (req, res) => {
 const result = db.prepare(
  'UPDATE keys SET revoked=1 WHERE id=?'
 ).run(req.params.id);

 res.json({ ok: result.changes > 0 });
});

// VERIFICAR KEY
app.post('/api/verify-key', (req, res) => {
 const key = String(req.body.key || '');

 if (!key) {
  return res.status(400).json({ valid: false });
 }

 const record = db.prepare(
  'SELECT expires_at,revoked FROM keys WHERE key_hash=?'
 ).get(hash(key));

 if (!record || record.revoked ||
     new Date(record.expires_at) < new Date()) {
  return res.json({ valid: false });
 }

 res.json({ valid: true, expires_at: record.expires_at });
});

// INICIAR SERVIDOR
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
 console.log(`WINDIR MODE running on port ${PORT}`);
});
