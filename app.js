"use strict";

/* =====================================
   WINDIR PROXY - APP.JS
   NEW KEY FORMAT:
   WINDIR-XXXX-XXXX-XXXX
===================================== */

const $ = (id) => document.getElementById(id);

const loginScreen = $("loginScreen");
const mainMenu = $("mainMenu");
const modal = $("modal");

let customerData = null;
let adminToken = null;
let adminRole = null;

/* =====================================
   KEY FORMAT
===================================== */

function normalizeWindirKey(key) {
  return String(key || "").trim().toUpperCase();
}

function validWindirKey(key) {
  return /^WINDIR-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/
    .test(normalizeWindirKey(key));
}

/* =====================================
   VISIBILITY
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

  if (type) element.classList.add(type);
}

/* =====================================
   API REQUEST
===================================== */

async function request(url, options = {}) {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    15000
  );

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
      throw new Error(
        data.error ||
        data.message ||
        "Request failed."
      );
    }

    return data;

  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        "The server took too long to respond."
      );
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
    if (crypto.randomUUID) {
      id = crypto.randomUUID();
    } else {
      id = "windir_" +
        Date.now().toString(36) +
        "_" +
        Math.random().toString(36).slice(2, 20);
    }

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
  const parts = String(ip || "").trim().split(".");

  if (parts.length !== 4) return false;

  return parts.every(part => {
    if (!/^\d{1,3}$/.test(part)) return false;

    const number = Number(part);

    return number >= 0 && number <= 255;
  });
}

async function detectIP(input, statusElement) {
  if (!input) return;

  if (statusElement) {
    statusElement.textContent = "Detecting IP...";
  }

  try {
    const response = await fetch(
      "https://api.ipify.org?format=json"
    );

    if (!response.ok) {
      throw new Error("IP detection failed.");
    }

    const data = await response.json();

    if (!validIPv4(data.ip)) {
      throw new Error("Invalid IP returned.");
    }

    input.value = data.ip;

    if (statusElement) {
      statusElement.textContent =
        "IP detected successfully.";
    }

  } catch {
    if (statusElement) {
      statusElement.textContent =
        "Could not detect IP. Enter it manually.";
    }
  }
}

async function customerLogin() {
  const keyInput = $("keyInput");
  const ipInput = $("ipInput");
  const button = $("loginButton");

  const key = normalizeWindirKey(keyInput?.value);
  const ip = ipInput?.value.trim();

  if (!key) {
    message(
      $("status"),
      "Please enter your access key.",
      "error"
    );
    return;
  }

  if (!validWindirKey(key)) {
    message(
      $("status"),
      "Invalid format. Use WINDIR-XXXX-XXXX-XXXX.",
      "error"
    );
    return;
  }

  if (!validIPv4(ip)) {
    message(
      $("status"),
      "Please enter a valid IPv4 address.",
      "error"
    );
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "VERIFYING...";
  }

  message(
    $("status"),
    "Verifying your access key..."
  );

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
      throw new Error(
        data.error ||
        data.message ||
        "Key verification failed."
      );
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
      localStorage.setItem(
        "windir_saved_key",
        key
      );
    } else {
      localStorage.removeItem("windir_saved_key");
    }

    message(
      $("status"),
      "Key verified successfully.",
      "success"
    );

    setTimeout(() => {
      showCustomerMenu(data);
    }, 450);

  } catch (error) {
    message(
      $("status"),
      error.message,
      "error"
    );

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
      customerData?.expires_at ||
      data.expires_at ||
      "Not available";
  }

  switchTab("proxy");
}

/* =====================================
   MENU NAVIGATION
===================================== */

function switchTab(tab) {
  const allowedTabs = [
    "proxy",
    "main",
    "news",
    "setting"
  ];

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
    message(
      output,
      "Please select at least one option.",
      "error"
    );
    return;
  }

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
    message(
      $("settingIpMessage"),
      "Enter a valid IPv4 address.",
      "error"
    );
    return;
  }

  if (!customerData?.key ||
      !validWindirKey(customerData.key)) {
    message(
      $("settingIpMessage"),
      "Please log in again.",
      "error"
    );
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

    if (!data.valid) {
      throw new Error(
        data.error || "IP verification failed."
      );
    }

    customerData.ip = ip;
    customerData.devices_used = data.devices_used;
    customerData.max_devices = data.max_devices;

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
      "IP updated successfully.",
      "success"
    );

  } catch (error) {
    message(
      $("settingIpMessage"),
      error.message,
      "error"
    );
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
  if ($("saveKey")) $("saveKey").checked = false;

  show(mainMenu, false);
  show(loginScreen, true);

  message(
    $("status"),
    "You have been logged out."
  );

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

$("adminOpen")?.addEventListener(
  "click",
  openAdminModal
);

$("adminButton")?.addEventListener(
  "click",
  openAdminModal
);

$("close")?.addEventListener(
  "click",
  closeAdminModal
);

modal?.addEventListener("click", event => {
  if (event.target === modal) {
    closeAdminModal();
  }
});

/* =====================================
   ADMIN API
===================================== */

async function adminRequest(url, options = {}) {
  if (!adminToken) {
    throw new Error(
      "Admin session expired. Please log in again."
    );
  }

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
    message(
      $("loginErr"),
      "Enter your username and password.",
      "error"
    );
    return;
  }

  const button = $("login");

  if (button) {
    button.disabled = true;
    button.textContent = "CHECKING...";
  }

  try {
    const data = await request("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        username,
        password
      })
    });

    adminToken = data.token;
    adminRole = data.user?.role || data.role || "ADMIN";

    await showDashboard(data);

  } catch (error) {
    message(
      $("loginErr"),
      error.message,
      "error"
    );

  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "LOGIN";
    }
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
      data.user?.username ||
      data.username ||
      "Admin";
  }

  if ($("adminRole")) {
    $("adminRole").textContent = adminRole;
  }

  show(
    $("ownerPanel"),
    adminRole === "OWNER"
  );

  await loadKeys();
  await loadDevices();

  if (adminRole === "OWNER") {
    await loadAdmins();
  }
}

/* =====================================
   GENERATE NEW WINDIR KEY
===================================== */

async function generateKey() {
  const label = $("label")?.value.trim() || "";
  const days = Number($("days")?.value || 7);
  const maxDevices = Number(
    $("maxDevices")?.value ?? 1
  );

  if (
    !Number.isInteger(days) ||
    days < 1 ||
    days > 3650
  ) {
    alert("Days must be between 1 and 3650.");
    return;
  }

  if (
    !Number.isInteger(maxDevices) ||
    maxDevices < 0 ||
    maxDevices > 100
  ) {
    alert("Devices must be between 0 and 100.");
    return;
  }

  const button = $("make");

  if (button) {
    button.disabled = true;
    button.textContent = "GENERATING...";
  }

  try {
    const data = await adminRequest(
      "/api/admin/keys",
      {
        method: "POST",
        body: JSON.stringify({
          label,
          days,
          maxDevices
        })
      }
    );

    const generatedKey = normalizeWindirKey(data.key);

    if (!validWindirKey(generatedKey)) {
      throw new Error(
        "Server returned an invalid key format. Update the server generator first."
      );
    }

    if ($("newKey")) {
      $("newKey").textContent = generatedKey;
    }

    await loadKeys();
    await loadDevices();

  } catch (error) {
    if ($("newKey")) {
      $("newKey").textContent = error.message;
    }

  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "GENERATE KEY";
    }
  }
}

/* =====================================
   LOAD KEYS
===================================== */

async function loadKeys() {
  const container = $("keys");

  if (!container) return [];

  container.textContent = "Loading keys...";

  try {
    const data = await adminRequest("/api/admin/keys");

    if (!Array.isArray(data)) {
      throw new Error("Unexpected keys response.");
    }

    container.replaceChildren();

    if (!data.length) {
      container.textContent = "No keys found.";
      return [];
    }

    data.forEach(key => {
      const item = document.createElement("div");
      item.className = "info-row";

      const details = document.createElement("div");

      const name = document.createElement("strong");
      name.textContent = key.label || "Customer key";

      const keyText = document.createElement("p");
      keyText.textContent = validWindirKey(key.key)
        ? normalizeWindirKey(key.key)
        : "Legacy key (unsupported)";

      const state = document.createElement("p");
      state.textContent = key.revoked
        ? "Revoked"
        : "Active";

      const usage = document.createElement("p");
      usage.textContent =
        `Devices: ${key.devices_used || 0} / ` +
        (key.max_devices === 0
          ? "Unlimited"
          : key.max_devices);

      const expiry = document.createElement("p");
      expiry.textContent =
        "Expires: " + (key.expires_at || "Unknown");

      details.append(
        name,
        keyText,
        state,
        usage,
        expiry
      );

      const actions = document.createElement("div");
      actions.className = "key-actions";

      const viewDevices = document.createElement("button");
      viewDevices.type = "button";
      viewDevices.textContent = "Devices";
      viewDevices.style.width = "auto";
      viewDevices.style.padding = "8px 12px";

      viewDevices.addEventListener("click", () => {
        loadDevices(key.id);

        $("deviceList")?.scrollIntoView({
          behavior: "smooth",
          block: "nearest"
        });
      });

      actions.append(viewDevices);

      const revoke = document.createElement("button");
      revoke.type = "button";
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
          await loadDevices();

        } catch (error) {
          alert(error.message);
        }
      });

      actions.append(revoke);
      item.append(details, actions);
      container.append(item);
    });

    return data;

  } catch (error) {
    container.textContent = error.message;
    return [];
  }
}

/* =====================================
   LOAD DEVICES
===================================== */

async function loadDevices(selectedKeyId = null) {
  const container = $("deviceList");

  if (!container) return;

  container.textContent = "Loading devices...";

  try {
    let keys;

    if (selectedKeyId !== null) {
      keys = [{
        id: selectedKeyId,
        label: "Selected key"
      }];
    } else {
      keys = await adminRequest("/api/admin/keys");

      if (!Array.isArray(keys)) {
        throw new Error("Unexpected keys response.");
      }
    }

    container.replaceChildren();

    if (!keys.length) {
      container.textContent = "No keys available.";
      return;
    }

    let foundDevices = 0;

    for (const key of keys) {
      const devices = await adminRequest(
        `/api/admin/keys/${encodeURIComponent(key.id)}/devices`
      );

      if (!Array.isArray(devices)) continue;
      if (!devices.length) continue;

      const heading = document.createElement("h4");
      heading.textContent = key.label || `Key #${key.id}`;

      container.append(heading);

      devices.forEach(device => {
        foundDevices++;

        const item = document.createElement("div");
        item.className = "info-row";

        const details = document.createElement("div");

        const ip = document.createElement("strong");
        ip.textContent = device.ip || "Unknown IP";

        const id = document.createElement("p");
        id.textContent = device.device_id || "Device";

        const status = document.createElement("p");
        status.textContent = device.revoked
          ? "Revoked"
          : "Connected";

        details.append(ip, id, status);

        const revoke = document.createElement("button");
        revoke.type = "button";
        revoke.className = "danger-button";
        revoke.textContent = "Remove";
        revoke.style.width = "auto";
        revoke.style.padding = "8px 12px";
        revoke.disabled = Boolean(device.revoked);

        revoke.addEventListener("click", async () => {
          if (!confirm("Remove this device?")) return;

          try {
            await adminRequest(
              `/api/admin/keys/${encodeURIComponent(key.id)}/devices/${encodeURIComponent(device.device_id)}`,
              { method: "DELETE" }
            );

            await loadDevices(selectedKeyId);

          } catch (error) {
            alert(error.message);
          }
        });

        item.append(details, revoke);
        container.append(item);
      });
    }

    if (!foundDevices) {
      container.textContent = "No connected devices.";
    }

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
    message(
      $("adminMessage"),
      "Complete both fields.",
      "error"
    );
    return;
  }

  try {
    await adminRequest("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username,
        password
      })
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
    message(
      $("adminMessage"),
      error.message,
      "error"
    );
  }
}

/* =====================================
   OWNER - LOAD ADMINS
===================================== */

async function loadAdmins() {
  const container = $("adminList");

  if (!container) return;

  container.textContent = "Loading administrators...";

  try {
    const data = await adminRequest("/api/admin/users");

    if (!Array.isArray(data)) {
      throw new Error(
        "Unexpected administrators response."
      );
    }

    container.replaceChildren();

    if (!data.length) {
      container.textContent = "No admins found.";
      return;
    }

    data.forEach(admin => {
      const item = document.createElement("div");
      item.className = "info-row";

      const info = document.createElement("strong");
      info.textContent =
        `${admin.username} — ${admin.role}`;

      item.append(info);

      if (admin.role !== "OWNER") {
        const remove = document.createElement("button");

        remove.type = "button";
        remove.className = "danger-button";
        remove.textContent = "Delete";
        remove.style.width = "auto";
        remove.style.padding = "8px 12px";

        remove.addEventListener("click", async () => {
          if (!confirm("Delete this admin?")) return;

          try {
            await adminRequest(
              `/api/admin/users/${encodeURIComponent(admin.id)}`,
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
    // Clear local session if server is unavailable.
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

$("loginButton")?.addEventListener(
  "click",
  customerLogin
);

$("keyInput")?.addEventListener("input", event => {
  const input = event.target;
  const position = input.selectionStart;

  input.value = normalizeWindirKey(input.value);

  if (position !== null) {
    input.setSelectionRange(position, position);
  }
});

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
  if ($("keyInput")) $("keyInput").value = "";

  localStorage.removeItem("windir_saved_key");

  if ($("saveKey")) $("saveKey").checked = false;

  message($("status"), "Saved key cleared.");
});

$("activateOptions")?.addEventListener(
  "click",
  activateOptions
);

$("settingDetectIp")?.addEventListener("click", () => {
  detectIP(
    $("settingIpInput"),
    $("settingIpMessage")
  );
});

$("settingUpdateIp")?.addEventListener(
  "click",
  updateCustomerIP
);

$("customerLogout")?.addEventListener(
  "click",
  customerLogout
);

$("login")?.addEventListener(
  "click",
  adminLogin
);

$("password")?.addEventListener("keydown", event => {
  if (event.key === "Enter") adminLogin();
});

$("make")?.addEventListener(
  "click",
  generateKey
);

$("createAdmin")?.addEventListener(
  "click",
  createAdmin
);

$("logout")?.addEventListener(
  "click",
  adminLogout
);

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

  if (saved && validWindirKey(saved) && $("keyInput")) {
    $("keyInput").value = normalizeWindirKey(saved);

    if ($("saveKey")) {
      $("saveKey").checked = true;
    }
  } else if (saved) {
    localStorage.removeItem("windir_saved_key");
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
    const ratio = Math.min(
      window.devicePixelRatio || 1,
      2
    );

    width = window.innerWidth;
    height = window.innerHeight;

    canvas.width = width * ratio;
    canvas.height = height * ratio;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    particles = Array.from({ length: 35 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 2 + 0.5,
      speed: Math.random() * 0.35 + 0.1,
      alpha: Math.random() * 0.5 + 0.15
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

      ctx.fillStyle =
        `rgba(237,32,41,${particle.alpha})`;

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