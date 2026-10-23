"use strict";
/* ═══════════════════════════════════════════════════════════
   VAXTOR — DEV PANEL (dev/Code.html)
   Dashboard · Keys (generate / LIVE-UNLIVE / delete)
   Users-set (ban / unban / kick sign in / delete)
   ═══════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);
const devView = $("devView");
let KEYS = [];
let USERS = [];
let keyFilter = "all";
let openUserFolder = false;

/* ---------------- auth ---------------- */

async function tryRestore() {
  const r = await api.get("/api/admin/session");
  if (r.ok) showPanel();
  else $("devLogin").style.display = "grid";
}

$("btnDevLogin").onclick = async () => {
  const r = await api.post("/api/admin/login", { password: $("devPass").value });
  if (!r.ok) {
    const e = $("devErr");
    e.textContent = r.error;
    e.classList.add("show");
    return;
  }
  $("devErr").classList.remove("show");
  showPanel();
};
$("devPass").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btnDevLogin").click(); });

$("btnDevLogout").onclick = async () => {
  await api.post("/api/admin/logout");
  location.reload();
};

function showPanel() {
  $("devLogin").style.display = "none";
  $("devPanel").style.display = "grid";
  go("dash");
}

document.querySelectorAll(".folder-item[data-page]").forEach((el) => {
  el.onclick = () => go(el.dataset.page);
});

function go(page) {
  document.querySelectorAll(".folder-item[data-page]").forEach((n) => n.classList.remove("active"));
  const el = document.querySelector(`.folder-item[data-page="${page}"]`);
  if (el) el.classList.add("active");
  if (page === "dash") return pageDash();
  if (page === "keys") return pageKeys();
  if (page === "userset") return pageUserSet();
  if (page === "audit") return pageAudit();
  if (page === "settings") return pageSettings();
}

/* ---------------- dashboard ---------------- */

async function pageDash() {
  const r = await api.get("/api/admin/stats");
  devView.innerHTML = `
    <div class="page-head">
      <div><h1>Dashboard</h1><div class="sub">Vaxtor platform overview · Bytelater.</div></div>
      <span class="badge ${r.middleware.up ? "green" : "red"}">${r.middleware.up ? "● MIDDLEWARE ONLINE" : "○ MIDDLEWARE OFFLINE"}</span>
    </div>

    <div class="stat-grid">
      <div class="card stat"><div class="k">Users</div><div class="v">${r.stats.users}</div><div class="d">${r.stats.banned} banned</div></div>
      <div class="card stat"><div class="k">Bot servers</div><div class="v">${r.stats.bots}</div><div class="d">${r.stats.running} running</div></div>
      <div class="card stat"><div class="k">Keys in middleware</div><div class="v">${r.middleware.total}</div><div class="d">${r.middleware.live} still LIVE</div></div>
      <div class="card stat"><div class="k">Keys</div><div class="v" style="font-size:19px; padding-top:8px">${r.keys ? r.keys.length : 0}</div><div class="d">${r.middleware && r.middleware.up ? "connected" : "ready"}</div></div>
    </div>

    <div class="grid" style="grid-template-columns:1fr 1fr">
      <div class="card">
        <div class="card-title" style="margin-bottom:14px">Ranks distribution</div>
        ${["free", "plus", "pro", "max"].map((k) => `
          <div class="between" style="margin-bottom:12px">
            <span class="card-sub" style="text-transform:capitalize">${k}</span>
            <b>${r.stats.byRank[k] || 0}</b>
          </div>`).join("")}
      </div>
      <div class="card">
        <div class="card-title" style="margin-bottom:14px">Latest activity</div>
        ${r.audit.slice(0, 12).map((a) => `
          <div class="audit-line">${new Date(a.at).toLocaleString()} · ${esc(a.action)} · ${esc(a.detail)}</div>`).join("") || `<div class="card-sub">Nothing yet.</div>`}
      </div>
    </div>`;
}

/* ---------------- keys ---------------- */

async function loadKeys() {
  const r = await api.get("/api/admin/keys?status=" + keyFilter);
  KEYS = r.ok ? r.keys : [];
  if (!r.ok && r.error) toast(r.error, "err");
}

async function pageKeys() {
  await loadKeys();
  devView.innerHTML = `
    <div class="page-head">
      <div><h1>Keys</h1><div class="sub">Summon keys into the middleware (ตัวกลาง). Users redeem them in Paids.</div></div>
      <div class="row">
        <button class="btn danger sm" id="btnResetLicenses">${ico("refresh") || "↻"} Reset Licenses</button>
        <div class="switch" id="tgLive" title="Toggle: show LIVE only"></div>
        <span class="tiny" id="tgLabel">SHOW: ${keyFilter.toUpperCase()}</span>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="card-title" style="margin-bottom:16px">${ico("zap")} Summon new keys</div>
      <div class="grid" style="grid-template-columns:200px 140px auto; align-items:end">
        <div class="field" style="margin:0">
          <label>Rank</label>
          <select class="input" id="genRank">
            <option value="free">Free (1 srv / 7d)</option>
            <option value="plus" selected>Plus — ฿79 (3 srv / 10d)</option>
            <option value="pro">Pro — ฿149 (5 srv / 18d)</option>
            <option value="max">Max Vaxtor — ฿249 (10 srv / 30d)</option>
            <option value="dev">Dev — UNLIMITED (999 srv / 999999d / ∞ CPU+RAM)</option>
          </select>
        </div>
        <div class="field" style="margin:0">
          <label>Quantity</label>
          <input class="input" id="genCount" type="number" min="1" max="100" value="5" />
        </div>
        <button class="btn primary" id="btnGen">${ico("zap")} Summon keys</button>
      </div>
    </div>

    <div id="keyList" style="display:grid; gap:9px"></div>`;

  $("tgLive").classList.toggle("on", keyFilter === "live");
  $("tgLive").onclick = () => { keyFilter = keyFilter === "all" ? "live" : keyFilter === "live" ? "unlive" : "all"; pageKeys(); };

  const btnReset = $("btnResetLicenses");
  if (btnReset) {
    btnReset.onclick = async () => {
      if (!confirm("Reset ALL licenses?\n\nThis will delete ALL keys from the middleware and revert EVERY user to Free rank. Running bots of paid users will be stopped. This cannot be undone.")) return;
      if (!confirm("Are you absolutely sure? This will remove all ranks from all users.")) return;
      const r = await api.post("/api/admin/licenses/reset", {});
      if (!r.ok) return toast(r.error || "Failed to reset licenses", "err");
      if (typeof showSlider === "function") showSlider("Licenses Reset", `All keys deleted & ${r.reset || 0} user(s) reverted to Free`, "ok");
      else toast("All licenses reset", "ok");
      pageKeys();
    };
  }

  $("btnGen").onclick = async () => {
    const rank = $("genRank").value;
    const count = Number($("genCount").value) || 1;
    const r = await api.post("/api/admin/keys/generate", { rank, count });
    if (!r.ok) return toast(r.error, "err");
    if (typeof showSlider === "function") showSlider("Keys Summoned", `${r.keys.length} × ${rank} key(s) added to middleware`, "ok");
    else toast(`${r.keys.length} × ${rank} key summoned into the middleware.`, "ok");
    renderKeyList();
  };

  renderKeyList();
}

async function renderKeyList() {
  await loadKeys();
  $("tgLabel").textContent = "SHOW: " + keyFilter.toUpperCase();
  const host = $("keyList");
  if (!host) return;
  if (!KEYS.length) {
    host.innerHTML = `<div class="card empty"><div class="big-ico" style="color:#7c3aed">${ico("key", 40)}</div>No keys here. Summon some above.</div>`;
    return;
  }
  host.innerHTML = KEYS.map((k) => `
    <div class="key-card" data-key="${esc(k.key)}">
      <div>
        <div class="k" style="cursor:pointer" title="Click to copy" data-copy-key="${esc(k.key)}">${esc(k.key)}</div>
        <div class="tiny" style="margin-top:3px">
          ${esc(k.rank.toUpperCase())} · created ${new Date(k.createdAt).toLocaleString()}
          ${k.used ? ` · used by ${esc(k.usedByName || "—")} ${new Date(k.usedAt).toLocaleString()}` : ""}
        </div>
      </div>
      <button class="btn sm ghost" data-copy-key-btn="${esc(k.key)}" title="Copy key">${ico("copy") || "Copy"}</button>
      <span class="lbl ${k.used ? "unlive" : "live"}">${k.used ? "UNLIVE" : "LIVE"}</span>
      <span class="circ ${k.used ? "unlive" : "live"}"></span>
      <button class="btn sm danger" data-del="${esc(k.key)}">${ico("trash")}</button>
    </div>`).join("");

  host.querySelectorAll("[data-copy-key], [data-copy-key-btn]").forEach((el) => {
    el.onclick = async (e) => {
      e.stopPropagation();
      const key = el.dataset.copyKey || el.dataset.copyKeyBtn;
      try {
        await navigator.clipboard.writeText(key);
        if (typeof showSlider === "function") showSlider("Key copied", key, "ok");
        else toast("Key copied to clipboard", "ok");
      } catch (_) {
        toast("Failed to copy key", "err");
      }
    };
  });

  host.querySelectorAll("[data-del]").forEach((btn) => {
    btn.onclick = async () => {
      const key = btn.dataset.del;
      if (!confirm(`Delete key ${key}?\n\nIf it was already used, the rank it granted is REVOKED immediately.`)) return;
      const r = await api.del("/api/admin/keys/" + key);
      if (!r.ok) return toast(r.error, "err");
      if (typeof showSlider === "function") showSlider(r.revokedFrom ? "Key deleted" : "Key deleted", r.revokedFrom ? `Rank revoked from ${r.revokedFrom}` : key, "ok");
      else toast(r.revokedFrom ? `Key deleted — rank revoked from ${r.revokedFrom}.` : "Key deleted.", "ok");
      renderKeyList();
    };
  });
}

/* ---------------- users-set ---------------- */

async function pageUserSet() {
  const r = await api.get("/api/admin/users");
  USERS = r.ok ? r.users : [];

  if (!openUserFolder) {
    devView.innerHTML = `
      <div class="page-head">
        <div><h1>Users-set</h1><div class="sub">Every account that signed in to Vaxtor.</div></div>
        <span class="badge violet">${USERS.length} USERS</span>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:12px" id="userGrid">
        ${USERS.map((u) => `
          <div class="user-file" data-user="${u.id}">
            <div class="avatar" style="width:34px;height:34px;font-size:13px">${esc((u.name || "?")[0].toUpperCase())}</div>
            <div style="min-width:0; flex:1">
              <div style="font-family:var(--mono); font-size:14px; font-weight:700">${esc(u.name)}.js</div>
              <div class="tiny" style="margin-top:2px">${esc(u.rankName)} · ${u.botCount} bots${u.banned ? " · BANNED" : ""}</div>
            </div>
            <span class="dot ${u.banned ? "red" : "green"}"></span>
          </div>`).join("") || `<div class="card empty">No users yet.</div>`}
      </div>`;

    // folder header above the list
    const head = document.createElement("div");
    head.className = "row";
    head.style.marginBottom = "16px";
    head.innerHTML = `<span class="badge">${ico("folder")} Users-set</span><span class="tiny">/ User /</span>`;
    devView.insertBefore(head, devView.children[1]);

    document.querySelectorAll("[data-user]").forEach((el) => (el.onclick = () => openUser(el.dataset.user)));
    return;
  }

  /* ---- inside the folder: single user profile (User.html) ---- */
  const u = USERS.find((x) => x.id === openUserFolder);
  if (!u) { openUserFolder = false; return pageUserSet(); }
  const bots = await api.get("/api/bots?all=1").catch(() => ({ bots: [] }));

  devView.innerHTML = `
    <div class="page-head">
      <div class="row">
        <button class="btn sm ghost" id="btnBackUsers">← Users-set</button>
        <span class="badge">${ico("folder")} User / ${esc(u.name)}.js</span>
      </div>
    </div>

    <div class="grid" style="grid-template-columns:320px 1fr; align-items:start">
      <div class="card" style="text-align:center">
        <div class="avatar" style="width:74px; height:74px; font-size:28px; margin:0 auto 14px">${esc((u.name || "?")[0].toUpperCase())}</div>
        <div style="font-size:21px; font-weight:820">${esc(u.name)}</div>
        <div class="card-sub">${esc(u.email)}</div>
        <div class="row" style="justify-content:center; margin-top:14px">
          <span class="badge violet" style="color:${esc(u.rankColor)}">${esc(u.rankName).toUpperCase()}</span>
          <span class="badge ${u.banned ? "red" : "green"}">${u.banned ? "BANNED" : "ACTIVE"}</span>
        </div>
        <hr class="sep">
        <div style="text-align:left; display:grid; gap:10px">
          <div class="between"><span class="card-sub">User ID</span><span class="kbd">${esc(u.id)}</span></div>
          <div class="between"><span class="card-sub">Joined</span><b style="font-size:12.5px">${new Date(u.createdAt).toLocaleDateString()}</b></div>
          <div class="between"><span class="card-sub">Last login</span><b style="font-size:12.5px">${u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "—"}</b></div>
          <div class="between"><span class="card-sub">Bot servers</span><b>${u.botCount} / ${u.maxServers}</b></div>
          <div class="between"><span class="card-sub">ncb left</span><b>${u.rank === "free" ? "unlimited" : fmtDuration(u.ncbRemaining)}</b></div>
          <div class="between"><span class="card-sub">Discord</span><b style="font-size:12.5px">${u.discordId ? "linked" : "—"}</b></div>
        </div>
      </div>

      <div style="display:grid; gap:16px">
        <div class="card">
          <div class="card-title" style="margin-bottom:14px">Admin actions</div>
          <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
            ${u.banned
              ? `<button class="btn" style="border-color:rgba(34,197,94,.5); color:#86efac" id="btnUnban">${ico("check")} Unban user</button>`
              : `<button class="btn danger" id="btnBan">${ico("ban")} Ban user</button>`}
            <button class="btn" style="border-color:rgba(234,179,8,.5); color:#fde047" id="btnKick">${ico("kick")} Kick sign in</button>
            <button class="btn danger" id="btnDelete">${ico("userMinus")} Delete user</button>
          </div>
          <div class="card-sub" style="margin-top:14px">
            <b>Ban</b> = cannot open the website, all bots stopped. · <b>Kick</b> = all sessions signed out (can sign in again). ·
            <b>Delete</b> = account, bots and files gone forever (use when someone hacks the panel).
          </div>
        </div>

        <div class="card">
          <div class="card-title" style="margin-bottom:14px">Rank control</div>
          <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
            ${["free", "plus", "pro", "max"].map((rk) => `<button class="btn ${u.rank === rk ? "primary" : ""}" data-rank="${rk}">${rk}</button>`).join("")}
          </div>
          <div class="card-sub" style="margin-top:12px">Grant a rank manually (sets full ncb time), or drop them back to Free.</div>
        </div>
      </div>
    </div>`;

  $("btnBackUsers").onclick = () => { openUserFolder = false; pageUserSet(); };

  const reload = () => { pageUserSet(); };
  if ($("btnBan")) $("btnBan").onclick = async () => {
    const r = await api.post(`/api/admin/users/${u.id}/ban`);
    if (!r.ok) return toast(r.error, "err");
    toast(`${u.name} banned.`, "ok"); reload();
  };
  if ($("btnUnban")) $("btnUnban").onclick = async () => {
    const r = await api.post(`/api/admin/users/${u.id}/unban`);
    if (!r.ok) return toast(r.error, "err");
    toast(`${u.name} unbanned.`, "ok"); reload();
  };
  $("btnKick").onclick = async () => {
    const r = await api.post(`/api/admin/users/${u.id}/kick`);
    if (!r.ok) return toast(r.error, "err");
    toast(`${u.name} kicked out of ${r.kicked} session(s).`, "ok");
  };
  $("btnDelete").onclick = async () => {
    if (!confirm(`DELETE ${u.name}?\n\nThis removes the account, all their bots and files. Cannot be undone.`)) return;
    if (!confirm("Last chance. Really delete everything?")) return;
    const r = await api.del(`/api/admin/users/${u.id}`);
    if (!r.ok) return toast(r.error, "err");
    toast(`${u.name} deleted.`, "ok");
    openUserFolder = false; reload();
  };
  document.querySelectorAll("[data-rank]").forEach((btn) => (btn.onclick = async () => {
    const r = await api.post(`/api/admin/users/${u.id}/rank`, { rank: btn.dataset.rank });
    if (!r.ok) return toast(r.error, "err");
    toast(`${u.name} -> ${btn.dataset.rank}`, "ok"); reload();
  }));
}

function openUser(id) { openUserFolder = id; pageUserSet(); }

/* ---------------- audit ---------------- */

async function pageAudit() {
  const r = await api.get("/api/admin/audit");
  devView.innerHTML = `
    <div class="page-head"><div><h1>Audit log</h1><div class="sub">Everything that happened on the platform.</div></div></div>
    <div class="card">
      ${(r.audit || []).map((a) => `<div class="audit-line">${new Date(a.at).toLocaleString()} · <b style="color:#d8b4fe">${esc(a.action)}</b> · ${esc(a.detail)}</div>`).join("") || `<div class="card-sub">Empty.</div>`}
    </div>`;
}

/* ---------------- settings ---------------- */

async function pageSettings() {
  const r = await api.get("/api/admin/settings");
  devView.innerHTML = `
    <div class="page-head"><div><h1>Settings</h1><div class="sub">Panel &amp; platform configuration.</div></div></div>
    <div class="grid" style="grid-template-columns:1fr 1fr; align-items:start">
      <div class="card">
        <div class="card-title" style="margin-bottom:16px">Discord login (OAuth2)</div>
        <div class="field"><label>Client ID</label><input class="input mono" id="sCid" value="${esc(r.discord.clientId)}" placeholder="discord developer portal → OAuth2 client id" /></div>
        <div class="field"><label>Client Secret</label><input class="input mono" id="sCsec" type="password" value="" placeholder="${r.discord.configured ? "•••• (saved — leave blank to keep)" : "client secret"}" /></div>
        <div class="card-sub" style="margin-bottom:14px">Redirect URL to add in the Discord portal: <span class="kbd">${esc(r.appUrl)}/api/auth/discord/callback</span></div>
        <button class="btn primary" id="btnSaveDiscord">Save Discord settings</button>
      </div>
      <div class="card">
        <div class="card-title" style="margin-bottom:16px">Security &amp; infra</div>
        <div class="field"><label>New dev panel password</label><input class="input" id="sPass" type="password" placeholder="leave blank to keep current" /></div>
        <div class="between" style="margin:16px 0">
          <span class="card-sub">Key middleware (ตัวกลาง)</span>
          <span class="kbd">${esc(r.keyMiddlewareUrl)}</span>
        </div>
        <div class="between" style="margin-bottom:16px">
          <span class="card-sub">Public app URL</span>
          <span class="kbd">${esc(r.appUrl)}</span>
        </div>
        <button class="btn" id="btnSaveSec">Save security</button>
      </div>
    </div>`;

  $("btnSaveDiscord").onclick = async () => {
    const body = { discordClientId: $("sCid").value.trim() };
    if ($("sCsec").value) body.discordClientSecret = $("sCsec").value;
    const r = await api.patch("/api/admin/settings", body);
    if (!r.ok) return toast(r.error, "err");
    toast("Discord settings saved.", "ok");
    pageSettings();
  };
  $("btnSaveSec").onclick = async () => {
    if (!$("sPass").value) return toast("Enter a new password first.", "err");
    const r = await api.patch("/api/admin/settings", { adminPassword: $("sPass").value });
    if (!r.ok) return toast(r.error, "err");
    toast("Dev password changed.", "ok");
    $("sPass").value = "";
  };
}

tryRestore();
