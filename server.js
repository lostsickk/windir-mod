
const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));

// BASE DE DATOS
const dbPath = process.env.DB_PATH || path.join(__dirname, 'windir.db');
const db = new Database(dbPath);

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

const sessions = new Map();
const adminPassword = process.env.ADMIN_PASSWORD;

function token() {
  return crypto.randomBytes(32).toString('hex');
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// AUTENTICACIÓN ADMIN
function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

  if (!t || !sessions.has(t)) {
    return res.status(401).json({ error: 'Admin login required' });
  }

  next();
}

// PROTEGER ARCHIVOS INTERNOS
app.use((req, res, next) => {
  const filename = path.basename(req.path).toLowerCase();

  const blocked = [
    'server.js',
    'package.json',
    'package-lock.json',
    'windir.db',
    'windir.db-wal',
    'windir.db-shm'
  ];

  if (
    blocked.includes(filename) ||
    filename.startsWith('.env') ||
    /\.(sqlite|sqlite3|db)$/i.test(filename)
  ) {
    return res.sendStatus(404);
  }

  next();
});

// ARCHIVOS DE LA PÁGINA
app.use(express.static(__dirname, {
  index: false,
  dotfiles: 'deny'
}));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// COMPROBAR SERVIDOR
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    message: 'WINDIR MODE server is running'
  });
});

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
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  sessions.delete(t);

  res.json({ ok: true });
});

// GENERAR KEY
app.post('/api/admin/keys', auth, (req, res, next) => {
  try {
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
      INSERT INTO keys (key_hash, label, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(hash(key), label, expires, new Date().toISOString());

    res.json({ key, expires_at: expires });
  } catch (error) {
    next(error);
  }
});

// LISTAR KEYS
app.get('/api/admin/keys', auth, (req, res, next) => {
  try {
    const rows = db.prepare(`
      SELECT id, label, expires_at, created_at, revoked, used_by
      FROM keys
      ORDER BY id DESC
      LIMIT 200
    `).all();

    res.json(rows);
  } catch (error) {
    next(error);
  }
});

// REVOCAR KEY
app.post('/api/admin/keys/:id/revoke', auth, (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid key id' });
    }

    const result = db.prepare(
      'UPDATE keys SET revoked = 1 WHERE id = ?'
    ).run(id);

    res.json({ ok: result.changes > 0 });
  } catch (error) {
    next(error);
  }
});

// VERIFICAR KEY
function verifyKey(req, res, next) {
  try {
    const key = String(
      (req.body && req.body.key) || ''
    ).trim();

    if (!key) {
      return res.status(400).json({
        valid: false,
        message: 'Enter a key'
      });
    }

    const record = db.prepare(`
      SELECT expires_at, revoked
      FROM keys
      WHERE key_hash = ?
    `).get(hash(key));

    if (!record || record.revoked) {
      return res.json({
        valid: false,
        message: 'Invalid or revoked key'
      });
    }

    if (
      !record.expires_at ||
      Date.now() > Date.parse(record.expires_at)
    ) {
      return res.json({
        valid: false,
        message: 'Key expired'
      });
    }

    res.json({
      valid: true,
      message: 'Key verified — access granted',
      expires_at: record.expires_at
    });
  } catch (error) {
    next(error);
  }
}

// LAS DOS RUTAS COMPATIBLES CON app.js
app.post('/api/keys/verify', verifyKey);
app.post('/api/verify-key', verifyKey);

// RUTA NO ENCONTRADA
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.path
  });
});

// MANEJO DE ERRORES
app.use((err, req, res, next) => {
  console.error('API error:', err);

  if (res.headersSent) return next(err);

  res.status(500).json({
    error: 'Internal server error'
  });
});

// INICIAR SERVIDOR
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`WINDIR MODE running on port ${PORT}`);
});
