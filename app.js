const $ = (id) => document.getElementById(id);

const activation = $("activation");
const dashboard = $("dashboard");
const result = $("result");

let currentKey = "";
let expiresAt = "";
let adminToken = "";

function message(element, text, type = "") {
  if (!element) return;
  element.textContent = text;
  element.className = "notice " + type;
}

function showDashboard(key, expiration) {
  currentKey = key;
  expiresAt = expiration || "—";

  activation.hidden = true;
  dashboard.hidden = false;

  if ($("headerLogout")) $("headerLogout").hidden = false;

  const masked = key.length > 8
    ? key.slice(0, 7) + "••••••"
    : "Verified";

  if ($("proxyKey")) $("proxyKey").textContent = masked;
  if ($("settingKey")) $("settingKey").textContent = masked;

  const expiry = expiration
    ? new Date(expiration).toLocaleDateString()
    : "—";

  if ($("proxyExpiry")) $("proxyExpiry").textContent = expiry;
  if ($("settingExpiry")) $("settingExpiry").textContent = expiry;

  sessionStorage.setItem("windir_key", key);
  sessionStorage.setItem("windir_expiry", expiration || "");
}

function logout() {
  sessionStorage.removeItem("windir_key");
  sessionStorage.removeItem("windir_expiry");

  currentKey = "";
  dashboard.hidden = true;
  activation.hidden = false;

  if ($("headerLogout")) $("headerLogout").hidden = true;
  if ($("keyInput")) $("keyInput").value = "";

  message(result, "Session closed.");
}

// VERIFICAR KEY
$("verify").addEventListener("submit", async (event) => {
  event.preventDefault();

  const key = $("keyInput").value.trim();
  const button = $("verifyBtn");

  button.disabled = true;
  button.textContent = "VERIFYING...";

  message(result, "Checking access key...");

  try {
    const response = await fetch("/api/verify-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key })
    });

    const data = await response.json();

    if (!response.ok || !data.valid) {
      message(result, data.message || "Invalid key.", "error");
      return;
    }

    message(result, "ACCESS GRANTED", "success");
    showDashboard(key, data.expires_at);
  } catch (error) {
    message(result, "Unable to connect to server.", "error");
  } finally {
    button.disabled = false;
    button.innerHTML = 'VERIFY KEY <span>↗</span>';
  }
});

// TABS
document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.classList.toggle("active", tab === button);
    });

    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.hidden = panel.id !== "panel-" + button.dataset.tab;
    });
  });
});

if ($("logout")) $("logout").addEventListener("click", logout);
if ($("headerLogout")) $("headerLogout").addEventListener("click", logout);

// PREFERENCIAS
if ($("savePrefs")) {
  $("savePrefs").addEventListener("click", () => {
    document.querySelectorAll("[data-pref]").forEach((input) => {
      document.body.classList.toggle(
        input.dataset.pref === "compact" ? "compact" :
        input.dataset.pref === "reducedMotion" ? "reduced-motion" : "notifications",
        input.checked
      );
    });

    message($("prefsMsg"), "Preferences applied.", "success");
  });
}

// ADMIN
if ($("adminOpen")) {
  $("adminOpen").addEventListener("click", () => {
    $("modal").hidden = false;
  });
}

if ($("close")) {
  $("close").addEventListener("click", () => {
    $("modal").hidden = true;
  });
}

async function adminRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + adminToken,
      ...(options.headers || {})
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

// LOGIN ADMIN
if ($("login")) {
  $("login").addEventListener("click", async () => {
    const password = $("password").value;

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });

      const data = await response.json();

      if (!response.ok || !data.token) {
        throw new Error(data.error || "Incorrect password");
      }

      adminToken = data.token;

      $("loginView").hidden = true;
      $("dash").hidden = false;

      await loadKeys();
    } catch (error) {
      message($("loginErr"), error.message, "error");
    }
  });
}

// GENERAR KEY
if ($("make")) {
  $("make").addEventListener("click", async () => {
    try {
      const data = await adminRequest("/api/admin/keys", {
        method: "POST",
        body: JSON.stringify({
          days: Number($("days").value),
          label: $("label").value
        })
      });

      $("newKey").textContent = "NEW KEY: " + data.key;
      await loadKeys();
    } catch (error) {
      alert(error.message);
    }
  });
}

// LISTAR KEYS
async function loadKeys() {
  const keys = await adminRequest("/api/admin/keys");
  const container = $("keys");

  container.innerHTML = "";

  keys.forEach((key) => {
    const row = document.createElement("div");
    row.className = "info-card";

    row.textContent =
      (key.label || "Key") + " · " +
      new Date(key.expires_at).toLocaleDateString() +
      (key.revoked ? " · REVOKED" : "");

    if (!key.revoked) {
      const revoke = document.createElement("button");
      revoke.textContent = "REVOKE";

      revoke.onclick = async () => {
        try {
          await adminRequest(
            "/api/admin/keys/" + key.id + "/revoke",
            {
              method: "POST",
              body: JSON.stringify({})
            }
          );

          await loadKeys();
        } catch (error) {
          alert(error.message);
        }
      };

      row.appendChild(revoke);
    }

    container.appendChild(row);
  });
}

// LOGOUT ADMIN
if ($("logoutAdmin")) {
  $("logoutAdmin").addEventListener("click", async () => {
    try {
      await adminRequest("/api/admin/logout", {
        method: "POST",
        body: JSON.stringify({})
      });
    } catch {}

    adminToken = "";
    $("loginView").hidden = false;
    $("dash").hidden = true;
    $("password").value = "";
  });
}

// RESTAURAR SESIÓN
const savedKey = sessionStorage.getItem("windir_key");
const savedExpiry = sessionStorage.getItem("windir_expiry");

if (savedKey && savedExpiry) {
  showDashboard(savedKey, savedExpiry);
}
