const STORAGE_KEY = "windir_saved_key";
const SESSION_KEY = "windir_session_key";
const SESSION_IP = "windir_session_ip";

const keyInput = document.getElementById("keyInput");
const saveKey = document.getElementById("saveKey");
const clearKey = document.getElementById("clearKey");
const loginButton = document.getElementById("loginButton");
const status = document.getElementById("status");
const ipInput = document.getElementById("ipInput");
const detectIpButton = document.getElementById("detectIpButton");
const ipStatus = document.getElementById("ipStatus");

function showStatus(message, type) {
  status.textContent = message;
  status.className = "status show " + type;
}

function hideStatus() {
  status.textContent = "";
  status.className = "status";
}

function updateButton() {
  loginButton.disabled = keyInput.value.trim().length === 0;
}

function showIpStatus(message, success = false) {
  ipStatus.textContent = message;
  ipStatus.style.color = success ? "#55e889" : "rgba(255,255,255,0.38)";
}

function loadSavedKey() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return;
  keyInput.value = saved;
  saveKey.checked = true;
  clearKey.style.display = "block";
  updateButton();
}

function removeSavedKey() {
  localStorage.removeItem(STORAGE_KEY);
  saveKey.checked = false;
  clearKey.style.display = "none";
}

keyInput.addEventListener("input", () => {
  updateButton();
  const current = keyInput.value.trim();
  const saved = localStorage.getItem(STORAGE_KEY);

  if (saved && current !== saved) {
    saveKey.checked = false;
    clearKey.style.display = "none";
  }

  if (status.classList.contains("error") || status.classList.contains("success")) {
    hideStatus();
  }

  showIpStatus("");
});

saveKey.addEventListener("change", () => {
  if (saveKey.checked) {
    const key = keyInput.value.trim();
    if (!key) {
      saveKey.checked = false;
      return;
    }
    localStorage.setItem(STORAGE_KEY, key);
    clearKey.style.display = "block";
  } else {
    removeSavedKey();
  }
});

clearKey.addEventListener("click", () => {
  removeSavedKey();
  keyInput.value = "";
  updateButton();
  hideStatus();
});

ipInput.addEventListener("input", () => {
  ipInput.value = ipInput.value.replace(/[^0-9.]/g, "").slice(0, 15);
  showIpStatus("");
});

async function detectClientIp() {
  detectIpButton.disabled = true;
  const original = detectIpButton.textContent;
  detectIpButton.textContent = "Detecting...";
  showIpStatus("Detecting your public IPv4...");

  try {
    const res = await fetch("https://api.ipify.org?format=json", { cache: "no-store" });
    if (!res.ok) throw new Error("failed");
    const data = await res.json();
    const ip = String(data.ip || "").replace(/[^0-9.]/g, "").slice(0, 15);
    if (!ip) throw new Error("empty");
    ipInput.value = ip;
    showIpStatus("IPv4 detected successfully.", true);
  } catch {
    showIpStatus("Unable to detect your IPv4.");
  } finally {
    detectIpButton.disabled = false;
    detectIpButton.textContent = original;
  }
}

detectIpButton.addEventListener("click", detectClientIp);

function validIp(ip) {
  const parts = ip.split(".");
  return parts.length === 4 && parts.every(p => p !== "" && Number(p) <= 255);
}

loginButton.addEventListener("click", async () => {
  const key = keyInput.value.trim();
  const ip = ipInput.value.trim();

  if (!key) {
    showStatus("Please enter your key.", "error");
    keyInput.focus();
    return;
  }

  if (!ip || !validIp(ip)) {
    showStatus("Please enter or auto-detect a valid IPv4.", "error");
    ipInput.focus();
    return;
  }

  loginButton.disabled = true;
  detectIpButton.disabled = true;
  showStatus("Verifying your key and IPv4...", "loading");

  try {
    const res = await fetch("/api/verify-key", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Device": ip },
      body: JSON.stringify({ key, ip })
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || !data.valid) {
      showStatus(data && data.message ? data.message : "Invalid or expired key.", "error");
      return;
    }

    if (saveKey.checked) localStorage.setItem(STORAGE_KEY, key);

    showStatus("Your key has been verified successfully.", "success");

    sessionStorage.setItem(SESSION_KEY, key);
    sessionStorage.setItem(SESSION_IP, ip);
    sessionStorage.setItem("windir_verified", JSON.stringify({ key, ip, data }));

    setTimeout(() => window.location.replace("/activate"), 450);

  } catch {
    showStatus("Unable to connect to the server. Please try again.", "error");
  } finally {
    detectIpButton.disabled = false;
    updateButton();
  }
});

loadSavedKey();

/* partículas */
(function () {
  const canvas = document.getElementById("particles");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let w = 0, h = 0, count = 85;
  const ps = [];

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    count = w <= 600 ? 48 : w <= 1000 ? 68 : 90;
  }

  function build() {
    ps.length = 0;
    for (let i = 0; i < count; i++) {
      ps.push({
        x: Math.random() * w, y: Math.random() * h,
        r: Math.random() * 2.7 + 1.1,
        vx: (Math.random() - .5) * .38,
        vy: (Math.random() - .5) * .38,
        a: Math.random() * .45 + .35,
        p: Math.random() * Math.PI * 2,
        s: Math.random() * .015 + .006
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);

    for (const p of ps) {
      p.x += p.vx; p.y += p.vy; p.p += p.s;
      if (p.x < -10) p.x = w + 10;
      if (p.x > w + 10) p.x = -10;
      if (p.y < -10) p.y = h + 10;
      if (p.y > h + 10) p.y = -10;

      const alpha = p.a * (0.82 + Math.sin(p.p) * 0.18);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 5);
      g.addColorStop(0, `rgba(255,0,0,${alpha * .45})`);
      g.addColorStop(1, "rgba(255,0,0,0)");
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 5, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,0,0,${alpha})`;
      ctx.fill();
    }

    const max = w <= 600 ? 125 : 165;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const dx = ps[i].x - ps[j].x, dy = ps[i].y - ps[j].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < max) {
          ctx.beginPath();
          ctx.moveTo(ps[i].x, ps[i].y);
          ctx.lineTo(ps[j].x, ps[j].y);
          ctx.strokeStyle = `rgba(255,0,0,${0.42 * (1 - d / max)})`;
          ctx.lineWidth = w <= 600 ? 1.35 : 1.8;
          ctx.stroke();
        }
      }
    }

    requestAnimationFrame(draw);
  }

  resize(); build(); draw();

  let t;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(() => { resize(); build(); }, 150);
  });
})();