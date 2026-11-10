"use strict";

/* =====================================
   WINDIR PROXY - APP.JS
===================================== */

const $ = (id) => document.getElementById(id);

const loginScreen = $("loginScreen");
const mainMenu = $("mainMenu");
const modal = $("modal");

let customerData = null;
let adminToken = null;
let adminRole = null;

/* =====================================
   VISIBILITY FIX
===================================== */

function show(element, visible) {
  if (!element) return;

  element.hidden = !visible;
  element.classList.toggle("hidden", !visible);
}

function message(element, text, type = "") {
  if (!element) return;

  element.textContent = text;
  element.className = "status-message";

  if (type) {
    element.classList.add(type);
  }
}

/* =====================================
   API REQUEST
===================================== */

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.ok === false) {
      throw new Error(data.message || "Request failed.");
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("The server took too long to respond.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/* =====================================
   DEVICE ID
===================================== */

function getDeviceId() {
  let id = localStorage.getItem("windir_device_id");

  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("windir_device_id", id);
  }

  return id;
}

/* =====================================
   CUSTOMER LOGIN
===================================== */

function updateCustomerButton() {
  const button = $("loginButton");

  if (button) {
    button.disabled = false;
    button.innerHTML = `
      <span>ENTER KEY</span>
      <span class="button-arrow">→</span>
    `;
  }
}

function validIPv4(ip) {
  const parts = ip.trim().split(".");

  if (parts.length !== 4) return false;

  return parts.every(part => {
    if (!/^\d{1,3}$/.test(part)) return false;

    const number = Number(part);

    return number >= 0 && number <= 255;
  });
}

async function detectIP(input, statusElement) {
  if (statusElement) {
    statusElement.textContent = "Detecting IP...";
  }

  try {
    const response = await fetch("https://api.ipify.org?format=json");
    const data = await response.json();

    if (!validIPv4(data.ip)) {
      throw new Error("Invalid IP returned.");
    }

    input.value = data.ip;

    if (statusElement) {
      statusElement.textContent = "IP detected successfully.";
    }
  } catch {
    if (statusElement) {
      statusElement.textContent = "Could not detect IP. Enter it manually.";
    }
  }
}

async function customerLogin() {
  const keyInput = $("keyInput");
  const ipInput = $("ipInput");
  const button = $("loginButton");

  const key = keyInput?.value.trim();
  const ip = ipInput?.value.trim();

  if (!key) {
    message($("status"), "Please enter your access key.");
    return;
  }

  if (!validIPv4(ip)) {
    message($("status"), "Please enter a valid IPv4 address.");
    return;
  }

  button.disabled = true;
  button.textContent = "VERIFYING...";

  message($("status"), "Verifying your access key...");

  try {
    const data = await request("/api/keys/verify", {
      method: "POST",
      body: JSON.stringify({
        key,
        ip,
        deviceId: getDeviceId(),
        remember: $("saveKey")?.checked || false
      })
    });

    if (!data.valid) {
      throw new Error(data.message || "Key verification failed.");
    }

    customerData = {
      key,
      ip,
      expires_at: data.expires_at,
      devices_used: data.devices_used,
      max_devices: data.max_devices
    };

    sessionStorage.setItem(
      "windir_customer",
      JSON.stringify(customerData)
    );

    if ($("saveKey")?.checked) {
      localStorage.setItem("windir_saved_key", key);
    } else {
      localStorage.removeItem("windir_saved_key");
    }

    message($("status"), "Key verified successfully.", "success");

    setTimeout(() => {
      showCustomerMenu(data);
    }, 450);

  } catch (error) {
    message($("status"), error.message, "error");
  } finally {
    updateCustomerButton();
  }
}

/* =====================================
   CUSTOMER MENU
===================================== */

function showCustomerMenu(data = {}) {
  show(loginScreen, false);
  show(mainMenu, true);

  if ($("settingKey")) {
    $("settingKey").textContent = "Verified";
  }

  if ($("settingIpStatus")) {
    $("settingIpStatus").textContent = "Connected";
  }

  if ($("settingIpInput") && customerData?.ip) {
    $("settingIpInput").value = customerData.ip;
  }

  if ($("settingExpiryDate")) {
    $("settingExpiryDate").textContent =
      customerData?.expires_at || data.expires_at || "Not available";
  }

  switchTab("proxy");
}

/* =====================================
   MENU NAVIGATION
===================================== */

function switchTab(tab) {
  const allowedTabs = ["proxy", "main", "news", "setting"];

  if (!allowedTabs.includes(tab)) return;

  document.querySelectorAll(".menu-tab").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.tab === tab
    );
  });

  allowedTabs.forEach(name => {
    show($("tab-" + name), name === tab);
  });
}

document.querySelectorAll(".menu-tab").forEach(button => {
  button.addEventListener("click", () => {
    switchTab(button.dataset.tab);
  });
});

/* =====================================
   ACTIVATE OPTIONS
===================================== */

function activateOptions() {
  const selected = Array.from(
    document.querySelectorAll(".wn-switch:checked")
  ).map(input => input.value);

  const output = $("optionsMessage");

  if (!selected.length) {
    message(output, "Please select at least one option.", "error");
    return;
  }

  /*
    This confirms the frontend selection only.
    It does not modify an external game or application.
  */

  message(
    output,
    "Options activated successfully.",
    "success"
  );
}

/* =====================================
   UPDATE CUSTOMER IP
===================================== */

async function updateCustomerIP() {
  const input = $("settingIpInput");
  const ip = input?.value.trim();

  if (!validIPv4(ip)) {
    message($("settingIpMessage"), "Enter a valid IPv4 address.", "error");
    return;
  }

  if (!customerData?.key) {
    message($("settingIpMessage"), "Please log in again.", "error");
    return;
  }

  message(
    $("settingIpMessage"),
    "Verifying updated IP..."
  );

  try {
    const data = await request("/api/keys/verify", {
      method: "POST",
      body: JSON.stringify({
        key: customerData.key,
        ip,
        deviceId: getDeviceId(),
        remember: false
      })
    });

    customerData.ip = ip;

    sessionStorage.setItem(
      "windir_customer",
      JSON.stringify(customerData)
    );

    if ($("ipInput")) {
      $("ipInput").value = ip;
    }

    if ($("settingIpStatus")) {
      $("settingIpStatus").textContent = "Connected";
    }

    message(
      $("settingIpMessage"),
      data.message || "IP updated successfully.",
      "success"
    );

  } catch (error) {
    message($("settingIpMessage"), error.message, "error");
  }
}

/* =====================================
   CUSTOMER LOGOUT
===================================== */

function customerLogout() {
  customerData = null;

  sessionStorage.removeItem("windir_customer");
  localStorage.removeItem("windir_saved_key");

  if ($("keyInput")) $("keyInput").value = "";
  if ($("ipInput")) $("ipInput").value = "";

  show(mainMenu, false);
  show(loginScreen, true);

  message($("status"), "You have been logged out.");

  switchTab("proxy");
}

/* =====================================
   ADMIN MODAL
===================================== */

function openAdminModal() {
  if (!modal) return;

  show(modal, true);
  modal.style.display = "flex";

  show($("loginView"), true);
  show($("dash"), false);

  message($("loginErr"), "");
}

function closeAdminModal() {
  if (!modal) return;

  show(modal, false);
  modal.style.display = "";
}

$("adminOpen")?.addEventListener("click", openAdminModal);
$("adminButton")?.addEventListener("click", openAdminModal);
$("close")?.addEventListener("click", closeAdminModal);

modal?.addEventListener("click", event => {
  if (event.target === modal) {
    closeAdminModal();
  }
});

/* =====================================
   ADMIN API
===================================== */

async function adminRequest(url, options = {}) {
  return request(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${adminToken}`
    }
  });
}

/* =====================================
   ADMIN LOGIN
===================================== */

async function adminLogin() {
  const username = $("username")?.value.trim();
  const password = $("password")?.value;

  if (!username || !password) {
    message($("loginErr"), "Enter your username and password.", "error");
    return;
  }

  const button = $("login");

  button.disabled = true;
  button.textContent = "CHECKING...";

  try {
    const data = await request("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });

    adminToken = data.token;
    adminRole = data.admin?.role || data.role || "ADMIN";

    showDashboard(data);

  } catch (error) {
    message($("loginErr"), error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "LOGIN";
  }
}

/* =====================================
   ADMIN DASHBOARD
===================================== */

async function showDashboard(data = {}) {
  show($("loginView"), false);
  show($("dash"), true);

  if ($("adminName")) {
    $("adminName").textContent =
      data.admin?.username || data.username || "Admin";
  }

  if ($("adminRole")) {
    $("adminRole").textContent = adminRole;
  }

  show($("ownerPanel"), adminRole === "OWNER");

  await loadKeys();
  await loadDevices();

  if (adminRole === "OWNER") {
    await loadAdmins();
  }
}

/* =====================================
   GENERATE KEY
===================================== */

async function generateKey() {
  const label = $("label")?.value.trim();
  const days = Number($("days")?.value);
  const maxDevices = Number($("maxDevices")?.value);

  if (!days || days < 1 || !maxDevices || maxDevices < 1) {
    alert("Enter valid duration and device limits.");
    return;
  }

  const button = $("make");

  button.disabled = true;
  button.textContent = "GENERATING...";

  try {
    const data = await adminRequest("/api/admin/keys", {
      method: "POST",
      body: JSON.stringify({
        label,
        days,
        maxDevices
      })
    });

    $("newKey").textContent = data.key || data.message || "Key generated.";

    await loadKeys();

  } catch (error) {
    $("newKey").textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "GENERATE KEY";
  }
}

/* =====================================
   LOAD KEYS
===================================== */

async function loadKeys() {
  const container = $("keys");

  if (!container) return;

  container.textContent = "Loading keys...";

  try {
    const data = await adminRequest("/api/admin/keys");

    container.replaceChildren();

    const keys = data.keys || [];

    if (!keys.length) {
      container.textContent = "No keys found.";
      return;
    }

    keys.forEach(key => {
      const item = document.createElement("div");
      item.className = "info-row";

      const details = document.createElement("div");

      const name = document.createElement("strong");
      name.textContent = key.label || "Customer key";

      const state = document.createElement("p");
      state.textContent = key.revoked ? "Revoked" : "Active";

      details.append(name, state);

      const revoke = document.createElement("button");
      revoke.className = "danger-button";
      revoke.textContent = "Revoke";
      revoke.style.width = "auto";
      revoke.style.padding = "8px 12px";

      revoke.disabled = Boolean(key.revoked);

      revoke.addEventListener("click", async () => {
        if (!confirm("Revoke this key?")) return;

        try {
          await adminRequest(
            `/api/admin/keys/${encodeURIComponent(key.id)}/revoke`,
            { method: "POST" }
          );

          await loadKeys();
        } catch (error) {
          alert(error.message);
        }
      });

      item.append(details, revoke);
      container.append(item);
    });

  } catch (error) {
    container.textContent = error.message;
  }
}

/* =====================================
   LOAD DEVICES
===================================== */

async function loadDevices() {
  const container = $("deviceList");

  if (!container) return;

  container.textContent = "Loading devices...";

  try {
    const data = await adminRequest("/api/admin/devices");

    container.replaceChildren();

    const devices = data.devices || [];

    if (!devices.length) {
      container.textContent = "No connected devices.";
      return;
    }

    devices.forEach(device => {
      const item = document.createElement("div");
      item.className = "info-row";

      const details = document.createElement("div");

      const ip = document.createElement("strong");
      ip.textContent = device.ip || "Unknown IP";

      const id = document.createElement("p");
      id.textContent = device.device_id || "Device";

      details.append(ip, id);

      const revoke = document.createElement("button");
      revoke.className = "danger-button";
      revoke.textContent = "Remove";
      revoke.style.width = "auto";
      revoke.style.padding = "8px 12px";

      revoke.addEventListener("click", async () => {
        if (!confirm("Remove this device?")) return;

        try {
          await adminRequest(
            `/api/admin/devices/${encodeURIComponent(device.id)}/revoke`,
            { method: "POST" }
          );

          await loadDevices();
        } catch (error) {
          alert(error.message);
        }
      });

      item.append(details, revoke);
      container.append(item);
    });

  } catch (error) {
    container.textContent = error.message;
  }
}

/* =====================================
   OWNER - CREATE ADMIN
===================================== */

async function createAdmin() {
  const username = $("newAdminUser")?.value.trim();
  const password = $("newAdminPassword")?.value;

  if (!username || !password) {
    message($("adminMessage"), "Complete both fields.", "error");
    return;
  }

  try {
    await adminRequest("/api/admin/admins", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });

    message(
      $("adminMessage"),
      "Admin created successfully.",
      "success"
    );

    $("newAdminUser").value = "";
    $("newAdminPassword").value = "";

    await loadAdmins();

  } catch (error) {
    message($("adminMessage"), error.message, "error");
  }
}

/* =====================================
   OWNER - LOAD ADMINS
===================================== */

async function loadAdmins() {
  const container = $("adminList");

  if (!container) return;

  try {
    const data = await adminRequest("/api/admin/admins");

    container.replaceChildren();

    const admins = data.admins || [];

    if (!admins.length) {
      container.textContent = "No admins found.";
      return;
    }

    admins.forEach(admin => {
      const item = document.createElement("div");
      item.className = "info-row";

      const info = document.createElement("strong");
      info.textContent = admin.username + " — " + admin.role;

      item.append(info);

      if (admin.role !== "OWNER") {
        const remove = document.createElement("button");

        remove.className = "danger-button";
        remove.textContent = "Delete";
        remove.style.width = "auto";
        remove.style.padding = "8px 12px";

        remove.addEventListener("click", async () => {
          if (!confirm("Delete this admin?")) return;

          try {
            await adminRequest(
              `/api/admin/admins/${encodeURIComponent(admin.id)}`,
              { method: "DELETE" }
            );

            await loadAdmins();
          } catch (error) {
            alert(error.message);
          }
        });

        item.append(remove);
      }

      container.append(item);
    });

  } catch (error) {
    container.textContent = error.message;
  }
}

/* =====================================
   ADMIN LOGOUT
===================================== */

async function adminLogout() {
  try {
    if (adminToken) {
      await adminRequest("/api/admin/logout", {
        method: "POST"
      });
    }
  } catch {
    // Local session is cleared even if the server is unavailable.
  }

  adminToken = null;
  adminRole = null;

  show($("dash"), false);
  show($("loginView"), true);

  if ($("username")) $("username").value = "";
  if ($("password")) $("password").value = "";

  closeAdminModal();
}

/* =====================================
   EVENT LISTENERS
===================================== */

$("loginButton")?.addEventListener("click", customerLogin);

$("keyInput")?.addEventListener("keydown", event => {
  if (event.key === "Enter") customerLogin();
});

$("ipInput")?.addEventListener("keydown", event => {
  if (event.key === "Enter") customerLogin();
});

$("detectIpButton")?.addEventListener("click", () => {
  detectIP($("ipInput"), $("ipStatus"));
});

$("clearKey")?.addEventListener("click", () => {
  $("keyInput").value = "";
  localStorage.removeItem("windir_saved_key");
  message($("status"), "Saved key cleared.");
});

$("activateOptions")?.addEventListener("click", activateOptions);

$("settingDetectIp")?.addEventListener("click", () => {
  detectIP(
    $("settingIpInput"),
    $("settingIpMessage")
  );
});

$("settingUpdateIp")?.addEventListener("click", updateCustomerIP);

$("customerLogout")?.addEventListener("click", customerLogout);

$("login")?.addEventListener("click", adminLogin);

$("password")?.addEventListener("keydown", event => {
  if (event.key === "Enter") adminLogin();
});

$("make")?.addEventListener("click", generateKey);

$("createAdmin")?.addEventListener("click", createAdmin);

$("logout")?.addEventListener("click", adminLogout);

/* =====================================
   LANGUAGE SETTING
===================================== */

$("settingLanguage")?.addEventListener("change", event => {
  const language = event.target.value;

  message(
    $("settingIpMessage"),
    language === "es"
      ? "Idioma seleccionado: Español."
      : "Language selected: English.",
    "success"
  );
});

/* =====================================
   RESTORE SAVED KEY
===================================== */

function restoreSavedKey() {
  const saved = localStorage.getItem("windir_saved_key");

  if (saved && $("keyInput")) {
    $("keyInput").value = saved;
    $("saveKey").checked = true;
  }
}

/* =====================================
   PARTICLE BACKGROUND
===================================== */

function startParticles() {
  const canvas = $("particles");

  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  if (!ctx) return;

  let width = 0;
  let height = 0;
  let particles = [];

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);

    width = window.innerWidth;
    height = window.innerHeight;

    canvas.width = width * ratio;
    canvas.height = height * ratio;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    particles = Array.from({ length: 35 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 2 + .5,
      speed: Math.random() * .35 + .1,
      alpha: Math.random() * .5 + .15
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    particles.forEach(particle => {
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

      ctx.fillStyle = `rgba(237,32,41,${particle.alpha})`;
      ctx.fill();
    });

    requestAnimationFrame(draw);
  }

  resize();
  draw();

  window.addEventListener("resize", resize);
}

/* =====================================
   INITIALIZATION
===================================== */

function initializeApp() {
  restoreSavedKey();

  show(loginScreen, true);
  show(mainMenu, false);
  show(modal, false);

  startParticles();

  switchTab("proxy");

  console.log("WINDIR PROXY initialized.");
}

initializeApp();