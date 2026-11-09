let token = localStorage.getItem('windir_admin_token');
let currentAdmin = null;

const $ = id => document.getElementById(id);

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

async function api(url, options = {}) {
  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: 'Bearer ' + token } : {})
  };

  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

// VERIFY KEY
$('verify').addEventListener('submit', async event => {
  event.preventDefault();

  $('result').textContent = 'Checking…';

  try {
    const response = await fetch('/api/keys/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: $('keyInput').value
      })
    });

    const data = await response.json();

    $('result').textContent =
      data.message +
      (data.valid
        ? ' · Expires ' + new Date(data.expires_at).toLocaleDateString()
        : '');

    $('result').style.color = data.valid ? '#a3e635' : '#fb7185';

  } catch {
    $('result').textContent = 'Server unavailable';
  }
});

// OPEN / CLOSE ADMIN
$('adminOpen').onclick = () => {
  $('modal').classList.remove('hidden');
  showAuth();
};

$('close').onclick = () => {
  $('modal').classList.add('hidden');
};

// LOGIN VIEW
function showLogin() {
  $('loginView').classList.remove('hidden');
  $('dash').classList.add('hidden');
}

// DASHBOARD
async function showAuth() {
  if (!token) {
    currentAdmin = null;
    showLogin();
    return;
  }

  try {
    currentAdmin = await api('/api/admin/me');

    $('loginView').classList.add('hidden');
    $('dash').classList.remove('hidden');

    $('adminName').textContent = escapeHTML(currentAdmin.username);
    $('adminRole').textContent = currentAdmin.role.toUpperCase();

    const isOwner = currentAdmin.role === 'owner';

    $('ownerPanel').classList.toggle('hidden', !isOwner);

    await loadKeys();

    if (isOwner) {
      await loadAdmins();
    }

  } catch {
    token = null;
    currentAdmin = null;
    localStorage.removeItem('windir_admin_token');
    showLogin();
  }
}

// LOGIN
$('login').onclick = async () => {
  const username = $('username').value.trim();
  const password = $('password').value;

  $('loginErr').textContent = 'Checking…';

  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Login failed');
    }

    token = data.token;
    localStorage.setItem('windir_admin_token', token);

    $('password').value = '';
    $('loginErr').textContent = '';

    await showAuth();

  } catch (error) {
    $('loginErr').textContent = error.message;
  }
};

// LOAD KEYS
async function loadKeys() {
  const keys = await api('/api/admin/keys');

  $('keys').innerHTML = keys.map(key => `
    <div class="keyitem">
      <b>${escapeHTML(key.label || 'Unlabeled')}</b>
      · ${new Date(key.expires_at).toLocaleDateString()}
      · ${key.revoked ? 'REVOKED' : 'ACTIVE'}

      <button onclick="revokeKey(${Number(key.id)})">
        REVOKE
      </button>

      <br>
      <small>
        Created ${new Date(key.created_at).toLocaleDateString()}
      </small>
    </div>
  `).join('') || '<p class="result">No keys yet.</p>';
}

// GENERATE KEY
$('make').onclick = async () => {
  try {
    const data = await api('/api/admin/keys', {
      method: 'POST',
      body: JSON.stringify({
        days: $('days').value,
        label: $('label').value
      })
    });

    const safeKey = escapeHTML(data.key);

    $('newKey').innerHTML = `
      <div class="keybox">
        ${safeKey}
        <br>
        <button class="ghost" id="copyKey">COPY KEY</button>
      </div>
    `;

    $('copyKey').onclick = async () => {
      try {
        await navigator.clipboard.writeText(data.key);
        $('copyKey').textContent = 'COPIED!';
      } catch {
        alert('Could not copy the key');
      }
    };

    $('label').value = '';
    await loadKeys();

  } catch (error) {
    alert(error.message);
  }
};

// REVOKE KEY
window.revokeKey = async id => {
  if (!confirm('Revoke this key?')) return;

  try {
    await api('/api/admin/keys/' + id + '/revoke', {
      method: 'POST'
    });

    await loadKeys();

  } catch (error) {
    alert(error.message);
  }
};

// LOAD ADMINS - OWNER ONLY
async function loadAdmins() {
  if (!currentAdmin || currentAdmin.role !== 'owner') return;

  try {
    const admins = await api('/api/admin/users');

    $('adminList').innerHTML = admins.map(admin => `
      <div class="keyitem">
        <b>${escapeHTML(admin.username)}</b>
        · ${escapeHTML(admin.role.toUpperCase())}
        · ${admin.disabled ? 'DISABLED' : 'ACTIVE'}

        ${
          admin.role === 'admin'
            ? `<button onclick="deleteAdmin(${Number(admin.id)})">DELETE</button>`
            : ''
        }

        <br>
        <small>
          Created ${new Date(admin.created_at).toLocaleDateString()}
        </small>
      </div>
    `).join('') || '<p class="result">No administrators.</p>';

  } catch (error) {
    $('adminMessage').textContent = error.message;
  }
}

// CREATE ADMIN - OWNER ONLY
$('createAdmin').onclick = async () => {
  if (!currentAdmin || currentAdmin.role !== 'owner') return;

  const username = $('newAdminUser').value.trim();
  const password = $('newAdminPassword').value;

  $('adminMessage').textContent = 'Creating administrator…';

  try {
    await api('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    $('adminMessage').textContent = 'Administrator created successfully.';
    $('newAdminUser').value = '';
    $('newAdminPassword').value = '';

    await loadAdmins();

  } catch (error) {
    $('adminMessage').textContent = error.message;
  }
};

// DELETE ADMIN - OWNER ONLY
window.deleteAdmin = async id => {
  if (!currentAdmin || currentAdmin.role !== 'owner') return;

  if (!confirm('Delete this administrator?')) return;

  try {
    await api('/api/admin/users/' + id, {
      method: 'DELETE'
    });

    $('adminMessage').textContent = 'Administrator deleted.';
    await loadAdmins();

  } catch (error) {
    $('adminMessage').textContent = error.message;
  }
};

// LOGOUT
$('logout').onclick = async () => {
  try {
    await api('/api/admin/logout', { method: 'POST' });
  } catch {}

  token = null;
  currentAdmin = null;

  localStorage.removeItem('windir_admin_token');

  $('ownerPanel').classList.add('hidden');
  $('newKey').innerHTML = '';

  showLogin();
};

// INITIALIZE
showAuth();
