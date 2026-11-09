"use strict";

const express = require("express");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const net = require("net");

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));

/* =========================================
   DATABASE
========================================= */

const dbPath = process.env.DB_PATH || path.join(__dirname, "windir.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

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
  role TEXT NOT NULL CHECK(role IN ('OWNER', 'ADMIN')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS key_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  ip TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  revoked INTEGER DEFAULT 0,
  UNIQUE(key_id, device_id),
  FOREIGN KEY(key_id) REFERENCES keys(id)
);
`);

/* Migration: preserve existing keys */

const keyColumns = db.pragma("table_info(keys)");

if (!keyColumns.some(column => column.name === "max_devices")) {
  db.exec(`
    ALTER TABLE keys
    ADD COLUMN max_devices INTEGER NOT NULL DEFAULT 1
  `);
}

/* =========================================
   SECURITY
========================================= */

const sessions = new Map();
const SESSION_DURATION = 12 * 60 * 60 * 1000;

function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashKey(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

function makePasswordHash(password, salt) {
  return crypto
    .scryptSync(password, salt, 64)
    .toString("hex");
}

function verifyPassword(password, salt, storedHash) {
  try {
    const actual = Buffer.from(
      makePasswordHash(password, salt),
      "hex"
    );

    const expected = Buffer.from(storedHash, "hex");

    return (
      actual.length === expected.length &&
      crypto.timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
}

function createAdmin(username, password, role) {
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = makePasswordHash(password, salt);

  return db.prepare(`
    INSERT INTO admins (
      username,
      password_hash,
      salt,
      role,
      created_at
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(
    username,
    passwordHash,
    salt,
    role,
    new Date().toISOString()
  );
}

/* =========================================
   INITIAL OWNER
========================================= */

const adminCount = db.prepare(
  "SELECT COUNT(*) AS total FROM admins"
).get().total;

if (adminCount === 0) {
  const ownerUser = String(process.env.ADMIN_USER || "").trim();
  const ownerPassword = String(process.env.ADMIN_PASSWORD || "");

  if (
    /^[a-zA-Z0-9_.-]{3,30}$/.test(ownerUser) &&
    ownerPassword.length >= 12
  ) {
    createAdmin(ownerUser, ownerPassword, "OWNER");
    console.log("Initial OWNER account created.");
  } else {
    console.warn(
      "No OWNER exists. Configure ADMIN_USER and ADMIN_PASSWORD in Render."
    );
  }
}

/* =========================================
   ADMIN AUTHENTICATION
========================================= */

function auth(req, res, next) {
  const token = String(req.headers.authorization || "")
    .replace(/^Bearer\s+/i, "");

  const session = sessions.get(token);

  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);

    return res.status(401).json({
      ok: false,
      error: "Admin login required"
    });
  }

  const admin = db.prepare(`
    SELECT id, username, role
    FROM admins
    WHERE id = ?
  `).get(session.adminId);

  if (!admin) {
    sessions.delete(token);

    return res.status(401).json({
      ok: false,
      error: "Admin account unavailable"
    });
  }

  req.admin = admin;
  req.sessionToken = token;

  next();
}

function ownerOnly(req, res, next) {
  if (!req.admin || req.admin.role !== "OWNER") {
    return res.status(403).json({
      ok: false,
      error: "OWNER permission required"
    });
  }

  next();
}

/* =========================================
   PROTECT PRIVATE FILES
========================================= */

app.use((req, res, next) => {
  const filename = path.basename(req.path).toLowerCase();

  const blocked = [
    "server.js",
    "package.json",
    "package-lock.json",
    "windir.db",
    "windir.db-wal",
    "windir.db-shm"
  ];

  if (
    blocked.includes(filename) ||
    req.path.includes("/.git") ||
    req.path.includes("/node_modules") ||
    filename.startsWith(".env") ||
    /\.(sqlite|sqlite3|db)$/i.test(filename)
  ) {
    return res.sendStatus(404);
  }

  next();
});

/* =========================================
   WEBSITE FILES
========================================= */

app.use(express.static(__dirname, {
  index: false,
  dotfiles: "deny"
}));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/activate", (req, res, next) => {
  const candidates = [
    path.join(__dirname, "activate.html"),
    path.join(__dirname, "activate", "index.html")
  ];

  const page = candidates.find(file => fs.existsSync(file));

  if (page) return res.sendFile(page);

  next();
});

/* =========================================
   HEALTH CHECK
========================================= */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "WINDIR PROXY server is running"
  });
});

/* =========================================
   ADMIN LOGIN
========================================= */

app.post("/api/admin/login", (req, res) => {
  const body = req.body || {};

  const username = String(body.username || "").trim();
  const password = String(body.password || "");

  const admin = db.prepare(`
    SELECT *
    FROM admins
    WHERE username = ? COLLATE NOCASE
  `).get(username);

  if (
    !admin ||
    !verifyPassword(password, admin.salt, admin.password_hash)
  ) {
    return res.status(401).json({
      ok: false,
      error: "Incorrect username or password"
    });
  }

  const token = makeToken();

  sessions.set(token, {
    adminId: admin.id,
    expiresAt: Date.now() + SESSION_DURATION
  });

  res.json({
    ok: true,
    token,
    user: {
      id: admin.id,
      username: admin.username,
      role: admin.role
    },
    username: admin.username,
    role: admin.role
  });
});

/* =========================================
   CURRENT ADMIN
========================================= */

app.get("/api/admin/me", auth, (req, res) => {
  res.json({
    ok: true,
    user: {
      id: req.admin.id,
      username: req.admin.username,
      role: req.admin.role
    }
  });
});

/* =========================================
   ADMIN LOGOUT
========================================= */

app.post("/api/admin/logout", auth, (req, res) => {
  sessions.delete(req.sessionToken);

  res.json({ ok: true });
});

/* =========================================
   CREATE ADMIN - OWNER ONLY
========================================= */

app.post("/api/admin/users", auth, ownerOnly, (req, res) => {
  const body = req.body || {};

  const username = String(body.username || "").trim();
  const password = String(body.password || "");

  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) {
    return res.status(400).json({
      ok: false,
      error: "Username must be 3-30 characters"
    });
  }

  if (password.length < 12 || password.length > 200) {
    return res.status(400).json({
      ok: false,
      error: "Password must contain at least 12 characters"
    });
  }

  try {
    createAdmin(username, password, "ADMIN");

    res.json({
      ok: true,
      message: "Administrator created"
    });

  } catch (error) {
    if (String(error.code).includes("SQLITE_CONSTRAINT")) {
      return res.status(409).json({
        ok: false,
        error: "Username already exists"
      });
    }

    throw error;
  }
});

/* =========================================
   LIST ADMINS - OWNER ONLY
========================================= */

app.get("/api/admin/users", auth, ownerOnly, (req, res) => {
  const users = db.prepare(`
    SELECT id, username, role, created_at
    FROM admins
    ORDER BY id ASC
  `).all();

  res.json(users);
});

/* =========================================
   DELETE ADMIN - OWNER ONLY
========================================= */

app.delete("/api/admin/users/:id", auth, ownerOnly, (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({
      ok: false,
      error: "Invalid admin id"
    });
  }

  const target = db.prepare(`
    SELECT id, role
    FROM admins
    WHERE id = ?
  `).get(id);

  if (!target) {
    return res.status(404).json({
      ok: false,
      error: "Administrator not found"
    });
  }

  if (target.role === "OWNER" || target.id === req.admin.id) {
    return res.status(403).json({
      ok: false,
      error: "You cannot delete the OWNER account"
    });
  }

  db.prepare("DELETE FROM admins WHERE id = ?").run(id);

  for (const [token, session] of sessions.entries()) {
    if (session.adminId === id) {
      sessions.delete(token);
    }
  }

  res.json({ ok: true });
});

/* =========================================
   GENERATE KEY
========================================= */

app.post("/api/admin/keys", auth, (req, res) => {
  const body = req.body || {};

  const days = Number(body.days || 7);
  const maxDevices = Number(body.maxDevices ?? 1);
  const label = String(body.label || "").trim().slice(0, 80);

  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    return res.status(400).json({
      ok: false,
      error: "Days must be between 1 and 3650"
    });
  }

  if (
    !Number.isInteger(maxDevices) ||
    maxDevices < 0 ||
    maxDevices > 100
  ) {
    return res.status(400).json({
      ok: false,
      error: "Devices must be 0 or between 1 and 100"
    });
  }

  const key = "WINDIR-" +
    crypto.randomBytes(12).toString("hex").toUpperCase();

  const expires = new Date(
    Date.now() + days * 86400000
  ).toISOString();

  const result = db.prepare(`
    INSERT INTO keys (
      key_hash,
      label,
      expires_at,
      created_at,
      max_devices
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(
    hashKey(key),
    label,
    expires,
    new Date().toISOString(),
    maxDevices
  );

  res.json({
    ok: true,
    key,
    id: result.lastInsertRowid,
    expires_at: expires,
    max_devices: maxDevices
  });
});

/* =========================================
   LIST KEYS
========================================= */

app.get("/api/admin/keys", auth, (req, res) => {
  const rows = db.prepare(`
    SELECT
      k.id,
      k.label,
      k.expires_at,
      k.created_at,
      k.revoked,
      k.max_devices,
      (
        SELECT COUNT(*)
        FROM key_devices d
        WHERE d.key_id = k.id
        AND d.revoked = 0
      ) AS devices_used
    FROM keys k
    ORDER BY k.id DESC
    LIMIT 200
  `).all();

  res.json(rows);
});

/* =========================================
   REVOKE KEY
========================================= */

app.post("/api/admin/keys/:id/revoke", auth, (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({
      ok: false,
      error: "Invalid key id"
    });
  }

  const result = db.prepare(`
    UPDATE keys
    SET revoked = 1
    WHERE id = ?
  `).run(id);

  if (!result.changes) {
    return res.status(404).json({
      ok: false,
      error: "Key not found"
    });
  }

  res.json({ ok: true });
});

/* =========================================
   LIST DEVICES FOR A KEY
========================================= */

app.get("/api/admin/keys/:id/devices", auth, (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({
      ok: false,
      error: "Invalid key id"
    });
  }

  const devices = db.prepare(`
    SELECT
      id,
      device_id,
      ip,
      created_at,
      last_seen,
      revoked
    FROM key_devices
    WHERE key_id = ?
    ORDER BY id DESC
  `).all(id);

  res.json(devices);
});

/* =========================================
   REMOVE / REVOKE DEVICE
========================================= */

app.delete(
  "/api/admin/keys/:id/devices/:deviceId",
  auth,
  (req, res) => {
    const id = Number(req.params.id);
    const deviceId = String(req.params.deviceId || "");

    if (!Number.isInteger(id) || id < 1 || !deviceId) {
      return res.status(400).json({
        ok: false,
        error: "Invalid device information"
      });
    }

    const result = db.prepare(`
      UPDATE key_devices
      SET revoked = 1
      WHERE key_id = ?
      AND device_id = ?
      AND revoked = 0
    `).run(id, deviceId);

    if (!result.changes) {
      return res.status(404).json({
        ok: false,
        error: "Device not found or already revoked"
      });
    }

    res.json({ ok: true });
  }
);

/* =========================================
   VERIFY CUSTOMER KEY
   Every device is registered on first use.
   Remember my key only saves the key locally.
========================================= */

const registerDevice = db.transaction((record, deviceId, ip) => {
  const existing = db.prepare(`
    SELECT id, revoked
    FROM key_devices
    WHERE key_id = ?
    AND device_id = ?
  `).get(record.id, deviceId);

  if (existing && existing.revoked) {
    return {
      success: false,
      error: "This device has been revoked"
    };
  }

  if (existing) {
    db.prepare(`
      UPDATE key_devices
      SET ip = ?, last_seen = ?
      WHERE key_id = ?
      AND device_id = ?
    `).run(
      ip,
      new Date().toISOString(),
      record.id,
      deviceId
    );

    return { success: true };
  }

  const devicesUsed = db.prepare(`
    SELECT COUNT(*) AS total
    FROM key_devices
    WHERE key_id = ?
    AND revoked = 0
  `).get(record.id).total;

  if (
    record.max_devices !== 0 &&
    devicesUsed >= record.max_devices
  ) {
    return {
      success: false,
      error: "Device limit reached",
      devicesUsed
    };
  }

  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO key_devices (
      key_id,
      device_id,
      ip,
      created_at,
      last_seen
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(
    record.id,
    deviceId,
    ip,
    now,
    now
  );

  return {
    success: true,
    devicesUsed: devicesUsed + 1
  };
});

function verifyKey(req, res, next) {
  try {
    const body = req.body || {};

    const key = String(body.key || "").trim();
    const ip = String(body.ip || "").trim();
    const deviceId = String(body.deviceId || "").trim();

    if (!key) {
      return res.status(400).json({
        ok: false,
        valid: false,
        error: "Enter a key"
      });
    }

    if (net.isIP(ip) !== 4) {
      return res.status(400).json({
        ok: false,
        valid: false,
        error: "Enter a valid IPv4 address"
      });
    }

    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(deviceId)) {
      return res.status(400).json({
        ok: false,
        valid: false,
        error: "Invalid device identifier"
      });
    }

    const record = db.prepare(`
      SELECT
        id,
        expires_at,
        revoked,
        max_devices
      FROM keys
      WHERE key_hash = ?
    `).get(hashKey(key));

    if (!record || record.revoked) {
      return res.status(403).json({
        ok: false,
        valid: false,
        error: "Invalid or revoked key"
      });
    }

    const expiration = Date.parse(record.expires_at || "");

    if (!Number.isFinite(expiration) || Date.now() > expiration) {
      return res.status(403).json({
        ok: false,
        valid: false,
        error: "Key expired"
      });
    }

    // IMPORTANT:
    // Device registration is unconditional.
    // The Remember checkbox does not control device registration.
    const registration = registerDevice.immediate(
      record,
      deviceId,
      ip
    );

    if (!registration.success) {
      return res.status(403).json({
        ok: false,
        valid: false,
        error: registration.error,
        devices_used: registration.devicesUsed
      });
    }

    const devicesUsed = db.prepare(`
      SELECT COUNT(*) AS total
      FROM key_devices
      WHERE key_id = ?
      AND revoked = 0
    `).get(record.id).total;

    res.json({
      ok: true,
      valid: true,
      message: "Key verified — access granted",
      expires_at: record.expires_at,
      devices_used: devicesUsed,
      max_devices: record.max_devices
    });

  } catch (error) {
    next(error);
  }
}

/* BOTH VERIFICATION ROUTES */

app.post("/api/keys/verify", verifyKey);
app.post("/api/verify-key", verifyKey);

/* =========================================
   NOT FOUND
========================================= */

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Route not found",
    path: req.path
  });
});

/* =========================================
   ERROR HANDLER
========================================= */

app.use((err, req, res, next) => {
  console.error("API error:", err.message);

  if (res.headersSent) return next(err);

  res.status(500).json({
    ok: false,
    error: "Internal server error"
  });
});

/* =========================================
   START SERVER
========================================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`WINDIR PROXY running on port ${PORT}`);
});
