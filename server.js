const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));

// DATABASE
const dbPath = process.env.DB_PATH || path.join(__dirname, 'windir.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

// EXISTING KEYS TABLE - PRESERVED
db.exec(`
CREATE TABLE IF NOT EXISTS keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT UNIQUE NOT NULL,
  label TEXT DEFAULT '',
  expires_at TEXT,
  created_at TEXT NOT NULL,
  revoked INTEGER DEFAULT 0,
  used_by TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner', 'admin')),
  created_at TEXT NOT NULL,
  disabled INTEGER DEFAULT 0
);
`);

// PASSWORD SECURITY
function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function passwordHash(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, storedHash) {
  const calculated = Buffer.from(passwordHash(password, salt), 'hex');
  const stored = Buffer.from(storedHash, 'hex');

  return stored.length === calculated.length &&
    crypto.timingSafeEqual(stored, calculated);
}

// CREATE INITIAL OWNER IF DATABASE HAS NO ADMINS
const adminCount = db.prepare(
  'SELECT COUNT(*) AS total FROM admins'
).get().total;

if (adminCount === 0) {
  const username = String(process.env.ADMIN_USER || 'owner').trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!password || password.length < 12) {
    console.error('Set ADMIN_PASSWORD with at least 12 characters to create OWNER.');
  } else {
    const salt = crypto.randomBytes(32).toString('hex');

    db.prepare(`
      INSERT INTO admins
      (username, password_hash, salt, role, created_at)
      VALUES (?, ?, ?, 'owner', ?)
    `).run(
      username,
      passwordHash(password, salt),
      salt,
      new Date().toISOString()
    );

    console.log('Initial OWNER account created:', username);
  }
}

// SESSIONS
const sessions = new Map();
const SESSION_DURATION = 8 * 60 * 60 * 1000;

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function auth(req, res, next) {
  const token = (req.headers.authorization || '')
    .replace(/^Bearer\s+/i, '');

  const session = sessions.get(token);

  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return res.status(401).json({ error: 'Admin login required' });
  }

  const admin = db.prepare(`
    SELECT id, username, role, disabled
    FROM admins WHERE id = ?
  `).get(session.adminId);

  if (!admin || admin.disabled) {
    sessions.delete(token);
    return res.status(401).json({ error: 'Account unavailable' });
  }

  req.admin = admin;
  req.sessionToken = token;
  next();
}

function ownerOnly(req, res, next) {
  if (req.admin.role !== 'owner') {
    return res.status(403).json({
      error: 'OWNER permission required'
    });
  }

  next();
}

// PROTECT PRIVATE FILES
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

// STATIC FILES
app.use(express.static(__dirname, {
  index: false,
  dotfiles: 'deny'
}));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// HEALTH
app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'WINDIR MODE server is running' });
});

// ADMIN LOGIN
app.post('/api/admin/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!username || !password) {
    return res.status(400).json({
      error: 'Username and password required'
    });
  }

  const admin = db.prepare(`
    SELECT * FROM admins
    WHERE username = ? AND disabled = 0
  `).get(username);

  if (
    !admin ||
    !verifyPassword(password, admin.salt, admin.password_hash)
  ) {
    return res.status(401).json({
      error: 'Incorrect username or password'
    });
  }

  const token = createToken();

  sessions.set(token, {
    adminId: admin.id,
    expiresAt: Date.now() + SESSION_DURATION
  });

  res.json({
    token,
    username: admin.username,
    role: admin.role
  });
});

// CURRENT ADMIN
app.get('/api/admin/me', auth, (req, res) => {
  res.json({
    id: req.admin.id,
    username: req.admin.username,
    role: req.admin.role
  });
});

// LOGOUT
app.post('/api/admin/logout', auth, (req, res) => {
  sessions.delete(req.sessionToken);
  res.json({ ok: true });
});

// LIST ADMINS - OWNER ONLY
app.get('/api/admin/users', auth, ownerOnly, (req, res) => {
  const users = db.prepare(`
    SELECT id, username, role, created_at, disabled
    FROM admins ORDER BY id ASC
  `).all();

  res.json(users);
});

// CREATE ADMIN - OWNER ONLY
app.post('/api/admin/users', auth, ownerOnly, (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username)) {
    return res.status(400).json({
      error: 'Username must be 3-30 characters'
    });
  }

  if (password.length < 12 || password.length > 128) {
    return res.status(400).json({
      error: 'Password must be 12-128 characters'
    });
  }

  const exists = db.prepare(
    'SELECT id FROM admins WHERE username = ?'
  ).get(username);

  if (exists) {
    return res.status(409).json({
      error: 'Username already exists'
    });
  }

  const salt = crypto.randomBytes(32).toString('hex');

  const result = db.prepare(`
    INSERT INTO admins
    (username, password_hash, salt, role, created_at)
    VALUES (?, ?, ?, 'admin', ?)
  `).run(
    username,
    passwordHash(password, salt),
    salt,
    new Date().toISOString()
  );

  res.json({
    ok: true,
    id: result.lastInsertRowid,
    username,
    role: 'admin'
  });
});

// DELETE ADMIN - OWNER ONLY
app.delete('/api/admin/users/:id', auth, ownerOnly, (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid admin ID' });
  }

  if (id === req.admin.id) {
    return res.status(400).json({
      error: 'You cannot delete your own account'
    });
  }

  const target = db.prepare(
    'SELECT id, role FROM admins WHERE id = ?'
  ).get(id);

  if (!target) {
    return res.status(404).json({ error: 'Admin not found' });
  }

  if (target.role === 'owner') {
    return res.status(403).json({
      error: 'OWNER accounts cannot be deleted here'
    });
  }

  db.prepare('DELETE FROM admins WHERE id = ?').run(id);

  // Invalidate all sessions belonging to deleted admin
  for (const [token, session] of sessions.entries()) {
    if (session.adminId === id) {
      sessions.delete(token);
    }
  }

  res.json({ ok: true });
});

// GENERATE KEY
app.post('/api/admin/keys', auth, (req, res, next) => {
  try {
    const days = Number(req.body.days || 7);
    const label = String(req.body.label || '').slice(0, 80);

    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      return res.status(400).json({
        error: 'Days must be 1–3650'
      });
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

// LIST KEYS
app.get('/api/admin/keys', auth, (req, res, next) => {
  try {
    const rows = db.prepare(`
      SELECT id, label, expires_at, created_at, revoked, used_by
      FROM keys ORDER BY id DESC LIMIT 200
    `).all();

    res.json(rows);
  } catch (error) {
    next(error);
  }
});

// REVOKE KEY
app.post('/api/admin/keys/:id/revoke', auth, (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid key ID' });
    }

    const result = db.prepare(
      'UPDATE keys SET revoked = 1 WHERE id = ?'
    ).run(id);

    res.json({ ok: result.changes > 0 });
  } catch (error) {
    next(error);
  }
});

// VERIFY KEY
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
      FROM keys WHERE key_hash = ?
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

app.post('/api/keys/verify', verifyKey);
app.post('/api/verify-key', verifyKey);

// 404
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.path
  });
});

// ERROR HANDLER
app.use((err, req, res, next) => {
  console.error('API error:', err);

  if (res.headersSent) return next(err);

  res.status(500).json({
    error: 'Internal server error'
  });
});

// START
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`WINDIR MODE running on port ${PORT}`);
});
