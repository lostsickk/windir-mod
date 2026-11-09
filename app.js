/* =========================================
   WINDIR PROXY - APP.JS
   Customer access + Admin dashboard
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

/* ---------- HELPERS ---------- */

const $ = id => document.getElementById(id);

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
    throw new Error(data.error || data.message || `Error ${response.status}`);
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

  if (Number.isNaN(date.getTime())) return String(value);

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

/* ---------- CUSTOMER KEY SYSTEM ---------- */

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

/* Auto-detect IP */

const detectIpButton = $("detectIpButton");

if (detectIpButton) {
  detectIpButton.addEventListener("click", async () => {
    setText(ipStatus, "Detecting IP...");

    detectIpButton.disabled = true;

    try {
      const response = await fetch("https://api.ipify.org?format=json");
      if (!response.ok) throw new Error("IP detection failed");

      const data = await response.json();

      if (!validIPv4(data.ip)) {
        throw new Error("Invalid IP address");
      }

      if (ipInput) ipInput.value = data.ip;

      setText(ipStatus, "IP detected successfully.");
      updateCustomerButton();

    } catch (error) {
      setText(ipStatus, "Could not detect IP. Enter it manually.");
    } finally {
      detectIpButton.disabled = false;
    }
  });
}

/* Clear saved key */

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

/* Verify key */

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

      if (rememberCheckbox?.checked) {
        localStorage.setItem(STORAGE_KEY, key);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }

      customerMessage(
        data.message || "Access verified successfully!",
        "success"
      );

      if (data.redirectTo) {
        setTimeout(() => {
          window.location.href = data.redirectTo;
        }, 700);
      }

    } catch (error) {
      customerMessage(error.message || "Verification failed.", "error");
    } finally {
      updateCustomerButton();
    }
  });
}

updateCustomerButton();

/* ---------- ADMIN MODAL ---------- */

const modal = $("modal");
const adminOpen = $("adminOpen");
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

  setText($("adminName"), user.username || user.name || "Admin");
  setText($("adminRole"), user.role || "ADMIN");

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
        throw new Error("Server did not return a login token.");
      }

      sessionStorage.setItem(ADMIN_TOKEN_KEY, data.token);

      const user = data.user || {
        username,
        role: data.role || "ADMIN"
      };

      adminError("");
      showDashboard(user);

    } catch (error) {
      adminError(error.message || "Login failed.");
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
    const keys = Array.isArray(data) ? data : (data.keys || []);

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

      const limit = Number(key.max_devices ?? key.maxDevices ?? 1);

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
            await request(`${API.keys}/${encodeURIComponent(key.id)}/revoke`, {
              method: "POST",
              body: JSON.stringify({})
            }, true);

            await loadKeys();

          } catch (error) {
            alert(error.message);
          }
        });

        buttons.append(revokeButton);
      }

      item.append(title, details, expiry, devices, status, buttons);
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
    const maxDevices = Number($("maxDevices")?.value || 1);

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
        throw new Error("The server did not return the generated key.");
      }

      const output = $("newKey");
      output.replaceChildren();

      const keyText = createElement("strong", "", generated);
      const copyButton = createElement("button", "ghost", "COPY KEY");

      copyButton.type = "button";
      copyButton.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(generated);
          copyButton.textContent = "COPIED!";
        } catch {
          alert("Could not copy automatically. Select and copy the key.");
        }
      });

      output.append(keyText, copyButton);

      if ($("label")) $("label").value = "";

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
        createElement("strong", "", `Device: ${device.device_id || device.deviceId || "Unknown"}`),
        createElement("p", "", `IP: ${device.ip || "Unknown"}`),
        createElement("p", "", `Last seen: ${formatDate(device.last_seen || device.lastSeen)}`)
      );

      if (!device.revoked) {
        const revoke = createElement(
          "button",
          "ghost",
          "REMOVE DEVICE"
        );

        revoke.type = "button";

        revoke.addEventListener("click", async () => {
          if (!confirm("Remove this device from the key?")) return;

          const deviceId = device.device_id || device.deviceId;

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
        createElement("strong", "", admin.username || "Unknown"),
        createElement("p", "", `Role: ${admin.role || "ADMIN"}`)
      );

      if (String(admin.role).toUpperCase() !== "OWNER") {
        const removeButton = createElement(
          "button",
          "ghost",
          "DELETE ADMIN"
        );

        removeButton.type = "button";

        removeButton.addEventListener("click", async () => {
          if (!confirm(`Delete admin ${admin.username}?`)) return;

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
      setText($("adminMessage"), "Enter username and password.");
      return;
    }

    if (password.length < 12) {
      setText($("adminMessage"), "Password must have at least 12 characters.");
      return;
    }

    createAdminButton.disabled = true;
    setText($("adminMessage"), "Creating administrator...");

    try {
      await request(API.admins, {
        method: "POST",
        body: JSON.stringify({ username, password })
      }, true);

      setText($("adminMessage"), "Administrator created successfully.");

      $("newAdminUser").value = "";
      $("newAdminPassword").value = "";

      await loadAdmins();

    } catch (error) {
      setText($("adminMessage"), error.message);
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

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);

    width = window.innerWidth;
    height = window.innerHeight;

    canvas.width = width * ratio;
    canvas.height = height * ratio;

    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const count = Math.min(
      85,
      Math.max(25, Math.floor(width * height / 14000))
    );

    particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 2 + 0.5,
      speed: Math.random() * 0.35 + 0.08,
      opacity: Math.random() * 0.5 + 0.15
    }));
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

      ctx.fillStyle = `rgba(255, 35, 45, ${particle.opacity})`;
      ctx.fill();
    }

    requestAnimationFrame(animate);
  }

  window.addEventListener("resize", resize);

  resize();
  animate();
})();
