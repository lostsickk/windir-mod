const $ = (id) => document.getElementById(id);

let adminToken = null;
let currentKey = "";
let currentExpiry = "";
let currentLabel = "";

async function api(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (adminToken) {
    headers.Authorization = `Bearer ${adminToken}`;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || data.message || "Request failed");
  }

  return data;
}

function message(element, text, type = "") {
  if (!element) return;
  element.textContent = text;
  element.className = "notice " + type;
}

function showDashboard(key, expiry) {
  currentKey = key || "";
  currentExpiry = expiry || "—";

  $("activation").hidden = true;
  $("dashboard").hidden = false;
  $("headerLogout").hidden = false;

  $("proxyKey").textContent = currentKey;
  $("settingKey").textContent = currentKey;
  $("proxyExpiry").textContent = currentExpiry;
  $("settingExpiry").textContent = currentExpiry;
}

function logoutUser() {
  currentKey = "";
  currentExpiry = "";

  $("dashboard").hidden = true;
  $("activation").hidden = false;
  $("headerLogout").hidden = true;

  $("keyInput").value = "";
  message($("result"), "");
  localStorage.removeItem("windir_session");
}

function openAdmin() {
  $("modal").hidden = false;
  $("loginView").hidden = !adminToken;
  $("dash").hidden = !adminToken;

  if (adminToken) {
    loadKeys();
  }
}

function closeAdmin() {
  $("modal").hidden = true;
}

async function loginAdmin() {
  const password = $("password").value.trim();

  if (!password) {
    message($("loginErr"), "Enter admin password");
    return;
  }

  try {
    const data = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password })
    });

    adminToken = data.token;

    $("loginView").hidden = true;
    $("dash").hidden = false;
    $("password").value = "";

    await loadKeys();
  } catch (error) {
    message($("loginErr"), error.message);
  }
}

async function loadKeys() {
  try {
    const data = await api("/api/admin/keys");

    const keys = Array.isArray(data)
      ? data
      : data.keys || [];

    renderKeys(keys);
  } catch (error) {
    $("keys").innerHTML =
      `<p class="notice">${escapeHTML(error.message)}</p>`;
  }
}

async function generateKey() {
  const label = $("label").value.trim() || "WINDIR";
  const days = Number($("days").value);

  if (!Number.isInteger(days) || days < 1) {
    alert("Enter a valid duration in days.");
    return;
  }

  $("make").disabled = true;
  $("make").textContent = "GENERATING...";

  try {
    const data = await api("/api/admin/keys", {
      method: "POST",
      body: JSON.stringify({ label, days })
    });

    const key = data.key || data.licenseKey || data.code;

    if (!key) {
      throw new Error("The server did not return the generated key.");
    }

    $("newKey").value = key;

    await loadKeys();

    $("newKey").focus();
    $("newKey").select();
  } catch (error) {
    alert(error.message);
  } finally {
    $("make").disabled = false;
    $("make").textContent = "GENERATE KEY";
  }
}

function renderKeys(keys) {
  const container = $("keys");

  if (!keys.length) {
    container.innerHTML =
      '<div class="key-empty">No keys generated yet.</div>';
    return;
  }

  const active = [];
  const revoked = [];

  keys.forEach((item) => {
    const isRevoked =
      item.revoked === true ||
      item.revoked_at ||
      item.status === "revoked";

    if (isRevoked) {
      revoked.push(item);
    } else {
      active.push(item);
    }
  });

  container.innerHTML = `
    <div class="key-section">
      <h3>ACTIVE KEYS <span>${active.length}</span></h3>
      ${active.map(keyCard).join("")}
    </div>

    <div class="key-section">
      <h3>REVOKED KEYS <span>${revoked.length}</span></h3>
      ${revoked.map(keyCard).join("") || 
        '<div class="key-empty">No revoked keys.</div>'}
    </div>
  `;
}

function keyCard(item) {
  const key = item.key || item.license_key || "";
  const label = item.label || "WINDIR";
  const expiry = formatDate(item.expires_at || item.expiry);
  const revoked =
    item.revoked === true ||
    item.revoked_at ||
    item.status === "revoked";

  return `
    <article class="key-card">
      <div class="key-card-top">
        <span class="key-label">${escapeHTML(label)}</span>
        <span class="key-status ${revoked ? "revoked" : "active"}">
          ${revoked ? "REVOKED" : "ACTIVE"}
        </span>
      </div>

      <div class="key-value">${escapeHTML(key)}</div>

      <div class="key-expiry">Expires: ${escapeHTML(expiry)}</div>

      <div class="key-actions">
        <button class="copy-btn"
          onclick="copyKey('${escapeJS(key)}')">
          COPY KEY
        </button>

        ${!revoked && item.id ? `
          <button class="revoke-btn"
            onclick="revokeKey(${Number(item.id)})">
            REVOKE
          </button>
        ` : ""}
      </div>
    </article>
  `;
}

async function copyKey(key) {
  try {
    await navigator.clipboard.writeText(key);
    alert("KEY COPIED!");
  } catch {
    const input = document.createElement("textarea");
    input.value = key;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
    alert("KEY COPIED!");
  }
}

async function revokeKey(id) {
  if (!confirm("Are you sure you want to revoke this key?")) {
    return;
  }

  try {
    await api(`/api/admin/keys/${id}/revoke`, {
      method: "POST",
      body: JSON.stringify({})
    });

    await loadKeys();
  } catch (error) {
    alert(error.message);
  }
}

async function logoutAdmin() {
  try {
    await api("/api/admin/logout", {
      method: "POST",
      body: JSON.stringify({})
    });
  } catch {}

  adminToken = null;

  $("modal").hidden = true;
  $("loginView").hidden = false;
  $("dash").hidden = true;
  $("password").value = "";
  $("newKey").value = "";
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString();
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function escapeJS(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n");
}

// VERIFY KEY
$("verify").addEventListener("submit", async (event) => {
  event.preventDefault();

  const key = $("keyInput").value.trim();

  if (!key) return;

  $("verifyBtn").disabled = true;
  $("verifyBtn").textContent = "VERIFYING...";

  try {
    const data = await api("/api/verify-key", {
      method: "POST",
      body: JSON.stringify({ key })
    });

    if (!data.valid && !data.success) {
      throw new Error(data.error || "Invalid key");
    }

    const expiry = data.expires_at || data.expiry || "—";

    localStorage.setItem("windir_session", JSON.stringify({
      key,
      expiry
    }));

    message($("result"), "KEY VERIFIED", "success");
    showDashboard(key, formatDate(expiry));
  } catch (error) {
    message($("result"), error.message);
  } finally {
    $("verifyBtn").disabled = false;
    $("verifyBtn").innerHTML = 'VERIFY KEY <span>↗</span>';
  }
});

// ADMIN
$("adminOpen").addEventListener("click", openAdmin);
$("close").addEventListener("click", closeAdmin);
$("login").addEventListener("click", loginAdmin);
$("make").addEventListener("click", generateKey);
$("logoutAdmin").addEventListener("click", logoutAdmin);

$("password").addEventListener("keydown", event => {
  if (event.key === "Enter") loginAdmin();
});

$("modal").addEventListener("click", event => {
  if (event.target === $("modal")) closeAdmin();
});

// USER LOGOUT
$("logout").addEventListener("click", logoutUser);
$("headerLogout").addEventListener("click", logoutUser);

// TABS
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(item =>
      item.classList.remove("active")
    );

    document.querySelectorAll(".tab-panel").forEach(panel =>
      panel.hidden = true
    );

    tab.classList.add("active");

    const panel = $("panel-" + tab.dataset.tab);

    if (panel) panel.hidden = false;
  });
});

// PREFERENCES
$("savePrefs").addEventListener("click", () => {
  const preferences = {};

  document.querySelectorAll("[data-pref]").forEach(input => {
    preferences[input.dataset.pref] = input.checked;
  });

  localStorage.setItem("windir_preferences",
    JSON.stringify(preferences));

  message($("prefsMsg"), "Preferences saved!", "success");
});

// RESTORE PREFERENCES
try {
  const preferences = JSON.parse(
    localStorage.getItem("windir_preferences") || "{}"
  );

  document.querySelectorAll("[data-pref]").forEach(input => {
    input.checked = !!preferences[input.dataset.pref];
  });
} catch {}

// RESTORE SESSION
try {
  const session = JSON.parse(
    localStorage.getItem("windir_session") || "null"
  );

  if (session && session.key) {
    showDashboard(session.key, session.expiry);
  }
} catch {}
