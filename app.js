/* =========================================
   WINDIR PROXY - APP.JS
   Customer access + Admin dashboard
   Proxy / Main / News / Setting
========================================= */

"use strict";

/* ---------- CONFIGURATION ---------- */

const API = {
  verify: "/api/keys/verify",
  login: "/api/admin/login",
  me: "/api/admin/me",
  logout: "/api/admin/logout",
  keys: "/api/admin/keys",
  admins: "/api/admin/users"
};

const STORAGE_KEY = "windir_saved_key";
const DEVICE_KEY = "windir_device_id";
const ADMIN_TOKEN_KEY = "windir_admin_token";
const LANGUAGE_KEY = "windir_language";

/* ---------- HELPERS ---------- */

const $ = id => document.getElementById(id);

function firstElement(...ids) {
  for (const id of ids) {
    const element = $(id);
    if (element) return element;
  }
  return null;
}

function show(element, visible) {
  if (!element) return;
  element.classList.toggle("hidden", !visible);
}

function setText(element, value) {
  if (element) element.textContent = value ?? "";
}

function escapeText(value) {
  return String(value ?? "");
}

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);

  if (!id) {
    id = crypto.randomUUID
      ? crypto.randomUUID()
      : "windir_" + Date.now() + "_" +
        Math.random().toString(36).slice(2);

    localStorage.setItem(DEVICE_KEY, id);
  }

  return id;
}

async function request(url, options = {}, admin = false) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (admin) {
    const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok || data.ok === false) {
    throw new Error(
      data.error || data.message || `Error ${response.status}`
    );
  }

  return data;
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);

  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;

  return element;
}

function formatDate(value) {
  if (!value) return "Unknown";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString();
}

function validIPv4(ip) {
  const parts = String(ip).trim().split(".");

  return parts.length === 4 &&
    parts.every(part =>
      /^\d{1,3}$/.test(part) &&
      Number(part) >= 0 &&
      Number(part) <= 255
    );
}

function maskKey(key) {
  const value = String(key || "");

  if (!value) return "Not available";
  if (value.length <= 8) return "••••••••";

  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}

function getExpiryTimestamp(value) {
  if (!value) return null;

  let timestamp;

  if (typeof value === "number") {
    timestamp = value;
  } else {
    timestamp = new Date(value).getTime();
  }

  if (!Number.isFinite(timestamp)) return null;

  // Accept Unix timestamps in seconds or milliseconds.
  if (timestamp > 0 && timestamp < 100000000000) {
    timestamp *= 1000;
  }

  return timestamp;
}

/* ---------- CUSTOMER SESSION ---------- */

let activeCustomerKey = "";
let activeCustomerIP = "";
let activeCustomerRemember = false;
let activeExpiry = null;
let countdownTimer = null;

const keyInput = $("keyInput");
const ipInput = $("ipInput");
const rememberCheckbox = $("saveKey");
const loginButton = $("loginButton");
const customerStatus = $("status");
const ipStatus = $("ipStatus");

function customerMessage(message, type = "") {
  setText(customerStatus, message);

  if (customerStatus) {
    customerStatus.className = "status";

    if (type) {
      customerStatus.classList.add(type);
    }
  }
}

function updateCustomerButton() {
  if (!loginButton) return;

  loginButton.disabled = !(
    keyInput?.value.trim() &&
    ipInput?.value.trim() &&
    validIPv4(ipInput.value)
  );
}

/* ---------- LOGIN SCREEN / MENU ---------- */

const loginScreen = firstElement("loginScreen") ||
  document.querySelector(".login-box");

const mainMenu = $("mainMenu");

function showCustomerMenu(data = {}) {
  show(loginScreen, false);
  show(mainMenu, true);

  if (keyInput?.value.trim()) {
    activeCustomerKey = keyInput.value.trim();
  }

  if (ipInput?.value.trim()) {
    activeCustomerIP = ipInput.value.trim();
  }

  activeCustomerRemember = Boolean(rememberCheckbox?.checked);

  if (data.expires_at || data.expiresAt) {
    setCustomerExpiry(data.expires_at || data.expiresAt);
  } else {
    setCustomerExpiry(null);
  }

  setText(
    $("settingKey"),
    maskKey(activeCustomerKey)
  );

  if ($("settingIpInput") && activeCustomerIP) {
    $("settingIpInput").value = activeCustomerIP;
  }

  setText($("settingIpStatus"), "Verified");

  activateMenuTab("proxy");
}

function showCustomerLogin() {
  show(mainMenu, false);
  show(loginScreen, true);

  activeCustomerKey = "";
  activeCustomerIP = "";
  activeCustomerRemember = false;
  activeExpiry = null;

  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }

  setText($("settingKey"), "Not available");
  setText($("settingCountdown"), "Not available");
  setText($("settingExpiryDate"), "Unknown");
}

/* ---------- LOGIN INPUTS ---------- */

if (keyInput) {
  keyInput.addEventListener("input", () => {
    customerMessage("");
    updateCustomerButton();
  });
}

if (ipInput) {
  ipInput.addEventListener("input", () => {
    if (ipInput.value && !validIPv4(ipInput.value)) {
      setText(ipStatus, "Enter a valid IPv4 address.");
    } else {
      setText(ipStatus, "");
    }

    updateCustomerButton();
  });
}

/* Restore remembered key */

if (keyInput && rememberCheckbox) {
  const savedKey = localStorage.getItem(STORAGE_KEY);

  if (savedKey) {
    keyInput.value = savedKey;
    rememberCheckbox.checked = true;
  }
}

/* ---------- PUBLIC IP DETECTION ---------- */

async function detectPublicIP() {
  const response = await fetch(
    "https://api.ipify.org?format=json",
    { cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error("IP detection failed.");
  }

  const data = await response.json();

  if (!validIPv4(data.ip)) {
    throw new Error("Invalid IP address.");
  }

  return data.ip;
}

/* Login screen IP detection */

const detectIpButton = $("detectIpButton");

if (detectIpButton) {
  detectIpButton.addEventListener("click", async () => {
    setText(ipStatus, "Detecting IP...");
    detectIpButton.disabled = true;

    try {
      const ip = await detectPublicIP();

      if (ipInput) ipInput.value = ip;

      setText(ipStatus, "IP detected successfully.");
      updateCustomerButton();

    } catch {
      setText(
        ipStatus,
        "Could not detect IP. Enter it manually."
      );
    } finally {
      detectIpButton.disabled = false;
    }
  });
}

/* ---------- CLEAR SAVED KEY ---------- */

const clearKeyButton = $("clearKey");

if (clearKeyButton) {
  clearKeyButton.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);

    if (keyInput) keyInput.value = "";
    if (rememberCheckbox) rememberCheckbox.checked = false;

    customerMessage("Saved key cleared.");
    updateCustomerButton();
  });
}

/* ---------- VERIFY CUSTOMER KEY ---------- */

if (loginButton) {
  loginButton.addEventListener("click", async () => {
    const key = keyInput?.value.trim();
    const ip = ipInput?.value.trim();

    if (!key) {
      customerMessage("Enter your access key.", "error");
      return;
    }

    if (!validIPv4(ip)) {
      customerMessage("Enter a valid IPv4 address.", "error");
      return;
    }

    loginButton.disabled = true;
    customerMessage("Verifying access...", "loading");

    try {
      const data = await request(API.verify, {
        method: "POST",
        headers: {
          "X-Device": ip
        },
        body: JSON.stringify({
          key,
          ip,
          deviceId: getDeviceId(),
          remember: Boolean(rememberCheckbox?.checked)
        })
      });

      if (data.valid === false) {
        throw new Error(
          data.message || "This key is not valid."
        );
      }

      if (rememberCheckbox?.checked) {
        localStorage.setItem(STORAGE_KEY, key);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }

      activeCustomerKey = key;
      activeCustomerIP = ip;
      activeCustomerRemember = Boolean(rememberCheckbox?.checked);

      customerMessage(
        data.message || "Access verified successfully!",
        "success"
      );

      // Open the menu only after successful server verification.
      setTimeout(() => {
        showCustomerMenu(data);
      }, 450);

    } catch (error) {
      customerMessage(
        error.message || "Verification failed.",
        "error"
      );
    } finally {
      updateCustomerButton();
    }
  });
}

updateCustomerButton();

/* ---------- MENU NAVIGATION ---------- */

function activateMenuTab(tabName) {
  if (!mainMenu) return;

  const allowedTabs = [
    "proxy",
    "main",
    "news",
    "setting"
  ];

  if (!allowedTabs.includes(tabName)) {
    tabName = "proxy";
  }

  document.querySelectorAll("[data-tab]").forEach(button => {
    const active = button.dataset.tab === tabName;

    button.classList.toggle("active", active);
    button.setAttribute(
      "aria-selected",
      active ? "true" : "false"
    );
  });

  allowedTabs.forEach(name => {
    const section = $(`tab-${name}`);
    show(section, name === tabName);
  });
}

document.querySelectorAll("[data-tab]").forEach(button => {
  button.addEventListener("click", () => {
    activateMenuTab(button.dataset.tab);
  });
});

/* ---------- MAIN: OPTION SWITCHES ---------- */

const activateOptionsButton = $("activateOptions");
const optionsMessage = $("optionsMessage");

function getSelectedOptions() {
  const selected = [];

  document.querySelectorAll(".wn-switch").forEach(element => {
    let enabled = false;

    if (
      element instanceof HTMLInputElement &&
      element.type === "checkbox"
    ) {
      enabled = element.checked;
    } else {
      enabled =
        element.classList.contains("active") ||
        element.getAttribute("aria-checked") === "true" ||
        element.getAttribute("aria-pressed") === "true";
    }

    if (enabled) {
      const card = element.closest(
        "[data-option], .option-card, .option-item"
      );

      const name =
        card?.dataset.option ||
        card?.querySelector("strong, .option-name, h3")?.textContent ||
        element.dataset.option ||
        "Option";

      selected.push(name.trim());
    }
  });

  return selected;
}

document.querySelectorAll(".wn-switch").forEach(element => {
  if (
    element instanceof HTMLInputElement &&
    element.type === "checkbox"
  ) {
    element.addEventListener("change", () => {
      element.setAttribute(
        "aria-checked",
        element.checked ? "true" : "false"
      );

      if (optionsMessage) {
        optionsMessage.textContent = "";
        optionsMessage.className = "";
      }
    });
  } else {
    element.addEventListener("click", () => {
      const enabled =
        element.getAttribute("aria-checked") === "true" ||
        element.getAttribute("aria-pressed") === "true" ||
        element.classList.contains("active");

      const next = !enabled;

      element.classList.toggle("active", next);
      element.setAttribute(
        "aria-checked",
        next ? "true" : "false"
      );
      element.setAttribute(
        "aria-pressed",
        next ? "true" : "false"
      );

      if (optionsMessage) {
        optionsMessage.textContent = "";
        optionsMessage.className = "";
      }
    });
  }
});

if (activateOptionsButton) {
  activateOptionsButton.addEventListener("click", () => {
    const selected = getSelectedOptions();

    // These are panel selections only; no external app is modified.
    sessionStorage.setItem(
      "windir_selected_options",
      JSON.stringify(selected)
    );

    if (optionsMessage) {
      optionsMessage.textContent =
        "Options activated successfully.";

      optionsMessage.className =
        "success options-success";
    }
  });
}

/* ---------- PROXY CERTIFICATE BUTTON ---------- */

// Certificate is intentionally not downloadable yet.
const certificateButton = $("downloadCertificate");

if (certificateButton) {
  certificateButton.disabled = true;
  certificateButton.setAttribute("aria-disabled", "true");
  certificateButton.title = "Certificate will be available later.";
}

/* ---------- SETTING: KEY INFORMATION ---------- */

function updateSettingKey() {
  setText(
    $("settingKey"),
    maskKey(activeCustomerKey)
  );
}

/* ---------- SETTING: IP DETECTION ---------- */

const settingDetectIpButton = $("settingDetectIp");

if (settingDetectIpButton) {
  settingDetectIpButton.addEventListener("click", async () => {
    settingDetectIpButton.disabled = true;

    setText(
      $("settingIpMessage"),
      "Detecting your IPv4 address..."
    );

    try {
      const ip = await detectPublicIP();

      const settingInput = $("settingIpInput");

      if (settingInput) {
        settingInput.value = ip;
      }

      setText(
        $("settingIpMessage"),
        "IP detected successfully."
      );

    } catch {
      setText(
        $("settingIpMessage"),
        "Could not detect IP. Enter it manually."
      );
    } finally {
      settingDetectIpButton.disabled = false;
    }
  });
}

/* ---------- SETTING: VERIFY AND UPDATE IP ---------- */

const settingUpdateIpButton = $("settingUpdateIp");

if (settingUpdateIpButton) {
  settingUpdateIpButton.addEventListener("click", async () => {
    const newIP = $("settingIpInput")?.value.trim();

    if (!activeCustomerKey) {
      setText(
        $("settingIpMessage"),
        "Your verified session is not available. Log in again."
      );
      return;
    }

    if (!validIPv4(newIP)) {
      setText(
        $("settingIpMessage"),
        "Enter a valid IPv4 address."
      );
      return;
    }

    settingUpdateIpButton.disabled = true;

    setText(
      $("settingIpMessage"),
      "Verifying your new IPv4 address..."
    );

    try {
      const data = await request(API.verify, {
        method: "POST",
        headers: {
          "X-Device": newIP
        },
        body: JSON.stringify({
          key: activeCustomerKey,
          ip: newIP,
          deviceId: getDeviceId(),
          remember: activeCustomerRemember
        })
      });

      if (data.valid === false) {
        throw new Error(
          data.message || "IPv4 verification failed."
        );
      }

      activeCustomerIP = newIP;

      setText(
        $("settingIpStatus"),
        "Verified"
      );

      setText(
        $("settingIpMessage"),
        "IPv4 verified successfully."
      );

      if (data.expires_at || data.expiresAt) {
        setCustomerExpiry(
          data.expires_at || data.expiresAt
        );
      }

    } catch (error) {
      setText(
        $("settingIpMessage"),
        error.message || "Could not update IPv4."
      );
    } finally {
      settingUpdateIpButton.disabled = false;
    }
  });
}

/* ---------- SETTING: KEY EXPIRATION COUNTDOWN ---------- */

function setCustomerExpiry(value) {
  activeExpiry = getExpiryTimestamp(value);

  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }

  const countdown = $("settingCountdown");
  const expiryDate = $("settingExpiryDate");

  if (!activeExpiry) {
    setText(countdown, "Expiration unavailable");
    setText(expiryDate, "Unknown");
    return;
  }

  setText(
    expiryDate,
    new Date(activeExpiry).toLocaleString()
  );

  function updateCountdown() {
    const remaining = activeExpiry - Date.now();

    if (remaining <= 0) {
      setText(countdown, "Expired");
      clearInterval(countdownTimer);
      countdownTimer = null;
      return;
    }

    const totalSeconds = Math.floor(remaining / 1000);

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    setText(
      countdown,
      `${days}d ${hours}h ${minutes}m ${seconds}s`
    );
  }

  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 1000);
}

/* ---------- SETTING: LANGUAGE ---------- */

const languageSelect = $("settingLanguage");

const translations = {
  en: {
    "Options activated successfully.": "Options activated successfully.",
    "Proxy Info": "Proxy Info",
    "Activate Options": "Activate Options",
    "Proxy News": "Proxy News",
    "Your Key": "Your Key",
    "Connection": "Connection",
    "Key Expiration": "Key Expiration",
    "Language": "Language",
    "Session": "Session",
    "Log Out": "Log Out"
  },

  es: {
    "Options activated successfully.": "Opciones activadas correctamente.",
    "Proxy Info": "Información del Proxy",
    "Activate Options": "Activar opciones",
    "Proxy News": "Noticias del Proxy",
    "Your Key": "Tu KEY",
    "Connection": "Conexión",
    "Key Expiration": "Expiración de la KEY",
    "Language": "Idioma",
    "Session": "Sesión",
    "Log Out": "Cerrar sesión"
  }
};

function applyLanguage(language) {
  const selected =
    language === "es" ? "es" : "en";

  localStorage.setItem(LANGUAGE_KEY, selected);
  document.documentElement.lang = selected;

  // Elements marked with data-i18n can be translated directly.
  document.querySelectorAll("[data-i18n]").forEach(element => {
    const original = element.dataset.i18n;
    const translated = translations[selected][original];

    if (translated) {
      element.textContent = translated;
    }
  });

  // Update the language selector when it exists.
  if (languageSelect) {
    languageSelect.value = selected;
  }
}

if (languageSelect) {
  languageSelect.addEventListener("change", () => {
    applyLanguage(languageSelect.value);
  });
}

applyLanguage(localStorage.getItem(LANGUAGE_KEY) || "en");

/* ---------- CUSTOMER LOGOUT ---------- */

const customerLogoutButton = $("customerLogout");

if (customerLogoutButton) {
  customerLogoutButton.addEventListener("click", () => {
    const confirmed = confirm(
      "Log out and remove your locally saved key and device data?"
    );

    if (!confirmed) return;

    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(DEVICE_KEY);

    sessionStorage.removeItem("windir_selected_options");

    if (keyInput) keyInput.value = "";
    if (ipInput) ipInput.value = "";

    if (rememberCheckbox) {
      rememberCheckbox.checked = false;
    }

    setText(ipStatus, "");
    setText($("settingIpMessage"), "");
    setText($("settingIpStatus"), "Not verified");

    customerMessage("");
    showCustomerLogin();
    updateCustomerButton();
  });
}

/* ---------- ADMIN MODAL ---------- */

const modal = $("modal");
const adminOpen = firstElement("adminOpen", "adminButton");
const closeModal = $("close");

function openAdminModal() {
  show(modal, true);
}

function closeAdminModal() {
  show(modal, false);
}

if (adminOpen) {
  adminOpen.addEventListener("click", async () => {
    openAdminModal();
    await checkAdminSession();
  });
}

if (closeModal) {
  closeModal.addEventListener("click", closeAdminModal);
}

if (modal) {
  modal.addEventListener("click", event => {
    if (event.target === modal) {
      closeAdminModal();
    }
  });
}

/* ---------- ADMIN LOGIN ---------- */

const loginView = $("loginView");
const dashboard = $("dash");
const adminLoginButton = $("login");

function adminError(message) {
  setText($("loginErr"), message);
}

function showDashboard(user) {
  show(loginView, false);
  show(dashboard, true);

  setText(
    $("adminName"),
    user.username || user.name || "Admin"
  );

  setText(
    $("adminRole"),
    user.role || "ADMIN"
  );

  show(
    $("ownerPanel"),
    String(user.role || "").toUpperCase() === "OWNER"
  );

  loadKeys();

  if (String(user.role || "").toUpperCase() === "OWNER") {
    loadAdmins();
  }
}

function showLogin() {
  show(dashboard, false);
  show(loginView, true);
}

if (adminLoginButton) {
  adminLoginButton.addEventListener("click", async () => {
    const username = $("username")?.value.trim();
    const password = $("password")?.value;

    if (!username || !password) {
      adminError("Enter your username and password.");
      return;
    }

    adminLoginButton.disabled = true;
    adminError("Checking credentials...");

    try {
      const data = await request(API.login, {
        method: "POST",
        body: JSON.stringify({ username, password })
      });

      if (!data.token) {
        throw new Error(
          "Server did not return a login token."
        );
      }

      sessionStorage.setItem(
        ADMIN_TOKEN_KEY,
        data.token
      );

      const user = data.user || {
        username,
        role: data.role || "ADMIN"
      };

      adminError("");
      showDashboard(user);

    } catch (error) {
      adminError(
        error.message || "Login failed."
      );
    } finally {
      adminLoginButton.disabled = false;
    }
  });
}

/* Enter key submits admin login */

["username", "password"].forEach(id => {
  const input = $(id);

  if (input) {
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        adminLoginButton?.click();
      }
    });
  }
});

/* Restore admin session */

async function checkAdminSession() {
  const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);

  if (!token) {
    showLogin();
    return;
  }

  try {
    const data = await request(API.me, {}, true);
    const user = data.user || data.admin || data;

    showDashboard(user);

  } catch {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    showLogin();
  }
}

/* ---------- ADMIN KEY MANAGEMENT ---------- */

const makeKeyButton = $("make");

async function loadKeys() {
  const container = $("keys");
  if (!container) return;

  container.replaceChildren(
    createElement("p", "", "Loading keys...")
  );

  try {
    const data = await request(API.keys, {}, true);
    const keys = Array.isArray(data)
      ? data
      : (data.keys || []);

    container.replaceChildren();

    if (!keys.length) {
      container.append(
        createElement("p", "", "No keys created yet.")
      );
      return;
    }

    keys.forEach(key => {
      const item = createElement("div", "key-item");

      const title = createElement(
        "strong",
        "",
        key.label || "Unassigned key"
      );

      const details = createElement(
        "p",
        "",
        `Created: ${formatDate(key.created_at || key.createdAt)}`
      );

      const expiry = createElement(
        "p",
        "",
        `Expires: ${formatDate(key.expires_at || key.expiresAt)}`
      );

      const limit = Number(
        key.max_devices ?? key.maxDevices ?? 1
      );

      const devices = createElement(
        "p",
        "",
        `Device limit: ${limit === 0 ? "Unlimited" : limit}`
      );

      const status = createElement(
        "p",
        "",
        key.revoked ? "REVOKED" : "ACTIVE"
      );

      const buttons = createElement("div", "key-actions");

      const viewButton = createElement(
        "button",
        "ghost",
        "VIEW DEVICES"
      );

      viewButton.type = "button";

      viewButton.addEventListener("click", () => {
        loadDevices(key.id);
      });

      buttons.append(viewButton);

      if (!key.revoked) {
        const revokeButton = createElement(
          "button",
          "ghost",
          "REVOKE KEY"
        );

        revokeButton.type = "button";

        revokeButton.addEventListener("click", async () => {
          if (!confirm("Revoke this key?")) return;

          try {
            await request(
              `${API.keys}/${encodeURIComponent(key.id)}/revoke`,
              {
                method: "POST",
                body: JSON.stringify({})
              },
              true
            );

            await loadKeys();

          } catch (error) {
            alert(error.message);
          }
        });

        buttons.append(revokeButton);
      }

      item.append(
        title,
        details,
        expiry,
        devices,
        status,
        buttons
      );

      container.append(item);
    });

  } catch (error) {
    container.replaceChildren(
      createElement("p", "", error.message)
    );
  }
}

/* Generate key */

if (makeKeyButton) {
  makeKeyButton.addEventListener("click", async () => {
    const label = $("label")?.value.trim() || "";
    const days = Number($("days")?.value || 7);
    const maxDevices = Number(
      $("maxDevices")?.value || 1
    );

    makeKeyButton.disabled = true;
    setText($("newKey"), "Generating key...");

    try {
      const data = await request(API.keys, {
        method: "POST",
        body: JSON.stringify({
          label,
          days,
          maxDevices
        })
      }, true);

      const generated = data.key || data.accessKey;

      if (!generated) {
        throw new Error(
          "The server did not return the generated key."
        );
      }

      const output = $("newKey");
      output.replaceChildren();

      const keyText = createElement(
        "strong",
        "",
        generated
      );

      const copyButton = createElement(
        "button",
        "ghost",
        "COPY KEY"
      );

      copyButton.type = "button";

      copyButton.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(generated);
          copyButton.textContent = "COPIED!";
        } catch {
          alert(
            "Could not copy automatically. Select and copy the key."
          );
        }
      });

      output.append(keyText, copyButton);

      if ($("label")) {
        $("label").value = "";
      }

      await loadKeys();

    } catch (error) {
      setText($("newKey"), error.message);
    } finally {
      makeKeyButton.disabled = false;
    }
  });
}

/* ---------- DEVICE MANAGEMENT ---------- */

async function loadDevices(keyId) {
  const container = $("deviceList");
  if (!container) return;

  container.replaceChildren(
    createElement("p", "", "Loading registered devices...")
  );

  try {
    const data = await request(
      `${API.keys}/${encodeURIComponent(keyId)}/devices`,
      {},
      true
    );

    const devices = Array.isArray(data)
      ? data
      : (data.devices || []);

    container.replaceChildren();

    if (!devices.length) {
      container.append(
        createElement("p", "", "No registered devices.")
      );
      return;
    }

    devices.forEach(device => {
      const item = createElement("div", "device-item");

      item.append(
        createElement(
          "strong",
          "",
          `Device: ${device.device_id || device.deviceId || "Unknown"}`
        ),
        createElement(
          "p",
          "",
          `IP: ${device.ip || "Unknown"}`
        ),
        createElement(
          "p",
          "",
          `Last seen: ${formatDate(device.last_seen || device.lastSeen)}`
        )
      );

      if (!device.revoked) {
        const revoke = createElement(
          "button",
          "ghost",
          "REMOVE DEVICE"
        );

        revoke.type = "button";

        revoke.addEventListener("click", async () => {
          if (!confirm("Remove this device from the key?")) {
            return;
          }

          const deviceId =
            device.device_id || device.deviceId;

          try {
            await request(
              `${API.keys}/${encodeURIComponent(keyId)}/devices/${encodeURIComponent(deviceId)}`,
              { method: "DELETE" },
              true
            );

            await loadDevices(keyId);
            await loadKeys();

          } catch (error) {
            alert(error.message);
          }
        });

        item.append(revoke);

      } else {
        item.append(
          createElement("p", "", "DEVICE REVOKED")
        );
      }

      container.append(item);
    });

  } catch (error) {
    container.replaceChildren(
      createElement("p", "", error.message)
    );
  }
}

/* ---------- OWNER: ADMIN MANAGEMENT ---------- */

const createAdminButton = $("createAdmin");

async function loadAdmins() {
  const container = $("adminList");
  if (!container) return;

  container.replaceChildren(
    createElement("p", "", "Loading administrators...")
  );

  try {
    const data = await request(API.admins, {}, true);

    const admins = Array.isArray(data)
      ? data
      : (data.users || data.admins || []);

    container.replaceChildren();

    if (!admins.length) {
      container.append(
        createElement("p", "", "No administrators found.")
      );
      return;
    }

    admins.forEach(admin => {
      const item = createElement("div", "admin-item");

      item.append(
        createElement(
          "strong",
          "",
          admin.username || "Unknown"
        ),
        createElement(
          "p",
          "",
          `Role: ${admin.role || "ADMIN"}`
        )
      );

      if (String(admin.role).toUpperCase() !== "OWNER") {
        const removeButton = createElement(
          "button",
          "ghost",
          "DELETE ADMIN"
        );

        removeButton.type = "button";

        removeButton.addEventListener("click", async () => {
          if (!confirm(`Delete admin ${admin.username}?`)) {
            return;
          }

          try {
            await request(
              `${API.admins}/${encodeURIComponent(admin.id)}`,
              { method: "DELETE" },
              true
            );

            await loadAdmins();

          } catch (error) {
            alert(error.message);
          }
        });

        item.append(removeButton);
      }

      container.append(item);
    });

  } catch (error) {
    container.replaceChildren(
      createElement("p", "", error.message)
    );
  }
}

/* Create admin */

if (createAdminButton) {
  createAdminButton.addEventListener("click", async () => {
    const username = $("newAdminUser")?.value.trim();
    const password = $("newAdminPassword")?.value;

    if (!username || !password) {
      setText(
        $("adminMessage"),
        "Enter username and password."
      );
      return;
    }

    if (password.length < 12) {
      setText(
        $("adminMessage"),
        "Password must have at least 12 characters."
      );
      return;
    }

    createAdminButton.disabled = true;

    setText(
      $("adminMessage"),
      "Creating administrator..."
    );

    try {
      await request(API.admins, {
        method: "POST",
        body: JSON.stringify({ username, password })
      }, true);

      setText(
        $("adminMessage"),
        "Administrator created successfully."
      );

      $("newAdminUser").value = "";
      $("newAdminPassword").value = "";

      await loadAdmins();

    } catch (error) {
      setText(
        $("adminMessage"),
        error.message
      );
    } finally {
      createAdminButton.disabled = false;
    }
  });
}

/* ---------- ADMIN LOGOUT ---------- */

const logoutButton = $("logout");

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    try {
      await request(API.logout, {
        method: "POST",
        body: JSON.stringify({})
      }, true);
    } catch {
      // Clear local session even if server logout fails.
    }

    sessionStorage.removeItem(ADMIN_TOKEN_KEY);

    showLogin();

    if ($("username")) $("username").value = "";
    if ($("password")) $("password").value = "";

    adminError("You have logged out.");
  });
}

/* ---------- BACKGROUND PARTICLES ---------- */

(function particlesAnimation() {
  const canvas = $("particles");

  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let width = 0;
  let height = 0;
  let particles = [];
  let animationFrame = null;

  function resize() {
    const ratio = Math.min(
      window.devicePixelRatio || 1,
      2
    );

    width = window.innerWidth;
    height = window.innerHeight;

    canvas.width = width * ratio;
    canvas.height = height * ratio;

    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const count = Math.min(
      85,
      Math.max(
        25,
        Math.floor(width * height / 14000)
      )
    );

    particles = Array.from(
      { length: count },
      () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 2 + 0.5,
        speed: Math.random() * 0.35 + 0.08,
        opacity: Math.random() * 0.5 + 0.15
      })
    );
  }

  function animate() {
    ctx.clearRect(0, 0, width, height);

    for (const particle of particles) {
      particle.y -= particle.speed;

      if (particle.y < -5) {
        particle.y = height + 5;
        particle.x = Math.random() * width;
      }

      ctx.beginPath();

      ctx.arc(
        particle.x,
        particle.y,
        particle.size,
        0,
        Math.PI * 2
      );

      ctx.fillStyle =
        `rgba(255, 35, 45, ${particle.opacity})`;

      ctx.fill();
    }

    animationFrame = requestAnimationFrame(animate);
  }

  window.addEventListener("resize", resize);

  resize();
  animate();

  // Pause animation when the page is not visible.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
    } else if (!animationFrame) {
      animate();
    }
  });
})();