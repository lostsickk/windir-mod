"use strict";

/* =========================================
   WINDIR PROXY — APP.JS
   Blue Edition
========================================= */

const $ = (id) => document.getElementById(id);

const API = {
  verify: "/api/keys/verify",
  verifyLegacy: "/api/verify-key",
  adminLogin: "/api/admin/login",
  adminMe: "/api/admin/me",
  adminLogout: "/api/admin/logout",
  adminKeys: "/api/admin/keys",
  adminUsers: "/api/admin/users"
};

const STORAGE = {
  savedKey: "windir_saved_key",
  deviceId: "windir_device_id",
  adminToken: "windir_admin_token",
  expiry: "windir_key_expiry",
  verifiedIp: "windir_verified_ip"
};

let currentKey = "";
let currentExpiry = null;
let currentIp = "";
let adminToken = localStorage.getItem(STORAGE.adminToken) || "";
let adminUser = null;
let expiryTimer = null;

/* =========================================
   HELPERS
========================================= */

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value ?? "";
}

function show(id, visible = true) {
  const element = $(id);
  if (element) element.hidden = !visible;
}

function message(id, text, color) {
  const element = $(id);
  if (!element) return;

  element.textContent = text;
  element.style.display = text ? "block" : "none";

  if (color) element.style.color = color;
}

function escapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function getDeviceId() {
  let id = localStorage.getItem(STORAGE.deviceId);

  if (!id) {
    id = crypto.randomUUID
      ? crypto.randomUUID()
      : "device-" + Date.now() + "-" +
        Math.random().toString(36).slice(2);

    localStorage.setItem(STORAGE.deviceId, id);
  }

  return id;
}

async function request(url, options = {}, authenticated = false) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (authenticated && adminToken) {
    headers.Authorization = `Bearer ${adminToken}`;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  const raw = await response.text();
  let data = {};

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { message: raw };
  }

  if (!response.ok) {
    throw new Error(
      data.message ||
      data.error ||
      `Request failed (${response.status})`
    );
  }

  return data;
}

function validIPv4(ip) {
  const parts = String(ip || "").trim().split(".");

  return parts.length === 4 && parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const number = Number(part);
    return number >= 0 && number <= 255;
  });
}

async function detectIP() {
  const response = await fetch(
    "https://api.ipify.org?format=json",
    { cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error("Could not detect your IP address.");
  }

  const data = await response.json();

  if (!validIPv4(data.ip)) {
    throw new Error("Invalid IPv4 address received.");
  }

  return data.ip;
}

/* =========================================
   CUSTOMER LOGIN SCREEN
========================================= */

function showCustomerMenu() {
  show("loginScreen", false);
  show("mainMenu", true);

  updateSettingInformation();
  startExpiryCountdown();
}

function showLoginScreen() {
  show("loginScreen", true);
  show("mainMenu", false);
}

function getSavedKey() {
  return localStorage.getItem(STORAGE.savedKey) || "";
}

function saveCustomerSession(data, key, ip) {
  currentKey = key;
  currentIp = ip;

  currentExpiry =
    data.expires_at ||
    data.expiresAt ||
    data.expiry ||
    null;

  localStorage.setItem(STORAGE.savedKey, key);
  localStorage.setItem(STORAGE.verifiedIp, ip);

  if (currentExpiry) {
    localStorage.setItem(STORAGE.expiry, currentExpiry);
  } else {
    localStorage.removeItem(STORAGE.expiry);
  }

  updateSettingInformation();
}

function updateSettingInformation() {
  setText("settingKey", currentKey || "No active key");

  const ipInput = $("settingIpInput");
  if (ipInput && currentIp) {
    ipInput.value = currentIp;
  }

  const expiry = $("settingExpiryDate");

  if (expiry) {
    expiry.textContent = currentExpiry
      ? new Date(currentExpiry).toLocaleString()
      : "Expiration information unavailable";
  }
}

/* =========================================
   KEY VERIFICATION
========================================= */

async function verifyCustomerKey(key, ip, remember = true) {
  const deviceId = getDeviceId();

  const payload = {
    key,
    ip,
    deviceId,
    remember
  };

  try {
    return await request(API.verify, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  } catch (error) {
    /*
      Compatibility with the previous API.
      The legacy route receives the original
      { key, ip } payload.
    */

    if (
      error.message.includes("404") ||
      error.message.includes("Not Found")
    ) {
      return await request(API.verifyLegacy, {
        method: "POST",
        headers: {
          "X-Device": deviceId
        },
        body: JSON.stringify({ key, ip })
      });
    }

    throw error;
  }
}

async function loginCustomer() {
  const key = $("keyInput")?.value.trim() || "";
  const ip = $("ipInput")?.value.trim() || "";
  const remember = $("saveKey")?.checked ?? true;
  const button = $("loginButton");

  if (!key) {
    message("status", "Please enter your license key.", "#ff7189");
    return;
  }

  if (!validIPv4(ip)) {
    message("status", "Please enter a valid IPv4 address.", "#ff7189");
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "VERIFYING...";
  }

  message("status", "Verifying your license key...", "#9bbcff");

  try {
    const data = await verifyCustomerKey(key, ip, remember);

    if (data.valid === false || data.ok === false) {
      throw new Error(data.message || "Invalid or expired key.");
    }

    saveCustomerSession(data, key, ip);

    if (remember) {
      localStorage.setItem(STORAGE.savedKey, key);
    } else {
      localStorage.removeItem(STORAGE.savedKey);
    }

    message(
      "status",
      data.message || "License verified successfully.",
      "#72f3cd"
    );

    showCustomerMenu();

  } catch (error) {
    message(
      "status",
      error.message || "Unable to verify your key.",
      "#ff7189"
    );
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "ACCESS PANEL";
    }
  }
}

/* =========================================
   AUTOMATIC IP DETECTION
========================================= */

async function detectLoginIP() {
  const button = $("detectIpButton");

  if (button) {
    button.disabled = true;
    button.textContent = "DETECTING...";
  }

  message("ipStatus", "Detecting IPv4 address...", "#9bbcff");

  try {
    const ip = await detectIP();

    if ($("ipInput")) $("ipInput").value = ip;
    message("ipStatus", `IPv4 detected: ${ip}`, "#72f3cd");

  } catch (error) {
    message("ipStatus", error.message, "#ff7189");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "AUTO-DETECT";
    }
  }
}

async function detectSettingIP() {
  const button = $("settingDetectIp");

  if (button) {
    button.disabled = true;
    button.textContent = "DETECTING...";
  }

  try {
    const ip = await detectIP();

    if ($("settingIpInput")) {
      $("settingIpInput").value = ip;
    }

    message("settingIpMessage", `IPv4 detected: ${ip}`, "#72f3cd");

  } catch (error) {
    message("settingIpMessage", error.message, "#ff7189");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "AUTO-DETECT";
    }
  }
}

/* =========================================
   UPDATE VERIFIED IP
========================================= */

async function updateCustomerIP() {
  const newIP = $("settingIpInput")?.value.trim() || "";

  if (!validIPv4(newIP)) {
    message("settingIpMessage", "Enter a valid IPv4 address.", "#ff7189");
    return;
  }

  if (!currentKey) {
    message("settingIpMessage", "No active license key.", "#ff7189");
    return;
  }

  const button = $("settingUpdateIp");

  if (button) {
    button.disabled = true;
    button.textContent = "VERIFYING...";
  }

  message(
    "settingIpMessage",
    "Verifying the new IPv4 address...",
    "#9bbcff"
  );

  try {
    const data = await verifyCustomerKey(
      currentKey,
      newIP,
      true
    );

    if (data.valid === false || data.ok === false) {
      throw new Error(data.message || "IPv4 update rejected.");
    }

    currentIp = newIP;
    localStorage.setItem(STORAGE.verifiedIp, newIP);

    message(
      "settingIpMessage",
      "IPv4 verified and updated successfully.",
      "#72f3cd"
    );

    updateSettingInformation();

  } catch (error) {
    message("settingIpMessage", error.message, "#ff7189");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "VERIFY & UPDATE IPv4";
    }
  }
}

/* =========================================
   CUSTOMER LOGOUT
========================================= */

function customerLogout() {
  localStorage.removeItem(STORAGE.savedKey);
  localStorage.removeItem(STORAGE.expiry);
  localStorage.removeItem(STORAGE.verifiedIp);

  currentKey = "";
  currentIp = "";
  currentExpiry = null;

  if (expiryTimer) {
    clearInterval(expiryTimer);
    expiryTimer = null;
  }

  if ($("keyInput")) $("keyInput").value = "";
  if ($("ipInput")) $("ipInput").value = "";

  showLoginScreen();
  message("status", "Your session has been cleared.", "#9bbcff");
}

/* =========================================
   EXPIRATION COUNTDOWN
========================================= */

function startExpiryCountdown() {
  if (expiryTimer) {
    clearInterval(expiryTimer);
  }

  const savedExpiry = currentExpiry ||
    localStorage.getItem(STORAGE.expiry);

  const element = $("settingExpiryDate");

  if (!savedExpiry) {
    if (element) {
      element.textContent = "Expiration information unavailable";
    }
    return;
  }

  const expiryTime = new Date(savedExpiry).getTime();

  if (!Number.isFinite(expiryTime)) {
    if (element) {
      element.textContent = "Invalid expiration date";
    }
    return;
  }

  function updateCountdown() {
    const remaining = expiryTime - Date.now();

    if (remaining <= 0) {
      if (element) element.textContent = "Key expired";
      clearInterval(expiryTimer);
      expiryTimer = null;
      return;
    }

    const seconds = Math.floor(remaining / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (element) {
      element.textContent =
        `${days}d ${hours}h ${minutes}m ${secs}s remaining`;
    }
  }

  updateCountdown();
  expiryTimer = setInterval(updateCountdown, 1000);
}

/* =========================================
   MAIN OPTIONS
========================================= */

function initializeOptions() {
  const button = $("activateOptions");
  const output = $("optionsMessage");

  if (!button) return;

  button.addEventListener("click", () => {
    const selected = [
      ...document.querySelectorAll(".wn-switch:checked")
    ];

    if (selected.length === 0) {
      if (output) {
        output.textContent = "Please select at least one option.";
        output.style.color = "#ff7189";
      }
      return;
    }

    /*
      This saves the visual selection in this browser.
      Actual game modification requires a separate
      authorized integration.
    */

    const values = selected.map((input) => input.value);

    localStorage.setItem(
      "windir_selected_options",
      JSON.stringify(values)
    );

    if (output) {
      output.textContent = "✓ Options activated successfully.";
      output.style.color = "#72f3cd";
    }
  });

  try {
    const saved = JSON.parse(
      localStorage.getItem("windir_selected_options") || "[]"
    );

    document.querySelectorAll(".wn-switch").forEach((input) => {
      input.checked = saved.includes(input.value);
    });
  } catch {
    localStorage.removeItem("windir_selected_options");
  }
}

/* =========================================
   MENU NAVIGATION
========================================= */

function initializeTabs() {
  const tabs = document.querySelectorAll("[data-tab]");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const name = tab.dataset.tab;

      tabs.forEach((item) => {
        item.classList.toggle("active", item === tab);
      });

      document.querySelectorAll(".tab-content").forEach((panel) => {
        panel.hidden = panel.id !== `tab-${name}`;
      });
    });
  });
}

/* =========================================
   ADMIN PANEL
========================================= */

function openAdminModal() {
  show("modal", true);
}

function closeAdminModal() {
  show("modal", false);
}

function setAdminLoggedIn(user) {
  adminUser = user || {};

  show("loginView", false);
  show("dash", true);

  setText(
    "adminName",
    adminUser.username || adminUser.user || "Administrator"
  );

  setText(
    "adminRole",
    adminUser.role || "ADMIN"
  );

  const ownerPanel = $("ownerPanel");

  if (ownerPanel) {
    ownerPanel.hidden =
      String(adminUser.role || "").toUpperCase() !== "OWNER";
  }
}

function setAdminLoggedOut() {
  adminToken = "";
  adminUser = null;

  localStorage.removeItem(STORAGE.adminToken);

  show("loginView", true);
  show("dash", false);
}

async function adminLogin() {
  const username = $("username")?.value.trim() || "";
  const password = $("password")?.value || "";
  const button = $("login");

  if (!username || !password) {
    message("loginErr", "Enter your username and password.", "#ff7189");
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "PLEASE WAIT...";
  }

  message("loginErr", "Authenticating...", "#9bbcff");

  try {
    const data = await request(API.adminLogin, {
      method: "POST",
      body: JSON.stringify({ username, password })
    });

    const token =
      data.token ||
      data.accessToken ||
      data.session?.token;

    if (!token) {
      throw new Error("The server did not return an admin token.");
    }

    adminToken = token;
    localStorage.setItem(STORAGE.adminToken, token);

    const user = data.admin || data.user || data;

    setAdminLoggedIn(user);

    message("loginErr", "", "");

    await loadAdminDashboard();

  } catch (error) {
    message("loginErr", error.message, "#ff7189");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "LOGIN";
    }
  }
}

async function restoreAdminSession() {
  if (!adminToken) return;

  try {
    const data = await request(
      API.adminMe,
      { method: "GET" },
      true
    );

    setAdminLoggedIn(data.admin || data.user || data);
    await loadAdminDashboard();

  } catch {
    setAdminLoggedOut();
  }
}

async function adminLogout() {
  try {
    await request(
      API.adminLogout,
      { method: "POST", body: "{}" },
      true
    );
  } catch {
    // Local logout still proceeds if the server session expired.
  }

  setAdminLoggedOut();
}

/* =========================================
   ADMIN KEY MANAGEMENT
========================================= */

function getArray(data, possibleNames) {
  if (Array.isArray(data)) return data;

  for (const name of possibleNames) {
    if (Array.isArray(data?.[name])) {
      return data[name];
    }
  }

  return [];
}

async function createAdminKey() {
  const label = $("label")?.value.trim() || "";
  const days = Number($("days")?.value || 30);
  const maxDevices = Number($("maxDevices")?.value || 1);
  const button = $("make");

  if (!Number.isFinite(days) || days < 1) {
    message("adminMessage", "Enter a valid number of days.", "#ff7189");
    return;
  }

  if (!Number.isFinite(maxDevices) || maxDevices < 1) {
    message("adminMessage", "Enter a valid device limit.", "#ff7189");
    return;
  }

  if (button) button.disabled = true;

  message("adminMessage", "Generating license key...", "#9bbcff");

  try {
    const data = await request(
      API.adminKeys,
      {
        method: "POST",
        body: JSON.stringify({
          label,
          days,
          maxDevices
        })
      },
      true
    );

    const key =
      data.key ||
      data.licenseKey ||
      data.license_key ||
      data.data?.key;

    setText(
      "newKey",
      key || data.message || "Key created."
    );

    message("adminMessage", "License key created successfully.", "#72f3cd");

    await loadAdminKeys();

  } catch (error) {
    message("adminMessage", error.message, "#ff7189");
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadAdminKeys() {
  const container = $("keys");
  if (!container) return;

  container.textContent = "Loading keys...";

  try {
    const data = await request(
      API.adminKeys,
      { method: "GET" },
      true
    );

    const keys = getArray(data, ["keys", "data", "items"]);

    container.innerHTML = "";

    if (!keys.length) {
      container.textContent = "No license keys found.";
      return;
    }

    keys.forEach((item) => {
      const card = document.createElement("div");

      const key = item.key || item.license_key || item.code || "Unknown";
      const status = item.status || (item.active ? "Active" : "Unknown");
      const id = item.id;

      card.innerHTML = `
        <strong>${escapeText(key)}</strong>
        <p>Status: ${escapeText(status)}</p>
        <p>Label: ${escapeText(item.label || "—")}</p>
        <p>Expires: ${escapeText(item.expires_at || "—")}</p>
        <p>Devices: ${escapeText(item.devices_used ?? 0)}
        / ${escapeText(item.max_devices ?? item.maxDevices ?? 1)}</p>
      `;

      if (id !== undefined) {
        const revoke = document.createElement("button");
        revoke.className = "danger-button";
        revoke.textContent = "REVOKE KEY";

        revoke.addEventListener("click", () => {
          revokeAdminKey(id);
        });

        card.appendChild(revoke);
      }

      container.appendChild(card);
    });

  } catch (error) {
    container.textContent = `Could not load keys: ${error.message}`;
  }
}

async function revokeAdminKey(id) {
  if (!confirm("Are you sure you want to revoke this key?")) return;

  try {
    await request(
      `${API.adminKeys}/${encodeURIComponent(id)}`,
      { method: "DELETE" },
      true
    );

    await loadAdminKeys();

  } catch (error) {
    alert(error.message);
  }
}

/* =========================================
   ADMIN DEVICES
========================================= */

async function loadAdminDevices() {
  const container = $("deviceList");
  if (!container) return;

  container.textContent = "Loading devices...";

  try {
    const data = await request(
      "/api/admin/devices",
      { method: "GET" },
      true
    );

    const devices = getArray(data, ["devices", "data", "items"]);

    container.innerHTML = "";

    if (!devices.length) {
      container.textContent = "No registered devices.";
      return;
    }

    devices.forEach((device) => {
      const card = document.createElement("div");

      card.innerHTML = `
        <strong>${escapeText(device.key || device.license_key || "License")}</strong>
        <p>IP: ${escapeText(device.ip || "Unknown")}</p>
        <p>Device: ${escapeText(device.device_id || device.deviceId || "Unknown")}</p>
      `;

      const id = device.id;

      if (id !== undefined) {
        const remove = document.createElement("button");
        remove.className = "danger-button";
        remove.textContent = "REMOVE DEVICE";

        remove.addEventListener("click", () => {
          revokeAdminDevice(id);
        });

        card.appendChild(remove);
      }

      container.appendChild(card);
    });

  } catch (error) {
    container.textContent = `Could not load devices: ${error.message}`;
  }
}

async function revokeAdminDevice(id) {
  if (!confirm("Remove this registered device?")) return;

  try {
    await request(
      `/api/admin/devices/${encodeURIComponent(id)}`,
      { method: "DELETE" },
      true
    );

    await loadAdminDevices();

  } catch (error) {
    alert(error.message);
  }
}

/* =========================================
   OWNER ADMIN MANAGEMENT
========================================= */

async function createAdminUser() {
  const username = $("newAdminUser")?.value.trim() || "";
  const password = $("newAdminPassword")?.value || "";
  const button = $("createAdmin");

  if (!username || !password) {
    message("adminMessage", "Enter the new admin username and password.", "#ff7189");
    return;
  }

  if (button) button.disabled = true;

  try {
    await request(
      API.adminUsers,
      {
        method: "POST",
        body: JSON.stringify({ username, password })
      },
      true
    );

    if ($("newAdminUser")) $("newAdminUser").value = "";
    if ($("newAdminPassword")) $("newAdminPassword").value = "";

    message("adminMessage", "Administrator created successfully.", "#72f3cd");

    await loadAdminUsers();

  } catch (error) {
    message("adminMessage", error.message, "#ff7189");
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadAdminUsers() {
  const container = $("adminList");
  if (!container) return;

  try {
    const data = await request(
      API.adminUsers,
      { method: "GET" },
      true
    );

    const users = getArray(data, ["admins", "users", "data", "items"]);

    container.innerHTML = "";

    if (!users.length) {
      container.textContent = "No administrators found.";
      return;
    }

    users.forEach((user) => {
      const card = document.createElement("div");

      card.innerHTML = `
        <strong>${escapeText(user.username || user.user || "Admin")}</strong>
        <p>Role: ${escapeText(user.role || "ADMIN")}</p>
      `;

      if (
        user.id !== undefined &&
        String(user.role || "").toUpperCase() !== "OWNER"
      ) {
        const remove = document.createElement("button");
        remove.className = "danger-button";
        remove.textContent = "DELETE ADMIN";

        remove.addEventListener("click", () => {
          deleteAdminUser(user.id);
        });

        card.appendChild(remove);
      }

      container.appendChild(card);
    });

  } catch (error) {
    container.textContent = `Could not load administrators: ${error.message}`;
  }
}

async function deleteAdminUser(id) {
  if (!confirm("Delete this administrator account?")) return;

  try {
    await request(
      `${API.adminUsers}/${encodeURIComponent(id)}`,
      { method: "DELETE" },
      true
    );

    await loadAdminUsers();

  } catch (error) {
    alert(error.message);
  }
}

/* =========================================
   ADMIN DASHBOARD
========================================= */

async function loadAdminDashboard() {
  await Promise.allSettled([
    loadAdminKeys(),
    loadAdminDevices(),
    loadAdminUsers()
  ]);
}

/* =========================================
   ADMIN EVENT LISTENERS
========================================= */

function initializeAdmin() {
  $("adminOpen")?.addEventListener("click", openAdminModal);
  $("close")?.addEventListener("click", closeAdminModal);

  $("modal")?.addEventListener("click", (event) => {
    if (event.target === $("modal")) {
      closeAdminModal();
    }
  });

  $("login")?.addEventListener("click", adminLogin);
  $("make")?.addEventListener("click", createAdminKey);
  $("createAdmin")?.addEventListener("click", createAdminUser);
  $("logout")?.addEventListener("click", adminLogout);
}

/* =========================================
   BLUE PARTICLE ANIMATION
========================================= */

function initializeParticles() {
  const canvas = $("particles");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let width = 0;
  let height = 0;
  let particles = [];

  const particleCount = Math.min(
    65,
    Math.max(25, Math.floor(window.innerWidth / 12))
  );

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);

    width = window.innerWidth;
    height = window.innerHeight;

    canvas.width = width * ratio;
    canvas.height = height * ratio;

    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    particles = Array.from({ length: particleCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 2 + .5,
      speed: Math.random() * .35 + .12,
      opacity: Math.random() * .5 + .15,
      drift: (Math.random() - .5) * .25
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    particles.forEach((particle, index) => {
      particle.y -= particle.speed;
      particle.x += particle.drift;

      if (particle.y < -5) {
        particle.y = height + 5;
        particle.x = Math.random() * width;
      }

      if (particle.x < -5) particle.x = width + 5;
      if (particle.x > width + 5) particle.x = -5;

      ctx.beginPath();
      ctx.arc(
        particle.x,
        particle.y,
        particle.size,
        0,
        Math.PI * 2
      );

      ctx.fillStyle = `rgba(91, 151, 255, ${particle.opacity})`;
      ctx.shadowBlur = 10;
      ctx.shadowColor = "#477bff";
      ctx.fill();

      /*
        Connect nearby particles with subtle blue lines.
      */

      for (let i = index + 1; i < particles.length; i++) {
        const other = particles[i];
        const dx = particle.x - other.x;
        const dy = particle.y - other.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 105) {
          ctx.beginPath();
          ctx.moveTo(particle.x, particle.y);
          ctx.lineTo(other.x, other.y);

          ctx.strokeStyle =
            `rgba(79, 119, 255, ${.09 * (1 - distance / 105)})`;

          ctx.lineWidth = .6;
          ctx.stroke();
        }
      }
    });

    ctx.shadowBlur = 0;
    requestAnimationFrame(draw);
  }

  resize();
  draw();

  window.addEventListener("resize", resize);
}

/* =========================================
   RESTORE CUSTOMER SESSION
========================================= */

async function restoreCustomerSession() {
  const savedKey = getSavedKey();

  if ($("keyInput") && savedKey) {
    $("keyInput").value = savedKey;
  }

  const savedIP = localStorage.getItem(STORAGE.verifiedIp);

  if ($("ipInput") && savedIP) {
    $("ipInput").value = savedIP;
  }

  /*
    A saved key is not automatically considered verified.
    The customer must verify it again with the server.
  */

  currentExpiry = localStorage.getItem(STORAGE.expiry);
  currentKey = "";
  currentIp = "";
  showLoginScreen();
}

/* =========================================
   INITIALIZATION
========================================= */

document.addEventListener("DOMContentLoaded", async () => {
  $("loginButton")?.addEventListener("click", loginCustomer);

  $("detectIpButton")?.addEventListener("click", detectLoginIP);

  $("clearKey")?.addEventListener("click", () => {
    localStorage.removeItem(STORAGE.savedKey);

    if ($("keyInput")) {
      $("keyInput").value = "";
    }

    message("status", "Saved license key removed.", "#9bbcff");
  });

  $("settingDetectIp")?.addEventListener("click", detectSettingIP);

  $("settingUpdateIp")?.addEventListener("click", updateCustomerIP);

  $("customerLogout")?.addEventListener("click", customerLogout);

  initializeTabs();
  initializeOptions();
  initializeAdmin();
  initializeParticles();

  await restoreCustomerSession();
  await restoreAdminSession();
});
