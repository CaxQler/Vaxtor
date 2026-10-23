"use strict";
/* Vaxtor — toast helper (shared) */
function toast(msg, type = "info") {
  let host = document.getElementById("toasts");
  if (!host) { host = document.createElement("div"); host.id = "toasts"; document.body.appendChild(host); }
  const el = document.createElement("div");
  el.className = "toast " + (type === "ok" ? "ok" : type === "err" ? "err" : "");
  const iconName = type === "ok" ? "check" : type === "err" ? "close" : "zap";
  const icon = typeof window.ico === "function" ? window.ico(iconName, 15) : "·";
  el.innerHTML = `<span class="ti">${icon}</span><span>${msg}</span>`;
  host.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = ".3s"; setTimeout(() => el.remove(), 320); }, 4200);
}

/* Right-side slider notification */
function showSlider(title, detail, type = "ok") {
  let host = document.getElementById("vx-sliders");
  if (!host) {
    host = document.createElement("div");
    host.id = "vx-sliders";
    host.style.cssText = "position:fixed;top:24px;right:24px;z-index:99999;display:flex;flex-direction:column;gap:10px;max-width:360px;pointer-events:none;font-family:var(--font,Inter,system-ui,sans-serif)";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = "vx-slider";
  el.style.cssText = "pointer-events:auto;position:relative;display:flex;align-items:flex-start;gap:12px;padding:14px 16px 14px 14px;border-radius:12px;background:linear-gradient(90deg,rgba(168,85,247,.18) 0%,rgba(20,16,30,.98) 100%);border:1px solid rgba(168,85,247,.5);box-shadow:0 18px 50px -18px rgba(139,92,246,.9),0 0 0 1px rgba(255,255,255,.01) inset;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);transform:translateX(110%);opacity:0;transition:transform .5s cubic-bezier(.22,1,.36,1),opacity .4s ease;overflow:hidden";
  const accent = type === "err" ? "linear-gradient(90deg,#ef4444,#f87171)" : "linear-gradient(90deg,#a855f7,#7c3aed)";
  const bar = document.createElement("div");
  bar.style.cssText = "position:absolute;left:0;top:0;bottom:0;width:2px;background:" + accent + ";box-shadow:0 0 40px rgba(168,85,247,.4)";
  el.appendChild(bar);
  const iconWrap = document.createElement("div");
  iconWrap.style.cssText = "width:30px;height:30px;border-radius:9px;background:" + (type === "err" ? "rgba(239,68,68,.18)" : "rgba(168,85,247,.2)") + ";border:1px solid " + (type === "err" ? "rgba(239,68,68,.5)" : "rgba(168,85,247,.55)") + ";display:grid;place-items:center;flex-shrink:0;margin-left:2px";
  const iconName = type === "err" ? "close" : "check";
  if (typeof window.ico === "function") {
    iconWrap.innerHTML = window.ico(iconName, 16);
  } else {
    iconWrap.textContent = type === "err" ? "×" : "✓";
    iconWrap.style.color = type === "err" ? "#f87171" : "#c084fc";
  }
  el.appendChild(iconWrap);
  const body = document.createElement("div");
  body.style.cssText = "flex:1;min-width:0";
  const ttl = document.createElement("div");
  ttl.style.cssText = "font-weight:600;font-size:13.5px;letter-spacing:-.01em;line-height:1.4";
  ttl.textContent = title || "";
  const det = document.createElement("div");
  det.style.cssText = "margin-top:2px;font-size:12px;color:rgba(226,232,255,.7);line-height:1.6;word-break:break-word";
  det.textContent = detail || "";
  body.appendChild(ttl);
  if (detail) body.appendChild(det);
  el.appendChild(body);
  const btn = document.createElement("button");
  btn.style.cssText = "background:none;border:0;color:rgba(226,232,255,.4);cursor:pointer;padding:4px;margin:-4px -2px 0 0;display:inline-flex;align-items:center;justify-content:center;transition:color .2s ease";
  btn.onmouseover = () => { btn.style.color = "rgba(226,232,255,.9)"; };
  btn.onmouseout = () => { btn.style.color = "rgba(226,232,255,.4)"; };
  if (typeof window.ico === "function") {
    btn.innerHTML = window.ico("close", 14);
  } else {
    btn.textContent = "×";
  }
  btn.onclick = () => {
    el.style.transform = "translateX(110%)";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 420);
  };
  el.appendChild(btn);
  host.appendChild(el);
  requestAnimationFrame(() => {
    el.style.transform = "translateX(0)";
    el.style.opacity = "1";
  });
  setTimeout(() => {
    if (!el.isConnected) return;
    el.style.transform = "translateX(110%)";
    el.style.opacity = "0";
    setTimeout(() => { if (el.isConnected) el.remove(); }, 420);
  }, 3800);
}

window.showSlider = showSlider;


const api = {
  async req(method, route, body) {
    const res = await fetch(route, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    let json = {};
    try { json = await res.json(); } catch (_) {}
    if (!res.ok && !json.error) json.error = "Request failed (" + res.status + ")";
    return json;
  },
  get: (r) => api.req("GET", r),
  post: (r, b) => api.req("POST", r, b),
  patch: (r, b) => api.req("PATCH", r, b),
  put: (r, b) => api.req("PUT", r, b),
  del: (r) => api.req("DELETE", r),
};

function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}
function fmtUptime(ms) { return fmtDuration((ms || 0) / 1000); }
function fmtBytes(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"]; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(1) + " " + u[i];
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
