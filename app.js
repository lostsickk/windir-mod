const $ = (id) => document.getElementById(id);

const activation = $("activation");
const dashboard = $("dashboard");
const result = $("result");

let currentKey = "";
let expiresAt = "";

function message(element, text, type = "") {
  element.textContent = text;
  element.className = "notice " + type;
}

function showDashboard(key, expiration) {
  currentKey = key;
  expiresAt = expiration || "—";

  activation.hidden = true;
  dashboard.hidden = false;
  $("headerLogout").hidden = false;

  const masked = key.length > 8
    ? key.slice(0, 7) + "••••••"
    : "Verified";

  $("proxyKey").textContent = masked;
  $("settingKey").textContent = masked;
  $("proxyExpiry").textContent = new Date(expiration).toLocaleDateString();
  $("settingExpiry").textContent = new Date(expiration).toLocaleDateString();

  sessionStorage.setItem("windir_key", key);
  sessionStorage.setItem("windir_expiry", expiration || "");
}

function logout() {
  sessionStorage.removeItem("windir_key");
  sessionStorage.removeItem("windir_expiry");
  currentKey = "";
  dashboard.hidden = true;
  activation.hidden = false;
  $("headerLogout").hidden = true;
  $("keyInput").value = "";
  message(result, "Session closed.");
}

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

$("logout").addEventListener("click", logout);
$("headerLogout").addEventListener("click", logout);

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

// Restore dashboard in this browser session
const savedKey = sessionStorage.getItem("windir_key");
const savedExpiry = sessionStorage.getItem("windir_expiry");

if (savedKey && savedExpiry) {
  showDashboard(savedKey, savedExpiry);
}
