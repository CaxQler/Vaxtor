"use strict";
/* ═══════════════════════════════════════════════════════════
   VAXTOR — dashboard SPA
   routes: /Overview /Services /Invoices /Paids /Settings
           /Bot/:id/Overview | Manage | Console | Seted
   ═══════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);
const view = $("view");
let ME = null;
let BOTS = [];
let PLAN_LIST = [];
let currentWS = null;

window.closeModal = (id) => $(id).classList.remove("show");

/* ---------------- boot ---------------- */

async function boot() {
  const me = await api.get("/api/auth/me");
  if (!me.ok || !me.user) { location.href = "/auth"; return; }
  ME = me.user;
  renderProfile();
  await refreshBots();
  const plans = await api.get("/api/plans");
  PLAN_LIST = plans.plans || [];
  route();
}

function renderProfile() {
  $("pfName").textContent = ME.name;
  $("pfEmail").textContent = ME.email;
  $("pfAvatar").textContent = (ME.name || "?")[0].toUpperCase();
  const r = $("pfRank");
  r.textContent = (ME.rankName || "Free").toUpperCase();
  r.style.color = ME.rankColor || "#d8b4fe";
}

async function refreshBots() {
  const r = await api.get("/api/bots");
  if (r.ok) {
    BOTS = r.bots || [];
    $("cntBots").textContent = BOTS.length;
    const side = $("sideBots");
    side.innerHTML = BOTS.map((b) => `
      <div class="nav-item" data-route="/Bot/${b.id}/Overview" style="padding-left:16px">
        <span class="dot ${b.status === "running" ? "green" : b.status === "paused" ? "yellow" : ""}" data-stat-dot="${b.id}"></span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(b.name)}</span>
      </div>`).join("") || `<div class="tiny" style="padding:6px 13px; opacity:.6">no bots yet</div>`;
    bindRoutes();
  }
}

function bindRoutes() {
  document.querySelectorAll("[data-route]").forEach((el) => {
    el.onclick = () => { go(el.dataset.route); if (window.innerWidth <= 1020) { $("sidebar")?.classList.remove("open"); $("scrim")?.classList.remove("show"); document.body.style.overflow = ""; } };
  });
}

/* ---------------- live status (always truthful, no relogin needed) ---------------- */

function statusLabel(b) {
  return b.status === "running" ? "online · " + fmtUptime(b.uptimeMs) + " uptime"
    : b.status === "paused" ? "paused · on standby — press Start to resume"
    : b.status === "installing" ? "installing dependencies…"
    : "offline";
}

function patchStatusUI() {
  const running = BOTS.filter((b) => b.status === "running").length;
  for (const b of BOTS) {
    const dotCls = "dot " + (b.status === "running" ? "green" : b.status === "paused" || b.status === "installing" ? "yellow" : "");
    document.querySelectorAll(`[data-stat-dot="${b.id}"]`).forEach((el) => (el.className = dotCls));
    document.querySelectorAll(`[data-stat-badge="${b.id}"]`).forEach((el) => {
      el.className = "badge " + (b.status === "running" ? "green" : b.status === "paused" || b.status === "installing" ? "amber" : "");
      el.textContent = String(b.status || "").toUpperCase();
    });
    document.querySelectorAll(`[data-stat-sub="${b.id}"]`).forEach((el) => (el.textContent = statusLabel(b)));
    document.querySelectorAll(`[data-stat-big="${b.id}"]`).forEach((el) => {
      el.textContent = String(b.status || "stopped").toUpperCase();
      el.style.color = b.status === "running" ? "var(--green)" : b.status === "paused" ? "#fde047" : "var(--muted)";
    });
    document.querySelectorAll(`[data-stat-bigd="${b.id}"]`).forEach((el) => {
      el.textContent = b.status === "running" ? "up " + fmtUptime(b.uptimeMs) : b.status === "paused" ? "on standby — not running" : b.status === "installing" ? "installing…" : "not running";
    });
  }
  document.querySelectorAll("[data-running-count]").forEach((el) => (el.textContent = running + " running now"));
  document.querySelectorAll("[data-status-line]").forEach((el) => {
    el.previousElementSibling && (el.previousElementSibling.className = "dot " + (running ? "green" : "red"));
    el.textContent = running ? running + " bot(s) online" : "No bots running";
  });
  document.querySelectorAll("[data-stat-files]").forEach((el) => {
    const b = BOTS.find((x) => x.id === el.getAttribute("data-stat-files"));
    if (b) el.textContent = b.fileCount;
  });
}

setInterval(async () => {
  if (!ME || document.hidden) return;
  const r = await api.get("/api/bots");
  if (!r.ok) return;
  BOTS = r.bots || [];
  patchStatusUI();
}, 3500);

// catch up instantly whenever the tab becomes visible again
document.addEventListener("visibilitychange", async () => {
  if (document.hidden || !ME) return;
  const r = await api.get("/api/bots");
  if (r.ok) { BOTS = r.bots || []; patchStatusUI(); }
});

/* ---------------- router ---------------- */

const SPA_PATHS = /^\/(Overview|Services|Invoices|Paids|Settings)(\/|\/?$)/i;
const SPA_BOT = /^\/Bot\/[\w-]+\/(Overview|Manage|Console|Seted)\/?$/i;

/** Navigate to a clean path (pushState + render). */
function go(path) {
  if (location.pathname + location.search === path) return;
  history.pushState({}, "", path);
  route();
}
window.go = go;

/** Current route segments, tolerant of legacy /app.html#/... links. */
function routeSegs() {
  let raw = location.hash && location.hash.startsWith("#/") ? location.hash.slice(1) : location.pathname;
  raw = raw.replace(/^\/+|\/+$/g, "");
  if (!raw || raw.toLowerCase() === "app.html" || raw.toLowerCase() === "index.html") raw = "Overview";
  return raw.split("/");
}

async function route() {
  if (currentWS) { try { currentWS.close(); } catch (_) {} currentWS = null; }
  // migrate legacy hash URLs to clean paths
  if (location.hash.startsWith("#/")) {
    const segs = routeSegs();
    const pretty = segs[0].toLowerCase() === "bot"
      ? `/Bot/${segs[1] || ""}/${(segs[2] || "overview").replace(/^./, (c) => c.toUpperCase())}`
      : "/" + segs[0].replace(/^./, (c) => c.toUpperCase());
    history.replaceState({}, "", pretty);
  }
  const parts = routeSegs();
  parts[0] = (parts[0] || "").toLowerCase();
  parts[2] = (parts[2] || "").toLowerCase();

  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
  const navMatch = document.querySelector(`.nav-item[data-route="/${parts[0].replace(/^./, (c) => c.toUpperCase())}"]`);
  if (navMatch) navMatch.classList.add("active");

  view.innerHTML = `<div class="empty"><div class="big-ico spin" style="color:#8b5cf6">${ico("loader", 34)}</div>Loading…</div>`;

  if (parts[0] === "bot" && parts[1]) {
    const bot = BOTS.find((b) => b.id === parts[1]);
    if (!bot) { view.innerHTML = `<div class="empty"><div class="big-ico" style="color:#7c3aed">${ico("box", 40)}</div>Bot not found. <a href="/Services" style="color:#c4b5fd">Back to Services</a></div>`; return; }
    const page = parts[2] || "overview";
    renderBotNav(bot, page);
    if (page === "manage") return viewManage(bot);
    if (page === "console") return viewConsole(bot);
    if (page === "seted") return viewSeted(bot);
    return viewBotOverview(bot);
  }

  switch (parts[0]) {
    case "services": return viewServices();
    case "invoices": return viewInvoices();
    case "paids": return viewPaids();
    case "settings": return viewSettings();
    default: return viewOverview();
  }
}
window.addEventListener("popstate", () => route());
document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
  const a = e.target.closest("a[href]");
  if (!a) return;
  const href = a.getAttribute("href");
  if (href && (SPA_PATHS.test(href) || SPA_BOT.test(href))) { e.preventDefault(); go(href.replace(/\/$/, "")); }
});

/* ---------------- OVERVIEW ---------------- */

async function viewOverview() {
  const r = await api.get("/api/overview");
  if (!r.ok) return;
  const u = r.user, s = r.stats;
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const maxSec = Math.max(1, ...s.week.map((w) => w.seconds));

  view.innerHTML = `
    <div class="page-head">
      <div>
        <h1>${greet}, <span class="grad-text">${esc(u.name)}</span>.</h1>
        <div class="sub">Your rank is <b style="color:${u.rankColor}">${esc(u.rankName)}</b> · ${u.bots ?? s.bots} bot server${s.bots === 1 ? "" : "s"} · keep them online 24/7.</div>
      </div>
      <a class="btn primary" href="/Services">+ New bot</a>
    </div>

    <div class="stat-grid">
      <div class="card stat"><div class="k">Bot servers</div><div class="v">${s.bots}<span style="font-size:16px;color:var(--muted)"> / ${s.maxServers}</span></div><div class="d" data-running-count>${s.running} running now</div></div>
      <div class="card stat"><div class="k">ncb time left</div><div class="v">${u.rank === "free" ? "∞" : fmtDuration(u.ncbRemaining)}</div><div class="d">${u.rank === "free" ? "Free plan never expires" : "Only counts while a bot runs"}</div></div>
      <div class="card stat"><div class="k">Total runtime</div><div class="v">${fmtUptime(s.totalRuntimeMs)}</div><div class="d">across all bots</div></div>
      <div class="card stat"><div class="k">Rank</div><div class="v" style="color:${u.rankColor}; font-size:26px">${esc(u.rankName)}</div><div class="d">${u.maxServers} servers · ncb ${Math.round(u.ncbTotal / 86400)}d</div></div>
    </div>

    <div class="grid" style="grid-template-columns:1.6fr 1fr">
      <div class="card">
        <div class="between" style="margin-bottom:18px">
          <div><div class="card-title">Runtime — last 7 days</div><div class="card-sub">seconds your bots were on (ncb clock)</div></div>
        </div>
        <div class="chart">
          ${s.week.map((w) => `
            <div class="bar" title="${w.day}: ${fmtDuration(w.seconds)}">
              <i style="height:${Math.round((w.seconds / maxSec) * 100)}%"></i>
              <span>${w.label}</span>
            </div>`).join("")}
        </div>
      </div>
      <div class="card">
        <div class="card-title" style="margin-bottom:14px">Quick start</div>
        <div style="display:grid; gap:10px">
          <a class="btn block" href="/Services">${ico("server")} Services — manage bots</a>
          <a class="btn block" href="/Paids">${ico("gem")} Paids — upgrade rank</a>
          <a class="btn block" href="/Invoices">${ico("chart")} Invoices — usage report</a>
          <a class="btn block" href="/Settings">${ico("sliders")} Settings — your account</a>
        </div>
        <hr class="sep">
        <div class="tiny">STATUS</div>
        <div class="row" style="margin-top:10px">
          <span class="dot ${s.running ? "green" : "red"}"></span>
          <span style="font-size:13.5px" data-status-line>${s.running ? s.running + " bot(s) online" : "No bots running"}</span>
        </div>
      </div>
    </div>`;
}

/* ---------------- SERVICES ---------------- */

async function viewServices() {
  await refreshBots();
  const r = await api.get("/api/bots");
  const max = r.maxServers || 1;

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Services</h1><div class="sub">Your bot servers — ${BOTS.length} / ${max} slots used (${esc(r.rank || "free")} rank).</div></div>
      <button class="btn primary" id="btnCreate">+ Create bot server</button>
    </div>
    <div id="botGrid"></div>`;

  $("btnCreate").onclick = () => {
    if (BOTS.length >= max) {
      toast(`Your rank allows ${max} server(s). Upgrade in Paids to add more.`, "err");
      return;
    }
    $("newBotName").value = "";
    $("modalCreate").classList.add("show");
    setTimeout(() => $("newBotName").focus(), 60);
  };

  $("btnDoCreate").onclick = async () => {
    const name = $("newBotName").value.trim();
    if (!name) return toast("Enter a bot name.", "err");
    const res = await api.post("/api/bots", { name });
    if (!res.ok) return toast(res.error, "err");
    if (typeof showSlider === "function") showSlider("Bot Created", `"${name}" created — drag your project in`, "ok");
    else toast(`Bot "${name}" created — now drag your project in.`, "ok");
    $("modalCreate").classList.remove("show");
    go(`/Bot/${res.bot.id}/Manage`);
  };

  const grid = $("botGrid");
  if (!BOTS.length) {
    grid.innerHTML = `
      <div class="card empty">
        <div class="big-ico" style="color:#7c3aed">${ico("box", 40)}</div>
        <div style="font-size:17px; font-weight:700; margin-bottom:6px">No bots yet</div>
        <div style="margin-bottom:20px">Create a server, drag your project folder in, and Vaxtor installs everything for you.</div>
        <button class="btn primary" onclick="document.getElementById('btnCreate').click()">+ Create your first bot</button>
      </div>`;
    return;
  }
  grid.className = "bot-grid";
  grid.innerHTML = BOTS.map((b) => `
    <div class="card hover bot-card" onclick="go('/Bot/${b.id}/Overview')">
      <div class="between">
        <div class="bname">${esc(b.name)}</div>
        <div class="row" style="gap:9px; align-items:center">
          <button class="icon-btn danger" data-del-bot="${b.id}" title="Delete project">${ico("trash")}</button>
          <span class="dot ${b.status === "running" ? "green" : b.status === "paused" || b.status === "installing" ? "yellow" : ""}" data-stat-dot="${b.id}"></span>
        </div>
      </div>
      <div class="card-sub" style="margin-top:4px" data-stat-sub="${b.id}">${statusLabel(b)}</div>
      <div class="bot-meta">
        <span class="badge violet">${esc(b.language)}</span>
        <span class="badge">${b.fileCount} files</span>
        <span class="badge ${b.tokenSet ? "green" : "amber"}">${b.tokenSet ? "token set" : "no token"}</span>
      </div>
    </div>`).join("");

  grid.querySelectorAll("[data-del-bot]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-del-bot");
      const bot = BOTS.find((x) => x.id === id);
      if (!confirm(`Delete project "${bot ? bot.name : id}"?\nAll files, logs and settings will be removed forever.`)) return;
      const r = await api.del("/api/bots/" + id);
      if (!r.ok) return toast(r.error, "err");
      toast("Project deleted.", "ok");
      viewServices();
    });
  });
}

/* ---------------- INVOICES (usage report) ---------------- */

async function viewInvoices(invTab) {
  invTab = invTab === "report" ? "report" : "analytics";
  const r = await api.get("/api/overview");
  const u = r.user, s = r.stats;

  const rows = [];
  for (const b of BOTS) {
    const detail = await api.get("/api/bots/" + b.id);
    rows.push({ bot: detail.bot || b, run: detail.runCommand, detected: detail.detected });
  }

  const weekTotal = s.week.reduce((a, w) => a + w.seconds, 0);
  const maxSec = Math.max(1, ...s.week.map((w) => w.seconds));
  const dailyAvg = weekTotal / 7;
  const today = new Date().toISOString().slice(0, 10);

  /* ---- analysis data ---- */
  const totalAll = Math.max(1, rows.reduce((a, x) => a + (x.bot.totalRuntimeMs || 0), 0));
  const shares = rows.map(({ bot }) => ({
    name: bot.name, ms: bot.totalRuntimeMs || 0,
    pct: Math.round(((bot.totalRuntimeMs || 0) / totalAll) * 100),
  })).sort((a, b) => b.ms - a.ms);
  const todays = rows.map(({ bot }) => ({
    name: bot.name, sec: (bot.usageByDay && bot.usageByDay[today]) || 0,
  }));
  const maxToday = Math.max(1, ...todays.map((t) => t.sec));
  const todayTotal = todays.reduce((a, t) => a + t.sec, 0);
  const uptimePct = rows.length ? Math.round((todayTotal / (86400 * rows.length)) * 100) : 0;

  let paceText, paceColor;
  if (u.rank === "free") { paceText = "Free plan never expires — run at any pace"; paceColor = "#86efac"; }
  else if (dailyAvg >= 60) {
    const daysLeft = u.ncbRemaining / dailyAvg;
    paceText = `≈ ${Math.floor(daysLeft)} days left at this pace (${fmtDuration(Math.round(dailyAvg))}/day)`;
    paceColor = daysLeft < 3 ? "#fca5a5" : daysLeft < 7 ? "#fde047" : "#86efac";
  } else { paceText = "No meaningful runtime this week — pace is stable"; paceColor = "var(--muted)"; }

  const tabsHtml = `
    <div class="tabs" style="margin:6px 0 18px">
      <button class="${invTab === "analytics" ? "active" : ""}" onclick="viewInvoices('analytics')">${ico("chart")} Analytics</button>
      <button class="${invTab === "report" ? "active" : ""}" onclick="viewInvoices('report')">${ico("file")} Report</button>
    </div>`;

  const analyticsHtml = `
    <div class="card" style="margin-bottom:18px">
      <div class="between" style="margin-bottom:16px">
        <div><div class="card-title">Runtime — last 7 days</div><div class="card-sub">seconds your bots were on (ncb clock)</div></div>
        <span class="badge violet">AVG ${fmtDuration(Math.round(dailyAvg))} / DAY</span>
      </div>
      <div class="chart">
        ${s.week.map((w) => `<div class="bar" title="${w.day}: ${fmtDuration(w.seconds)}"><i style="height:${Math.round((w.seconds / maxSec) * 100)}%"></i><span>${w.label}</span></div>`).join("")}
      </div>
    </div>

    <div class="grid" style="grid-template-columns:1fr 1fr; margin-bottom:18px">
      <div class="card">
        <div class="card-title" style="margin-bottom:16px">Runtime share by bot</div>
        ${shares.map((x) => `
          <div style="margin-bottom:13px">
            <div class="between" style="font-size:13px; margin-bottom:6px">
              <span style="font-weight:650">${esc(x.name)}</span>
              <span class="mono" style="color:var(--muted); font-size:12px">${fmtUptime(x.ms)} · ${x.pct}%</span>
            </div>
            <div class="hbar"><i style="width:${Math.max(2, x.pct)}%"></i></div>
          </div>`).join("") || `<div class="card-sub">No bots yet.</div>`}
      </div>
      <div class="card">
        <div class="card-title" style="margin-bottom:16px">Today's activity — ${esc(today)}</div>
        <div class="chart">
          ${todays.map((t) => `<div class="bar" title="${esc(t.name)}: ${fmtDuration(t.sec)} today"><i style="height:${Math.max(2, Math.round((t.sec / maxToday) * 100))}%"></i><span>${esc(t.name.slice(0, 6))}</span></div>`).join("") || `<div class="card-sub">No bots yet.</div>`}
        </div>
        <div class="tiny" style="margin-top:10px; text-align:center">RUNTIME PER BOT TODAY — ${fmtDuration(todayTotal)} TOTAL</div>
      </div>
    </div>

    <div class="stat-grid">
      <div class="card stat"><div class="k">Runtime this week</div><div class="v">${fmtDuration(weekTotal)}</div><div class="d">ncb consumed</div></div>
      <div class="card stat"><div class="k">Daily average</div><div class="v">${fmtDuration(Math.round(dailyAvg))}</div><div class="d">across all bots</div></div>
      <div class="card stat"><div class="k">Uptime today</div><div class="v" style="color:${uptimePct >= 50 ? "#86efac" : uptimePct >= 15 ? "#fde047" : "var(--muted)"}">${uptimePct}%</div><div class="d">average across ${rows.length || 0} bot(s)</div></div>
      <div class="card stat"><div class="k">Pace forecast</div><div class="v" style="color:${paceColor}; font-size:17px; line-height:1.35">${paceText}</div><div class="d">based on the last 7 days</div></div>
    </div>`;

  const reportHtml = `
    <div class="card" style="margin-bottom:18px">
      <div class="between" style="flex-wrap:wrap; gap:12px">
        <div><div class="card-title">Plan & balance</div><div class="card-sub">${esc(u.rankName)} · ${u.rank === "free" ? "no expiry" : fmtDuration(u.ncbRemaining) + " ncb left"}</div></div>
        <span class="badge ${s.running ? "green" : ""}">${s.running} RUNNING / ${s.bots} TOTAL</span>
      </div>
    </div>
    <div class="card" style="padding:8px 18px 18px">
      <div class="card-title" style="margin:14px 0 8px">Bot health</div>
      <table class="tbl">
        <thead><tr><th>Bot</th><th>Status</th><th>Language</th><th>Run command</th><th>Total runtime</th><th>Health</th></tr></thead>
        <tbody>
          ${rows.map(({ bot, run, detected }) => `
            <tr>
              <td><b>${esc(bot.name)}</b></td>
              <td><span class="badge ${bot.status === "running" ? "green" : bot.status === "paused" ? "amber" : ""}">${bot.status.toUpperCase()}</span></td>
              <td class="mono">${esc(bot.language || detected || "?")}</td>
              <td class="mono" style="color:var(--muted); font-size:12.4px">${run ? esc(run.command + " " + run.args.join(" ")) : "—"}</td>
              <td>${fmtUptime(bot.totalRuntimeMs)}</td>
              <td>${bot.lastError ? `<span class="badge red">ERROR</span>` : bot.status === "running" ? `<span class="badge green">HEALTHY</span>` : bot.status === "paused" ? `<span class="badge amber">PAUSED</span>` : `<span class="badge">IDLE</span>`}
                  ${bot.exitCode !== null && bot.exitCode !== undefined ? `<div class="tiny" style="margin-top:4px">exit: ${esc(bot.exitCode)}</div>` : ""}</td>
            </tr>`).join("") || `<tr><td colspan="6" style="text-align:center; color:var(--muted); padding:28px">No bots yet.</td></tr>`}
        </tbody>
      </table>
    </div>`;

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Invoices</h1><div class="sub">Usage analysis — graphs, forecasts and the health report of your bots.</div></div>
      <span class="badge ${s.running ? "green" : ""}">${s.running} RUNNING / ${s.bots} TOTAL</span>
    </div>

    <div class="stat-grid">
      <div class="card stat"><div class="k">Runtime this week</div><div class="v">${fmtDuration(weekTotal)}</div><div class="d">ncb consumed</div></div>
      <div class="card stat"><div class="k">Total runtime</div><div class="v">${fmtUptime(s.totalRuntimeMs)}</div><div class="d">all time</div></div>
      <div class="card stat"><div class="k">Plan</div><div class="v" style="color:${u.rankColor};font-size:24px">${esc(u.rankName)}</div><div class="d">${u.rank === "free" ? "no expiry" : fmtDuration(u.ncbRemaining) + " left"}</div></div>
      <div class="card stat"><div class="k">Servers</div><div class="v">${s.bots} / ${s.maxServers}</div><div class="d">slots used</div></div>
    </div>

    ${tabsHtml}
    ${invTab === "analytics" ? analyticsHtml : reportHtml}`;
}

/* ---------------- PAIDS ---------------- */

async function viewPaids() {
  const r = await api.get("/api/plans/status");
  const u = r.user, usage = r.usage, mwUp = r.middleware.up;
  const limTxt = (lim) => !lim ? "" : lim.cpu < 0 ? "Unlimited CPU · Unlimited RAM" : `${lim.cpu}% CPU · ${lim.memMB} MB RAM`;
  const curPlan = PLAN_LIST.find((p) => p.id === u.rank);
  const curLimits = u.rank === "dev" ? { cpu: -1, memMB: -1 } : curPlan && curPlan.limits;

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Paids</h1><div class="sub">Upgrade your rank with a key. The clock only ticks while your bots run (ncb = Not Close Bot).</div></div>
      <span class="badge violet">${esc(u.rankName).toUpperCase()} RANK</span>
    </div>

    <div class="card" style="margin-bottom:22px">
      <div class="between" style="flex-wrap:wrap; gap:20px">
        <div>
          <div class="tiny">CURRENT RANK</div>
          <div style="font-size:26px; font-weight:820; color:${u.rankColor}; margin:4px 0">${esc(u.rankName)}</div>
          <div class="card-sub">${usage.bots} / ${usage.maxServers} servers used · ${usage.running} running${curLimits ? ` · your limit: ${limTxt(curLimits)}` : ""}</div>
        </div>
        <div style="min-width:240px; flex:1; max-width:420px">
          <div class="between" style="font-size:12.5px; color:var(--muted); margin-bottom:7px">
            <span>ncb time remaining</span>
            <b style="color:${u.rank === "free" ? "var(--muted)" : "var(--violet-2)"}">${u.rank === "free" ? "unlimited" : fmtDuration(u.ncbRemaining)}</b>
          </div>
          <div class="progress"><i style="width:${u.rank === "free" ? 100 : Math.max(2, Math.round((u.ncbRemaining / Math.max(1, usage.ncbTotal)) * 100))}%"></i></div>
          <div class="tiny" style="margin-top:8px">${mwUp ? "● KEY MIDDLEWARE ONLINE" : "○ KEY MIDDLEWARE OFFLINE — redeems will fail until it runs"}</div>
        </div>         <button class="btn primary" id="btnOpenKey">${ico("key")} Paid now</button>
      </div>
    </div>

    <div class="plans">
      ${(PLAN_LIST.length ? PLAN_LIST : []).map((p) => `
        <div class="plan ${p.id === u.rank ? "featured" : ""}">
          ${p.id === u.rank ? '<span class="tag badge violet">CURRENT</span>' : ""}
          <div class="pname" style="color:${p.color}">${esc(p.name)}</div>
          <div class="card-sub">${p.servers} server${p.servers > 1 ? "s" : ""} · ${p.days} days ncb</div>
          <div class="badge violet" style="margin:8px 0 2px">${p.limits ? esc(limTxt(p.limits)) : ""}</div>
          <div class="price">${p.price === 0 ? "฿0" : "฿" + p.price}<small>${p.price === 0 ? " forever" : " / rank"}</small></div>
          <ul>${p.perks.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
          <button class="btn ${p.id === "pro" ? "primary" : ""} block" onclick="openRedeem('${p.id}')">Paid now — ${esc(p.name)}</button>
        </div>`).join("")}
    </div>

    <div class="card" style="margin-top:22px">
      <div class="card-title" style="margin-bottom:8px">How redeeming works</div>
      <div class="card-sub" style="line-height:1.9">
        1. You pay and receive a long random key from Bytelater, e.g. <b class="mono">k7xm2q9fz4hd8w1-p3n8xk2m7qf9wd4-z8kq2m4fj7hd9x2</b><br>
        2. The key lives in the <b>middleware (ตัวกลาง)</b> — a private key server.<br>
        3. When you press <b>Redeem</b>, Vaxtor asks the middleware to check the key.<br>
        4. If it exists and is unused → your rank is granted instantly, and the key becomes UNLIVE.<br>
        5. When your ncb time runs out you drop back to <b>Free</b> — but you can redeem another key any time.
      </div>
    </div>`;

  $("btnOpenKey").onclick = () => openRedeem(null);
}

window.openRedeem = (preset) => {
  $("keyInput").value = "";
  $("keyResult").innerHTML = preset
    ? `<div class="tiny" style="text-align:center">SELECTED PLAN: <span style="color:#c4b5fd">${esc(preset.toUpperCase())}</span></div>`
    : "";
  $("modalKey").classList.add("show");
  setTimeout(() => $("keyInput").focus(), 80);
};

$("keyInput").addEventListener("input", (e) => {
  let v = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 48);
  const parts = v.match(/.{1,16}/g) || [];
  e.target.value = parts.join("-");
});

$("btnRedeem").onclick = async () => {
  const key = $("keyInput").value.trim();
  const box = $("keyResult");
  box.innerHTML = `<div class="tiny" style="text-align:center">CHECKING WITH MIDDLEWARE…</div>`;
  const r = await api.post("/api/keys/redeem", { key });
  if (!r.ok) {
    box.innerHTML = `<div class="auth-err show" style="margin:0">${esc(r.error)}</div>`;
    return;
  }
  box.innerHTML = `
    <div style="text-align:center; padding:16px; border-radius:14px; background:rgba(34,197,94,.1); border:1px solid rgba(34,197,94,.4)">
      <div style="display:flex; justify-content:center; color:#4ade80">${ico("checkCircle", 30)}</div>
      <div style="font-weight:800; font-size:18px; margin:6px 0">Rank unlocked: ${esc(r.rankName)}!</div>
      <div class="card-sub">${r.ncbRemaining != null ? fmtDuration(r.ncbRemaining) + " of ncb time added" : ""} · ${PLAN_LIST.find((p) => p.id === r.rank)?.servers ?? "?"} server slots</div>
    </div>`;
  if (typeof showSlider === "function") showSlider("Rank Activated", `${r.rankName} unlocked successfully`, "ok");
  else toast("Rank activated: " + r.rankName, "ok");
  ME.rank = r.rank; ME.rankName = r.rankName; ME.ncbRemaining = r.ncbRemaining;
  renderProfile();
  setTimeout(() => { closeModal("modalKey"); viewPaids(); }, 1600);
};

/* ---------------- SETTINGS ---------------- */

async function viewSettings() {
  const me = await api.get("/api/auth/me");
  ME = me.user; renderProfile();

  view.innerHTML = `
    <div class="page-head"><div><h1>Settings</h1><div class="sub">Your account, security and preferences.</div></div></div>

    <div class="grid" style="grid-template-columns:1fr 1fr; align-items:start">
      <div class="card">
        <div class="card-title" style="margin-bottom:16px">Profile</div>
        <div class="field"><label>Name</label><input class="input" id="setName" value="${esc(ME.name)}" /></div>
        <div class="field"><label>Email</label><input class="input" id="setEmail" value="${esc(ME.email)}" /></div>
        <div class="row" style="gap:10px; margin-top:6px">
          <span class="badge violet">${esc(ME.rankName).toUpperCase()}</span>
          <span class="badge">since ${new Date(ME.createdAt).toLocaleDateString()}</span>
        </div>
        <button class="btn primary" style="margin-top:18px" id="btnSaveProfile">Save changes</button>
      </div>

      <div class="card">
        <div class="card-title" style="margin-bottom:16px">Security</div>
        <div class="field"><label>Current password</label><input class="input" type="password" id="oldPass" autocomplete="current-password" /></div>
        <div class="field"><label>New password</label><input class="input" type="password" id="newPass" autocomplete="new-password" /></div>
        <div class="field"><label>Confirm new password</label><input class="input" type="password" id="newPass2" autocomplete="new-password" /></div>
        <button class="btn" style="margin-top:6px" id="btnPass">Change password</button>
      </div>

      <div class="card">
        <div class="card-title" style="margin-bottom:6px">Rank &amp; ncb</div>
        <div class="card-sub" style="margin-bottom:16px">ncb only counts while a bot is running — close it and the clock pauses.</div>
        <div class="between" style="margin-bottom:10px">
          <span class="card-sub">Current rank</span><b style="color:${ME.rankColor}">${esc(ME.rankName)}</b>
        </div>
        <div class="between" style="margin-bottom:10px">
          <span class="card-sub">ncb remaining</span><b>${ME.rank === "free" ? "unlimited" : fmtDuration(ME.ncbRemaining)}</b>
        </div>
        <div class="between" style="margin-bottom:16px">
          <span class="card-sub">Server slots</span><b>${ME.maxServers}</b>
        </div>         <a class="btn primary block" href="/Paids">${ico("gem")} Upgrade rank</a>
      </div>

      <div class="card" style="border-color:rgba(239,68,68,.3)">
        <div class="card-title" style="margin-bottom:6px; color:#fca5a5">Danger zone</div>
        <div class="card-sub" style="margin-bottom:16px">Signing out clears this device's session. Your bots keep running 24/7.</div>         <button class="btn danger block" id="btnSignout2">${ico("power")} Sign out of Vaxtor</button>
      </div>
    </div>`;

  $("btnSaveProfile").onclick = async () => {
    const r = await api.patch("/api/me", { name: $("setName").value.trim(), email: $("setEmail").value.trim() });
    if (!r.ok) return toast(r.error, "err");
    ME = r.user; renderProfile(); toast("Profile saved.", "ok");
  };
  $("btnPass").onclick = async () => {
    if ($("newPass").value !== $("newPass2").value) return toast("New passwords do not match.", "err");
    const r = await api.post("/api/me/password", { oldPassword: $("oldPass").value, newPassword: $("newPass").value });
    if (!r.ok) return toast(r.error, "err");
    toast("Password changed.", "ok");
    $("oldPass").value = $("newPass").value = $("newPass2").value = "";
  };
  $("btnSignout2").onclick = signout;
}

/* ---------------- BOT PAGES ---------------- */

function renderBotNav(bot, page) {
  const tabs = [
    ["overview", `${ico("overview")} Overview`],
    ["manage", `${ico("sliders")} Manage`],
    ["console", `${ico("terminal")} Console`],
    ["seted", `${ico("power")} Seted`],
  ];
  let head = document.querySelector(".main .page-head");
  head.innerHTML = `
    <div class="row menu-btn"><button class="btn icon" id="btnMenu">${ico("menu")}</button></div>
    <div></div>`;
  // reuse the page head slot: replace with bot header inside #view instead
  view.innerHTML = `
    <div class="page-head">
      <div>
        <div class="row" style="gap:10px; margin-bottom:6px">
          <a class="btn sm ghost" href="/Services">← Services</a>
          <span class="dot ${bot.status === "running" ? "green" : bot.status === "paused" || bot.status === "installing" ? "yellow" : ""}" data-stat-dot="${bot.id}"></span>
          <span class="badge ${bot.status === "running" ? "green" : bot.status === "paused" || bot.status === "installing" ? "amber" : ""}" data-stat-badge="${bot.id}">${bot.status.toUpperCase()}</span>
        </div>
        <h1>${esc(bot.name)}</h1>
      </div>
    </div>
    <div class="tabs">
      ${tabs.map(([id, label]) => `<button class="${page === id ? "active" : ""}" onclick="go('/Bot/${bot.id}/${id.replace(/^./, (c) => c.toUpperCase())}')">${label}</button>`).join("")}
    </div>
    <div id="botBody"></div>`;
}

function botBody() { return document.getElementById("botBody"); }

/* ---- bot overview ---- */
async function viewBotOverview(bot) {
  renderBotNav(bot, "overview");
  const d = await api.get("/api/bots/" + bot.id);
  const b = d.bot, body = botBody();

  body.innerHTML = `
    <div class="stat-grid">
      <div class="card stat"><div class="k">Status</div><div class="v" style="color:${b.status === "running" ? "var(--green)" : "var(--muted)"}; font-size:26px" data-stat-big="${b.id}">${b.status.toUpperCase()}</div><div class="d" data-stat-bigd="${b.id}">${b.status === "running" ? "up " + fmtUptime(b.uptimeMs) : "not running"}</div></div>
      <div class="card stat"><div class="k">Language</div><div class="v" style="font-size:24px">${esc(b.language)}</div><div class="d">${d.runCommand ? esc(d.runCommand.command + " " + d.runCommand.args.join(" ")) : "upload a project"}</div></div>
      <div class="card stat"><div class="k">Files</div><div class="v" data-stat-files="${b.id}">${b.fileCount}</div><div class="d">in project folder</div></div>
      <div class="card stat"><div class="k">Total runtime</div><div class="v">${fmtUptime(b.totalRuntimeMs)}</div><div class="d">all time</div></div>
    </div>

    <div class="grid" style="grid-template-columns:1fr 1fr">
      <div class="card">
        <div class="card-title" style="margin-bottom:14px">Quick controls</div>
        <div class="power">
          <button class="btn pw-start" data-act="start">${ico("play")} Start</button>
          <button class="btn pw-stop" data-act="stop">${ico("stop")} Stop</button>
        </div>
        <div class="card-sub" style="margin-top:14px">Full power controls (Shutdown / Kill) live in the <a href="/Bot/${bot.id}/Seted" style="color:#c4b5fd">Seted</a> page. Logs are in the <a href="/Bot/${bot.id}/Console" style="color:#c4b5fd">Console</a>.</div>
      </div>
      <div class="card">
        <div class="card-title" style="margin-bottom:14px">Setup checklist</div>
        <div style="display:grid; gap:11px">
          <div class="row"><span class="badge ${b.fileCount ? "green" : "amber"}">${b.fileCount ? "DONE" : "TODO"}</span><span class="card-sub">Project files uploaded</span></div>
          <div class="row"><span class="badge ${b.tokenSet ? "green" : "amber"}">${b.tokenSet ? "DONE" : "TODO"}</span><span class="card-sub">Bot token set</span></div>
          <div class="row"><span class="badge ${b.language && b.language !== "unknown" ? "green" : "amber"}">${b.language && b.language !== "unknown" ? "DONE" : "TODO"}</span><span class="card-sub">Language detected</span></div>
          <div class="row"><span class="badge ${b.status === "running" ? "green" : ""}">${b.status === "running" ? "DONE" : "—"}</span><span class="card-sub">Bot online 24/7</span></div>
        </div>
        <a class="btn primary block" style="margin-top:18px" href="/Bot/${bot.id}/Manage">${ico("sliders")} Open Manage</a>
      </div>
    </div>`;

  body.querySelectorAll("[data-act]").forEach((btn) => (btn.onclick = () => power(btn.dataset.act, bot.id)));
}

/* ---- bot manage: token, env, drag & drop project, files ---- */
async function viewManage(bot) {
  renderBotNav(bot, "manage");
  const d = await api.get("/api/bots/" + bot.id);
  const body = botBody();

  const files = d.files || [];
  const leakBanner = (d.leaks || []).length ? `
    <div class="card" style="margin-bottom:18px; border-color:rgba(239,68,68,.5); background:rgba(239,68,68,.06)">
      <div class="card-title" style="color:#fca5a5; margin-bottom:6px">${ico("shield")} Bot token found inside your code</div>
      <div class="card-sub">Take it out of the file and keep secrets in <span class="mono">.env</span> — save the token under Bot configuration once and Vaxtor writes <span class="mono">DISCORD_TOKEN</span> into <span class="mono">.env</span> automatically (click a file to open the editor).</div>
      <div style="margin-top:12px; display:flex; flex-wrap:wrap; gap:8px">
        ${d.leaks.map((l) => `<button class="badge red" data-open-leak="${esc(l.path)}" style="cursor:pointer; border:1px solid rgba(239,68,68,.5)">${ico("file", 12)} ${esc(l.path)} : line ${l.line}</button>`).join("")}
      </div>
    </div>` : "";

  body.innerHTML = leakBanner + `
    <div class="grid" style="grid-template-columns:1fr 1fr; align-items:start">
      <div class="card">
        <div class="card-title" style="margin-bottom:4px">${ico("sliders")} Bot configuration</div>
        <div class="card-sub" style="margin-bottom:16px">Token is injected as <span class="mono">DISCORD_TOKEN</span> and written to your project's <span class="mono">.env</span> <b>the moment you save</b> — no boot needed.</div>
        <div class="field"><label>Bot name</label><input class="input" id="mName" value="${esc(bot.name)}" /></div>
        <div class="field"><label>Discord bot token</label><input class="input mono" id="mToken" type="password" placeholder="MTA… your bot token" value="" /></div>
        <div class="field" style="margin-bottom:6px"><label>Run file — which file starts the bot?</label></div>
        <input class="input mono" id="mRunFile" list="runFiles" spellcheck="false" placeholder="Auto-detect — or type e.g. main.py" value="${esc(d.runFile || "")}" />
        <datalist id="runFiles">${files.map((f) => `<option value="${esc(f.path)}"></option>`).join("")}</datalist>
        <div class="env-note" style="margin:6px 0 4px">Type a path like <b>main.py</b> or <b>src/index.js</b> — Vaxtor runs that file with the matching runtime.</div>

        <div class="env-tabs">
          <button class="active" data-etab="rows">${ico("sliders", 13)} Variables</button>
          <button data-etab="raw">${ico("code", 13)} Raw .env</button>
        </div>
        <div id="envRows"></div>
        <textarea class="input mono" id="envRaw" style="display:none; min-height:130px" spellcheck="false" placeholder="DISCORD_TOKEN=…&#10;PREFIX=!"></textarea>
        <button class="btn primary" style="margin-top:16px" id="btnSaveBot">${ico("save")} Save configuration</button>
      </div>

      <div class="card">
        <div class="card-title" style="margin-bottom:4px">${ico("folder")} Project files</div>
        <div class="card-sub" style="margin-bottom:16px">Drag &amp; drop your <b>project folder</b> here — Vaxtor installs npm / pip dependencies on boot.</div>
        <div class="dropzone" id="dz">
          <div class="big-ico" style="color:#7c3aed">${ico("layers", 40)}</div>
          <div style="font-weight:700; margin:10px 0 4px">Drop your project folder</div>
          <div class="tiny">or click to select · node_modules &amp; .git are skipped</div>
          <input type="file" id="filePicker" webkitdirectory directory multiple style="display:none" />
        </div>
        <div id="uploadInfo" class="card-sub" style="margin-top:12px"></div>
        <hr class="sep">
        <div class="between" style="margin-bottom:10px">
          <div class="tiny">FILES (${files.length})</div>
          <span class="badge ${d.detected && d.detected !== "unknown" ? "green" : "amber"}">detected: ${esc(d.detected || "?")}</span>
        </div>
        <div class="files" id="fileList" style="max-height:340px; overflow:auto">
          ${files.map((f) => `
            <div class="file-row" data-path="${esc(f.path)}">
              ${ico("file")}
              <span class="f-path">${esc(f.path)}</span>
              <span class="f-meta">${fmtBytes(f.size)}</span>
              <span class="row-acts">
                <button class="icon-btn" data-edit-file="${esc(f.path)}" title="Edit file">${ico("pencil")}</button>
                <button class="icon-btn danger" data-del-file="${esc(f.path)}" title="Delete file">${ico("trash")}</button>
              </span>
            </div>`).join("") || `<div class="card-sub" style="padding:12px 0">No files yet.</div>`}
        </div>
      </div>
    </div>`;

  /* ---- env editor: named rows <-> raw .env ---- */
  let envObj = Object.assign({}, d.env || {});
  let envTab = "rows";

  function renderEnvRows() {
    const host = $("envRows");
    host.innerHTML = Object.entries(envObj).map(([k, v]) => `
      <div class="env-row">
        <input class="input mono env-k" spellcheck="false" placeholder="NAME" value="${esc(k)}" />
        <input class="input mono env-v" spellcheck="false" placeholder="value" value="${esc(v)}" />
        <button class="icon-btn danger env-del" title="Remove" type="button">${ico("close")}</button>
      </div>`).join("") + `<button class="env-add" id="envAdd" type="button">${ico("plus", 13)} Add variable</button>`;
    host.querySelectorAll(".env-del").forEach((b) => (b.onclick = () => {
      const key = b.closest(".env-row").querySelector(".env-k").value.trim();
      collectEnvRows();
      delete envObj[key];
      renderEnvRows();
    }));
    $("envAdd").onclick = () => {
      collectEnvRows();
      let n = 1;
      while (envObj["NEW_VAR_" + n] !== undefined) n++;
      envObj["NEW_VAR_" + n] = "";
      renderEnvRows();
      const rows = document.querySelectorAll("#envRows .env-row");
      const last = rows[rows.length - 1];
      if (last) { const inp = last.querySelector(".env-k"); inp.focus(); inp.select(); }
    };
  }
  function collectEnvRows() {
    const host = $("envRows");
    if (!host) return;
    const out = {};
    host.querySelectorAll(".env-row").forEach((row) => {
      const k = row.querySelector(".env-k").value.trim();
      if (k) out[k] = row.querySelector(".env-v").value;
    });
    envObj = out;
  }
  const envToRaw = () => Object.entries(envObj).map(([k, v]) => k + "=" + v).join("\n");
  function rawToEnv(text) {
    const out = {};
    for (const line of String(text || "").split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return out;
  }
  renderEnvRows();
  document.querySelectorAll("[data-etab]").forEach((btn) => (btn.onclick = () => {
    if (btn.dataset.etab === envTab) return;
    if (envTab === "rows") { collectEnvRows(); $("envRaw").value = envToRaw(); }
    else envObj = rawToEnv($("envRaw").value);
    envTab = btn.dataset.etab;
    document.querySelectorAll("[data-etab]").forEach((b) => b.classList.toggle("active", b === btn));
    $("envRows").style.display = envTab === "rows" ? "" : "none";
    $("envRaw").style.display = envTab === "raw" ? "" : "none";
  }));

  $("btnSaveBot").onclick = async () => {
    if (envTab === "rows") collectEnvRows(); else envObj = rawToEnv($("envRaw").value);
    const r = await api.patch("/api/bots/" + bot.id, {
      name: $("mName").value.trim(),
      token: $("mToken").value.trim() || undefined,
      env: envObj,
      runFile: $("mRunFile").value.trim(),
    });
    if (!r.ok) return toast(r.error, "err");
    const msg = r.envSaved ? "Configuration saved — .env written with your token & variables." : "Configuration saved.";
    if (typeof showSlider === "function") showSlider("Configuration Saved", msg, "ok");
    else toast(msg, "ok");
    if ($("mToken").value) $("mToken").value = "";
    viewManage(bot);
  };

  /* drag & drop */
  const dz = $("dz"), picker = $("filePicker");
  dz.onclick = () => picker.click();
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", (e) => uploadFileList(e.dataTransfer.files));
  picker.onchange = () => uploadFileList(picker.files);

  async function uploadFileList(fileList) {
    const info = $("uploadInfo");
    const arr = Array.from(fileList).slice(0, 500);
    if (!arr.length) return;
    info.textContent = `Reading ${arr.length} files…`;
    const payload = [];
    let failed = 0;
    for (const f of arr) {
      const rel = f.webkitRelativePath || f.name;
      if (rel.includes("node_modules") || rel.includes(".git/") || rel.includes("__pycache__") || f.size > 2 * 1024 * 1024) continue;
      try {
        const text = await f.text();
        payload.push({ path: rel.split("/").slice(1).join("/") || rel, content: text });
      } catch (_) { failed++; }
    }
    info.textContent = `Uploading ${payload.length} files…`;
    const r = await api.post("/api/bots/" + bot.id + "/files", { files: payload });
    if (!r.ok) { info.textContent = "Upload failed: " + r.error; return toast(r.error, "err"); }
    info.textContent = `${r.saved} file(s) uploaded · language: ${r.language}${r.errors.length ? " · " + r.errors.length + " skipped" : ""}`;
    if (r.warnings && r.warnings.length) {
      toast(`Security: token found in ${r.warnings[0].path} (line ${r.warnings[0].line}) — remove it and use .env instead.`, "err");
      info.innerHTML += `<div style="color:#fca5a5; margin-top:6px">${ico("shield", 12)} Token-like secret in ${r.warnings.map((w) => esc(w.path) + ":" + w.line).join(", ")} — move it to .env.</div>`;
    }
    toast(`${r.saved} files uploaded. Detected: ${r.language}`, "ok");
    viewManage(bot);
  }

  /* file actions: click row / pencil = edit in code editor, trash = delete */
  $("fileList").querySelectorAll(".file-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("[data-del-file]")) return;
      openCodeEditor(bot.id, row.dataset.path);
    });
  });
  $("fileList").querySelectorAll("[data-del-file]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const p = btn.getAttribute("data-del-file");
      if (!confirm(`Delete ${p}? This cannot be undone.`)) return;
      const r = await api.del(`/api/bots/${bot.id}/file?path=${encodeURIComponent(p)}`);
      if (!r.ok) return toast(r.error, "err");
      toast("File deleted.", "ok");
      viewManage(bot);
    });
  });

  body.querySelectorAll("[data-open-leak]").forEach((btn) => {
    btn.addEventListener("click", () => openCodeEditor(bot.id, btn.getAttribute("data-open-leak")));
  });
}


/* ---------------- code editor (syntax highlighted) ---------------- */

const LANGS = {
  py: { name: "python", kw: "def return if elif else for while class import from as try except finally with lambda None True False and or not in is pass break continue global nonlocal yield raise assert del async await self" },
  js: { name: "javascript", kw: "const let var function return if else for while class new import from export default async await try catch finally throw typeof of in break continue switch case default null undefined true false this super extends yield delete void instanceof do static get set" },
  ts: { name: "typescript", kw: "const let var function return if else for while class new import from export default async await try catch finally throw typeof of in break continue switch case default null undefined true false this super extends yield delete void instanceof do static get set interface type enum implements readonly private public" },
  json: { name: "json", kw: "true false null" },
  sh: { name: "shell", kw: "if then else fi for while do done function echo export local return set exit cd mkdir rm pip npm node python python3 install start true false" },
  env: { name: "env", kw: "true false" },
  css: { name: "css", kw: "important inherit initial unset none auto block flex grid absolute relative fixed sticky center transparent" },
  html: { name: "html", kw: "div span script style link meta input button a head body html template" },
  md: { name: "markdown", kw: "true false" },
};

function langFor(path) {
  const ext = (String(path).split(".").pop() || "").toLowerCase();
  return LANGS[ext] ? ext : (/^(mjs|cjs|jsx)$/.test(ext) ? "js" : "js");
}

function highlightCode(code, lang) {
  const def = LANGS[lang] || LANGS.js;
  const kw = def.kw.split(" ").join("|");
  const src = esc(code);
  const rx = new RegExp(
    "(&quot;(?:[^&\\\\\n]|\\\\.|&(?!quot;))*&quot;|&#39;(?:[^&\\\\\n]|\\\\.|&(?!#39;))*&#39;|`(?:[^`\\\\]|\\\\.)*`)" +
    "|(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/|#[^\\n]*|&lt;!--[\\s\\S]*?--&gt;)" +
    "|\\b(\\d+(?:\\.\\d+)?)\\b" +
    "|\\b(" + kw + ")\\b" +
    "|([A-Za-z_$][\\w$]*)(?=\\s*\\()",
    "g"
  );
  return src.replace(rx, (m, s, c, n, k, f) => {
    if (s) return `<span class="tok-s">${s}</span>`;
    if (c) return `<span class="tok-c">${c}</span>`;
    if (n) return `<span class="tok-n">${n}</span>`;
    if (k) return `<span class="tok-k">${k}</span>`;
    if (f) return `<span class="tok-f">${f}</span>`;
    return m;
  });
}

function openCodeEditor(botId, path) {
  document.querySelectorAll(".ed-overlay").forEach((o) => o.remove());
  const lang = langFor(path);
  const overlay = document.createElement("div");
  overlay.className = "ed-overlay";
  overlay.innerHTML = `
    <div class="ed-shell">
      <div class="ed-head">
        <div class="ed-dots"><i></i><i></i><i></i></div>
        <span class="ed-path">${esc(path)}</span>
        <span class="ed-lang">${esc(LANGS[lang].name)}</span>
        <div style="margin-left:auto" class="row">
          <button class="btn sm" id="edClose">${ico("close")} Close</button>
          <button class="btn sm primary" id="edSave">${ico("save")} Save</button>
        </div>
      </div>
      <div class="ed-body">
        <div class="ed-gutter" id="edGutter"></div>
        <div class="ed-scroll" id="edScroll">
          <pre class="ed-pre" id="edPre"></pre>
          <textarea class="ed-ta" id="edTa" spellcheck="false" wrap="off"></textarea>
        </div>
      </div>
      <div class="ed-foot">
        <span><span class="k">Ctrl+S</span> save</span>
        <span><span class="k">Esc</span> close</span>
        <span id="edStats">Ln 1, Col 1</span>
        <span class="ed-msg" id="edMsg"></span>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const $s = (id) => overlay.querySelector("#" + id);
  const ta = $s("edTa"), pre = $s("edPre"), gutter = $s("edGutter"), scroll = $s("edScroll");

  function paint() {
    const v = ta.value;
    pre.innerHTML = (v.length < 400000 ? highlightCode(v, lang) : esc(v)) + "\n";
    ta.style.height = pre.offsetHeight + "px";
    const lines = v.split("\n").length;
    let g = "";
    for (let i = 1; i <= lines; i++) g += i + "\n";
    gutter.textContent = g;
  }
  function stats() {
    const upto = ta.value.slice(0, ta.selectionStart).split("\n");
    $s("edStats").textContent = `Ln ${upto.length}, Col ${upto[upto.length - 1].length + 1}`;
  }
  function syncScroll() { gutter.scrollTop = scroll.scrollTop; }

  scroll.addEventListener("scroll", syncScroll, { passive: true });
  ta.addEventListener("input", () => { paint(); stats(); $("edMsg") && ($s("edMsg").textContent = ""); });
  ["click", "keyup", "select"].forEach((ev) => ta.addEventListener(ev, stats));
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const s = ta.selectionStart;
      ta.setRangeText("  ", s, ta.selectionEnd, "end");
      paint(); stats();
    }
    if (e.key === "s" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doSave(); }
    if (e.key === "Escape") close();
  });

  async function doSave() {
    const r = await api.put(`/api/bots/${botId}/file`, { path, content: ta.value });
    if (!r.ok) return toast(r.error, "err");
    $s("edMsg").textContent = "saved · " + new Date().toLocaleTimeString("en-GB", { hour12: false });
    if (r.warning) toast(`Token-like secret in ${r.warning.path} (line ${r.warning.line}) — remove it and keep it in .env instead.`, "err");
  }
  function close() { overlay.remove(); document.removeEventListener("keydown", onEsc); }
  function onEsc(e) { if (e.key === "Escape") close(); }

  $s("edClose").onclick = close;
  $s("edSave").onclick = doSave;
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onEsc);

  api.get(`/api/bots/${botId}/file?path=${encodeURIComponent(path)}`).then((r) => {
    if (!r.ok) { toast(r.error, "err"); return close(); }
    ta.value = r.content || "";
    paint(); stats();
    ta.focus();
    ta.setSelectionRange(0, 0);
  });
}

/* ---- bot console: live logs ---- */
async function viewConsole(bot) {
  renderBotNav(bot, "console");
  const body = botBody();
  body.innerHTML = `
    <div class="console">
      <div class="console-head">
        <span class="dot ${bot.status === "running" ? "green" : ""}" id="cDot"></span>
        <b style="font-size:13.5px">${esc(bot.name)}</b>
        <span class="badge" id="cStatus">${esc(bot.status)}</span>
        <span class="badge" id="cCpu" title="CPU usage of the bot process">CPU —</span>
        <span class="badge" id="cMem" title="Memory (RSS) of the bot process">MEM —</span>
        <div style="margin-left:auto" class="row">
          <button class="btn sm" id="cClear">Clear</button>
          <button class="btn sm primary" id="cStart">${ico("play")} Start</button>
        </div>
      </div>
      <div class="console-body" id="cBody"></div>
      <div class="console-input">
        <span class="mono" style="color:var(--violet-2)">❯</span>
        <input id="cInput" placeholder="send stdin to the bot process… (Enter)" autocomplete="off" />
      </div>
    </div>
    <div class="card-sub" style="margin-top:12px">Console streams live over WebSocket. Dependencies (npm install / pip install) run automatically on boot.</div>`;

  const cBody = $("cBody");
  const addLine = (entry) => {
    const div = document.createElement("div");
    div.className = "l " + (entry.stream || "out");
    const src = ["npm", "pip", "install"].includes(entry.stream) ? `<span class="src">${esc(entry.stream)}</span>` : "";
    div.innerHTML = `<span class="ts">${esc(entry.stamp)}</span>${src}<span class="msg">${esc(entry.line)}</span>`;
    cBody.appendChild(div);
    while (cBody.children.length > 900) cBody.removeChild(cBody.firstChild);
    cBody.scrollTop = cBody.scrollHeight;
  };

  $("cClear").onclick = () => (cBody.innerHTML = "");
  $("cStart").onclick = () => power("start", bot.id);

  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws/console?bot=${bot.id}`);
  currentWS = ws;
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "backlog") { cBody.innerHTML = ""; msg.logs.forEach(addLine); }
      else if (msg.type === "log") addLine(msg.entry);
    } catch (_) {}
  };
  ws.onopen = () => { const s = $("cStatus"); if (s) s.textContent = "connected"; };
  ws.onclose = () => { const s = $("cStatus"); if (s) s.textContent = "disconnected"; };
  ws.onerror = () => toast("Console WebSocket error", "err");

  $("cInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "stdin", data: e.target.value }));
      addLine({ stamp: new Date().toLocaleTimeString("en-GB", { hour12: false }), stream: "sys", line: "❯ " + e.target.value });
      e.target.value = "";
    }
  });

  // refresh status + CPU/MEM periodically
  clearInterval(window.__cPoll);
  const pollConsole = async () => {
    if (location.pathname.indexOf(bot.id) === -1 || location.pathname.toLowerCase().indexOf("console") === -1) return clearInterval(window.__cPoll);
    const r = await api.get("/api/bots/" + bot.id + "/status");
    if (r.ok && $("cStatus")) {
      $("cStatus").textContent = r.status.status;
      $("cDot").className = "dot " + (r.status.status === "running" ? "green" : r.status.status === "paused" ? "yellow" : "");
    }
    const m = await api.get("/api/bots/" + bot.id + "/metrics");
    if (m.ok && m.metrics && $("cCpu")) {
      const lim = m.limits || {};
      $("cCpu").textContent = "CPU " + m.metrics.cpuPercent + "%";
      $("cMem").textContent = "MEM " + (m.metrics.memMB >= 1024 ? (m.metrics.memMB / 1024).toFixed(1) + " GB" : m.metrics.memMB + " MB");
      $("cCpu").style.color = lim.cpu > 0 && m.metrics.cpuPercent > lim.cpu ? "#fca5a5" : "";
      $("cMem").style.color = lim.memMB > 0 && m.metrics.memMB > lim.memMB ? "#fca5a5" : "";
    }
  };
  pollConsole();
  window.__cPoll = setInterval(pollConsole, 4000);
}

/* ---- bot seted: power controls ---- */
async function viewSeted(bot) {
  renderBotNav(bot, "seted");
  const d = await api.get("/api/bots/" + bot.id);
  const b = d.bot;
  const body = botBody();

  body.innerHTML = `
    <div class="card" style="margin-bottom:18px">
      <div class="between" style="flex-wrap:wrap; gap:16px">
        <div>
          <div class="tiny">SYSTEM STATUS</div>
          <div style="font-size:24px; font-weight:820; margin-top:6px; color:${b.status === "running" ? "var(--green)" : b.status === "paused" ? "#fde047" : "var(--muted)"}" data-stat-big="${b.id}">${b.status.toUpperCase()}</div>
          <div class="card-sub" data-stat-bigd="${b.id}">${b.status === "running" ? "uptime " + fmtUptime(b.uptimeMs) : b.status === "paused" ? "on standby — not running" : b.lastError ? "last error: " + esc(b.lastError) : "bot is offline"}</div>
        </div>
        <div class="row" style="gap:22px; flex-wrap:wrap">
          <div><div class="tiny">CPU</div><b class="mono" id="stCpu">—</b></div>
          <div><div class="tiny">MEMORY</div><b class="mono" id="stMem">—</b></div>
          <div><div class="tiny">PLAN LIMIT</div><b class="mono" id="stLimit">—</b></div>
          <div><div class="tiny">RUNTIME</div><b class="mono">${esc(b.language)}</b></div>
          <div><div class="tiny">TOTAL RUN</div><b class="mono">${fmtUptime(b.totalRuntimeMs)}</b></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title" style="margin-bottom:4px">Power</div>
      <div class="card-sub" style="margin-bottom:16px"><b>Stop</b> pauses the bot — it stays on standby, press Start to resume. <b>Shutdown</b> closes it normally. <b>Kill bot</b> is a reset: it stops the process and deletes ALL project files so you can start fresh.</div>
      <div class="power">          <button class="btn pw-start" data-act="start">${ico("play")} Start</button>
          <button class="btn pw-stop" data-act="stop">${ico("stop")} Stop</button>
          <button class="btn pw-shutdown" data-act="shutdown">${ico("powerOff")} Shutdown</button>
          <button class="btn pw-kill" data-act="kill">${ico("kill")} Kill bot</button>
      </div>
      <hr class="sep">
      <div class="between" style="flex-wrap:wrap; gap:14px">
        <div class="card-sub">Danger: deleting this bot removes its files forever.</div>
        <button class="btn danger" id="btnDelBot">${ico("trash")} Delete this bot</button>
      </div>
    </div>

    <div class="card" style="margin-top:18px">
      <div class="between" style="flex-wrap:wrap; gap:12px; margin-bottom:16px">
        <div>
          <div class="card-title" style="margin-bottom:4px">Performance</div>
          <div class="card-sub">Real-time CPU & Memory usage</div>
        </div>
        <div class="row" style="flex-wrap:wrap; gap:6px" id="perfRange">
          <button class="btn sm" data-range="1s">1s</button>
          <button class="btn sm" data-range="5s">5s</button>
          <button class="btn sm" data-range="30s">30s</button>
          <button class="btn sm active" data-range="1m">1m</button>
          <button class="btn sm" data-range="5m">5m</button>
          <button class="btn sm" data-range="10m">10m</button>
          <button class="btn sm" data-range="15m">15m</button>
          <button class="btn sm" data-range="20m">20m</button>
          <button class="btn sm" data-range="30m">30m</button>
          <button class="btn sm" data-range="1h">1h</button>
          <button class="btn sm" data-range="2h">2h</button>
          <button class="btn sm" data-range="5h">5h</button>
          <button class="btn sm" data-range="1d">1d</button>
        </div>
      </div>
      <canvas id="perfChart" height="220" style="width:100%;max-width:100%"></canvas>
      <div class="row" style="gap:16px; margin-top:12px; flex-wrap:wrap">
        <div class="row" style="gap:8px"><span style="width:10px;height:10px;border-radius:50%;background:#22c55e"></span><span class="tiny">CPU</span></div>
        <div class="row" style="gap:8px"><span style="width:10px;height:10px;border-radius:50%;background:#a855f7"></span><span class="tiny">MEMORY</span></div>
      </div>
    </div>`;

  body.querySelectorAll("[data-act]").forEach((btn) => (btn.onclick = () => {
    if (btn.dataset.act === "kill") {
      const sure = confirm(`KILL BOT = RESET\n\nThis stops the bot AND deletes ALL of its project files — a completely fresh start.\nSettings (name / token / .env) are kept.\n\nWipe all files and reset?`);
      if (!sure) return;
      power("kill", bot.id).then(() => go(`/Bot/${bot.id}/Manage`));
      return;
    }
    power(btn.dataset.act, bot.id);
  }));
  $("btnDelBot").onclick = async () => {
    if (!confirm(`Delete bot "${bot.name}" and all its files? This cannot be undone.`)) return;
    const r = await api.del("/api/bots/" + bot.id);
    if (!r.ok) return toast(r.error, "err");
    toast("Bot deleted.", "ok");
    go("/Services");
    refreshBots();
  };

  /* live CPU / memory / plan limit meter */
  clearInterval(window.__sPoll);
  clearInterval(window.__pPoll);
  let currentRange = "1m";
  const perfRange = document.getElementById("perfRange");
  if (perfRange) {
    perfRange.querySelectorAll("button").forEach((btn) => {
      btn.onclick = () => {
        perfRange.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentRange = btn.dataset.range;
        loadPerf();
      };
    });
  }
  const loadPerf = async () => {
    const canvas = document.getElementById("perfChart");
    if (!canvas || location.pathname.indexOf(bot.id) === -1) return;
    const r = await api.get(`/api/bots/${bot.id}/metrics/history?range=${currentRange}`);
    if (!r.ok || !r.history) return;
    const hist = r.history;
    const ctx = canvas.getContext("2d");
    const w = canvas.width = canvas.clientWidth * 2;
    const h = canvas.height = 440;
    ctx.clearRect(0,0,w,h);
    if (!hist.length) return;
    const maxCpu = Math.max(10, ...hist.map((p) => p.cpu || 0));
    const maxMem = Math.max(10, ...hist.map((p) => p.mem || 0));
    const step = w / Math.max(1, hist.length - 1);
    const drawLine = (key, color, max) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      hist.forEach((p, i) => {
        const x = i * step;
        const val = p[key] || 0;
        const y = h - (val / max) * (h - 40) - 20;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.shadowBlur = 0;
    };
    drawLine("cpu", "#22c55e", maxCpu);
    drawLine("mem", "#a855f7", maxMem);
  };
  const pollMetrics = async () => {
    const cpuEl = $("stCpu");
    if (!cpuEl || location.pathname.indexOf(bot.id) === -1) { clearInterval(window.__sPoll); clearInterval(window.__pPoll); return; }
    const m = await api.get(`/api/bots/${bot.id}/metrics`);
    if (!m.ok || !m.metrics || !$("stCpu")) return;
    const { cpuPercent, memMB } = m.metrics;
    const lim = m.limits || {};
    const heat = (v, limit) => limit < 0 ? "#86efac" : v > limit ? "#fca5a5" : v > limit * 0.8 ? "#fde047" : "#86efac";
    $("stCpu").textContent = lim.cpu < 0 ? `${cpuPercent}% (∞)` : `${cpuPercent}% / ${lim.cpu}%`;
    $("stMem").textContent = lim.memMB < 0 ? `${memMB} MB (∞)` : `${memMB} MB / ${lim.memMB} MB`;
    $("stCpu").style.color = heat(cpuPercent, lim.cpu);
    $("stMem").style.color = heat(memMB, lim.memMB);
    const sl = $("stLimit");
    if (sl) { sl.textContent = lim.cpu < 0 ? "UNLIMITED" : `${lim.cpu}% CPU · ${lim.memMB} MB`; sl.style.color = lim.cpu < 0 ? "#22d3ee" : ""; }
  };
  pollMetrics();
  loadPerf();
  window.__sPoll = setInterval(pollMetrics, 2000);
  window.__pPoll = setInterval(loadPerf, 1000);
}

/* ---------------- power actions ---------------- */

async function power(act, botId) {
  const labels = { start: "Starting", stop: "Pausing (standby)", shutdown: "Shutting down", kill: "Killing + wiping files" };
  toast(labels[act] + "…");
  const r = await api.post(`/api/bots/${botId}/${act}`);
  if (!r.ok) return toast(r.error, "err");
  const okMsg = labels[act].replace("…", "") + " ✓";
  if (typeof showSlider === "function") showSlider(act === "start" ? "Bot Started" : act === "stop" ? "Bot Paused" : act === "shutdown" ? "Bot Shutdown" : "Bot Reset", okMsg, "ok");
  else toast(okMsg, "ok");
  await refreshBots();
  const here = location.pathname.toLowerCase();
  if (here.includes("/console")) { /* keep console open */ }
  else if (here.includes("/seted")) viewSeted(BOTS.find((b) => b.id === botId));
  else if (here.includes("/overview")) viewBotOverview(BOTS.find((b) => b.id === botId));
}

/* ---------------- signout ---------------- */

async function signout() {
  await api.post("/api/auth/logout");
  location.href = "/auth";
}
$("btnSignout").onclick = signout;

/* ---------------- mobile menu ---------------- */

const openSidebar = () => { $("sidebar")?.classList.add("open"); $("scrim")?.classList.add("show"); document.body.style.overflow = "hidden"; };
const closeSidebar = () => { $("sidebar")?.classList.remove("open"); $("scrim")?.classList.remove("show"); document.body.style.overflow = ""; };
$("btnMenu") && ($("btnMenu").onclick = (e) => { e.stopPropagation(); openSidebar(); });
$("scrim").onclick = closeSidebar;
document.addEventListener("click", (e) => {
  const b = e.target.closest("#btnMenu");
  if (b) { e.stopPropagation(); openSidebar(); return; }
  const sidebar = $("sidebar");
  if (window.innerWidth <= 1020 && sidebar && sidebar.classList.contains("open")) {
    if (!sidebar.contains(e.target) && !b) {
      closeSidebar();
    }
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSidebar();
});

boot();
