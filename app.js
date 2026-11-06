```javascript
let token = localStorage.getItem('windir_admin_token');

const $ = id => document.getElementById(id);

// CONEXIÓN API
async function api(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            ...(options.headers || {})
        }
    });

    const text = await response.text();

    let data;

    try {
        data = JSON.parse(text);
    } catch {
        throw new Error(`Server response error (${response.status})`);
    }

    if (!response.ok) {
        throw new Error(data.error || data.message || `HTTP ${response.status}`);
    }

    return data;
}

// VERIFICAR KEY
$('verify').addEventListener('submit', async e => {
    e.preventDefault();

    const result = $('result');
    const button = $('verify').querySelector('button');
    const key = $('keyInput').value.trim();

    if (!key) {
        result.textContent = 'Please enter your access key.';
        result.style.color = '#fb7185';
        return;
    }

    result.textContent = 'Checking key...';
    result.style.color = '#c4b5fd';

    button.disabled = true;

    try {
        const data = await api('/api/verify-key', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                key: key
            })
        });

        if (data.valid) {
            result.textContent = 'ACCESS GRANTED · ' +
                (data.message || 'Key verified successfully') +
                (data.expires_at
                    ? ' · Expires ' +
                    new Date(data.expires_at).toLocaleDateString()
                    : '');

            result.style.color = '#a3e635';

            sessionStorage.setItem('windir_access', 'granted');

        } else {
            result.textContent = data.message || 'Invalid or expired key';
            result.style.color = '#fb7185';

            sessionStorage.removeItem('windir_access');
        }

    } catch (error) {
        result.textContent = 'Server unavailable · ' + error.message;
        result.style.color = '#fb7185';

        sessionStorage.removeItem('windir_access');

    } finally {
        button.disabled = false;
    }
});

// ADMIN MODAL
$('adminOpen').onclick = () => {
    $('modal').classList.remove('hidden');
    showAuth();
};

$('close').onclick = () => {
    $('modal').classList.add('hidden');
};

// AUTENTICACIÓN
function showAuth() {
    $('loginView').classList.toggle('hidden', !!token);
    $('dash').classList.toggle('hidden', !token);

    if (token) {
        loadKeys();
    }
}

// LOGIN
$('login').onclick = async () => {
    $('loginErr').textContent = 'Connecting...';

    try {
        const data = await api('/api/admin/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                password: $('password').value
            })
        });

        token = data.token;

        localStorage.setItem('windir_admin_token', token);

        $('loginErr').textContent = '';

        showAuth();

    } catch (error) {
        $('loginErr').textContent = error.message;
    }
};

// CARGAR KEYS
async function loadKeys() {
    try {
        const list = await api('/api/admin/keys', {
            headers: {
                Authorization: 'Bearer ' + token
            }
        });

        $('keys').innerHTML = list.map(k => `
            <div class="keyitem">
                <b>${esc(k.label || 'Unlabeled')}</b>
                · ${new Date(k.expires_at).toLocaleDateString()}
                · ${k.revoked ? 'REVOKED' : 'ACTIVE'}

                <button onclick="revoke(${k.id})">REVOKE</button>

                <br>

                <small>
                    Created ${new Date(k.created_at).toLocaleDateString()}
                </small>
            </div>
        `).join('') || '<p class="result">No keys yet.</p>';

    } catch (error) {
        if (error.message.includes('401')) {
            token = null;

            localStorage.removeItem('windir_admin_token');

            showAuth();

            return;
        }

        $('keys').textContent = error.message;
    }
}

// ESCAPAR TEXTO
function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[c]));
}

// GENERAR KEY
$('make').onclick = async () => {
    $('make').disabled = true;

    try {
        const data = await api('/api/admin/keys', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + token
            },
            body: JSON.stringify({
                days: $('days').value,
                label: $('label').value
            })
        });

        $('newKey').innerHTML = `
            <div class="keybox">
                ${esc(data.key)}
            </div>
        `;

        $('label').value = '';

        await loadKeys();

    } catch (error) {
        alert(error.message);

    } finally {
        $('make').disabled = false;
    }
};

// REVOCAR KEY
window.revoke = async id => {
    if (!confirm('Revoke this key?')) return;

    try {
        await api('/api/admin/keys/' + id + '/revoke', {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + token
            }
        });

        await loadKeys();

    } catch (error) {
        alert(error.message);
    }
};

// LOGOUT
$('logout').onclick = async () => {
    try {
        await api('/api/admin/logout', {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + token
            }
        });

    } catch (error) {
        console.error(error);
    }

    token = null;

    localStorage.removeItem('windir_admin_token');

    showAuth();
};

// INICIAR
showAuth();
```