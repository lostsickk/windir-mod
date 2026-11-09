'use strict';

// Telegram administrator bot. Uses the same SQLite connection as the website.
// Requires Node.js 18+ (built-in fetch).

function startTelegramBot({ db, hash }) {
  const botToken = process.env.BOT_TOKEN;
  const ownerId = String(process.env.ADMIN_TELEGRAM_ID || '').trim();

  if (!botToken || !ownerId) {
    console.log('Telegram bot disabled: set BOT_TOKEN and ADMIN_TELEGRAM_ID.');
    return;
  }

  if (typeof fetch !== 'function') {
    console.error('Telegram bot requires Node.js 18 or newer (built-in fetch).');
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS telegram_admins (
      telegram_id TEXT PRIMARY KEY,
      added_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  db.prepare(`
    INSERT OR IGNORE INTO telegram_admins (telegram_id, added_by, created_at)
    VALUES (?, 'ENV_OWNER', ?)
  `).run(ownerId, new Date().toISOString());

  const api = `https://api.telegram.org/bot${botToken}`;
  const pending = new Map();
  let offset = 0;
  let stopped = false;

  async function call(method, body = {}) {
    const response = await fetch(`${api}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.description || `Telegram API ${method} failed`);
    }
    return data.result;
  }

  async function send(chatId, text) {
    return call('sendMessage', {
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    });
  }

  function isAdmin(id) {
    return !!db.prepare('SELECT 1 FROM telegram_admins WHERE telegram_id = ?').get(String(id));
  }

  function isOwner(id) {
    return String(id) === ownerId;
  }

  function createKey(days, label) {
    const key = 'WINDIR-' + require('crypto').randomBytes(12).toString('hex').toUpperCase();
    const expires = new Date(Date.now() + days * 86400000).toISOString();
    db.prepare(`
      INSERT INTO keys (key_hash, label, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(hash(key), label || 'Telegram', expires, new Date().toISOString());
    return { key, expires };
  }

  async function handleMessage(message) {
    if (!message || !message.chat || !message.from || typeof message.text !== 'string') return;
    const chatId = message.chat.id;
    const userId = String(message.from.id);
    const text = message.text.trim();

    // Only private chats are accepted; the bot must not run admin commands in groups.
    if (message.chat.type !== 'private') return;

    if (!isAdmin(userId)) {
      await send(chatId, '⛔ No tienes autorización para utilizar WINDIR MODE BOT.');
      return;
    }

    const waiting = pending.get(userId);
    if (waiting && !text.startsWith('/')) {
      pending.delete(userId);

      if (waiting === 'add_admin') {
        if (!isOwner(userId)) {
          await send(chatId, '⛔ Solo el administrador principal puede agregar administradores.');
          return;
        }
        if (!/^\d{5,20}$/.test(text)) {
          await send(chatId, 'ID inválido. Debe ser un número de Telegram. Vuelve a usar /new admin.');
          return;
        }
        db.prepare(`
          INSERT OR IGNORE INTO telegram_admins (telegram_id, added_by, created_at)
          VALUES (?, ?, ?)
        `).run(text, userId, new Date().toISOString());
        await send(chatId, `✅ Administrador autorizado: ${text}`);
        return;
      }

      if (waiting === 'revoke') {
        const value = text.trim();
        let result;
        if (/^\d+$/.test(value)) {
          result = db.prepare('UPDATE keys SET revoked = 1 WHERE id = ?').run(Number(value));
        } else {
          result = db.prepare('UPDATE keys SET revoked = 1 WHERE key_hash = ?').run(hash(value));
        }
        await send(chatId, result.changes
          ? '✅ KEY revocada correctamente.'
          : '❌ No encontré esa KEY o ID.');
        return;
      }
    }

    const parts = text.split(/\s+/);
    const command = (parts[0] || '').split('@')[0].toLowerCase();

    if (command === '/start' || command === '/help') {
      await send(chatId,
        'WINDIR MODE — Panel privado\n\n' +
        '/new admin — agregar administrador (solo principal)\n' +
        '/generate 7 — crear KEY por los días indicados\n' +
        '/keys — ver las últimas 20 KEY\n' +
        '/revoke — revocar una KEY o su ID\n\n' +
        'Duración permitida: 1 a 3650 días. No existen KEY permanentes.'
      );
      return;
    }

    if (command === '/new') {
      if (!isOwner(userId)) {
        await send(chatId, '⛔ Solo el administrador principal puede agregar administradores.');
        return;
      }
      if ((parts[1] || '').toLowerCase() !== 'admin') {
        await send(chatId, 'Uso: /new admin');
        return;
      }
      pending.set(userId, 'add_admin');
      await send(chatId, 'Envía ahora el ID numérico de Telegram de la persona que quieres autorizar.');
      return;
    }

    if (command === '/generate') {
      const days = Number(parts[1]);
      if (!Number.isInteger(days) || days < 1 || days > 3650) {
        await send(chatId, 'Uso: /generate 7\nPuedes elegir de 1 a 3650 días.');
        return;
      }
      try {
        const created = createKey(days, `Telegram:${message.from.username || userId}`);
        await send(chatId,
          `✅ KEY GENERADA\n\n${created.key}\n\n` +
          `Duración: ${days} día(s)\nVence: ${created.expires}\n\n` +
          'Esta KEY ya puede verificarse en WINDIR MODE.'
        );
      } catch (error) {
        console.error('Telegram generate error:', error);
        await send(chatId, '❌ No se pudo generar la KEY. Revisa los logs del servidor.');
      }
      return;
    }

    if (command === '/keys') {
      const rows = db.prepare(`
        SELECT id, label, expires_at, revoked
        FROM keys ORDER BY id DESC LIMIT 20
      `).all();
      if (!rows.length) {
        await send(chatId, 'Todavía no hay KEY registradas.');
        return;
      }
      const lines = rows.map(row =>
        `#${row.id} | ${row.label || 'Sin etiqueta'} | ${row.revoked ? 'REVOCADA' : 'ACTIVA'} | ${row.expires_at || 'Sin vencimiento'}`
      );
      await send(chatId, `ÚLTIMAS ${rows.length} KEY\n\n${lines.join('\n')}`);
      return;
    }

    if (command === '/revoke') {
      if (parts[1]) {
        const value = parts[1].trim();
        const result = /^\d+$/.test(value)
          ? db.prepare('UPDATE keys SET revoked = 1 WHERE id = ?').run(Number(value))
          : db.prepare('UPDATE keys SET revoked = 1 WHERE key_hash = ?').run(hash(value));
        await send(chatId, result.changes ? '✅ KEY revocada correctamente.' : '❌ No encontré esa KEY o ID.');
      } else {
        pending.set(userId, 'revoke');
        await send(chatId, 'Envía ahora el ID de la KEY o pega la KEY completa que deseas revocar.');
      }
      return;
    }

    await send(chatId, 'Comando no reconocido. Escribe /help para ver los comandos.');
  }

  async function poll() {
    while (!stopped) {
      try {
        const updates = await call('getUpdates', {
          offset,
          timeout: 25,
          allowed_updates: ['message']
        });
        for (const update of updates) {
          offset = update.update_id + 1;
          try {
            await handleMessage(update.message);
          } catch (error) {
            console.error('Telegram message error:', error);
          }
        }
      } catch (error) {
        console.error('Telegram polling error:', error.message);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  // Remove any old webhook so long polling can receive messages.
  call('deleteWebhook', { drop_pending_updates: false })
    .then(() => {
      console.log(`Telegram bot started. Owner Telegram ID: ${ownerId}`);
      poll();
    })
    .catch(error => console.error('Telegram bot startup error:', error.message));

  return () => { stopped = true; };
}

module.exports = { startTelegramBot };