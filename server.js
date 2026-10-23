"use strict";
/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║   VAXTOR — Discord Bot Hosting Platform                  ║
 * ║   By Bytelater.                                          ║
 * ║   node server.js     ->  http://localhost:3000            ║
 * ║   node keyserver.js  ->  http://localhost:3200 (ตัวกลาง)  ║
 * ╚═══════════════════════════════════════════════════════════╝
 */
const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const store = require("./server/lib/store");
const auth = require("./server/lib/auth");
const files = require("./server/lib/files");
const plans = require("./server/lib/plans");
const mw = require("./server/lib/keymiddleware");
const runner = require("./server/botrunner");

const PORT = Number(process.env.PORT) || 3000;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const ROOT = __dirname;

/* ---------------- config bootstrap ---------------- */

function loadConfig() {
  const file = path.join(store.DATA_DIR, "config.json");
  let cfg = {};
  if (fs.existsSync(file)) { try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) {} }
  let created = false;
  if (!cfg.adminPassword) { cfg.adminPassword = "bytelater"; created = true; } // changeable in Settings
  if (!cfg.keySecret) { cfg.keySecret = crypto.randomBytes(24).toString("hex"); created = true; }
  if (!cfg.discord) cfg.discord = { clientId: "", clientSecret: "" };
  if (created) fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  return { cfg, file };
}
const { cfg: CONFIG, file: CONFIG_FILE } = loadConfig();
function saveConfig() { fs.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG, null, 2)); }

/* ---------------- express app ---------------- */

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true }));

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Attach req.user when a valid session cookie exists. */
function session(req) {
  const token = parseCookies(req).vx_session;
  if (!token) return null;
  const s = auth.getSession(token);
  if (!s) return null;
  if (s.user.banned) { auth.destroySession(token); return null; }
  return s;
}
function requireUser(req, res, next) {
  const s = session(req);
  if (!s) return res.status(401).json({ ok: false, error: "Not signed in." });
  req.session = s;
  req.user = s.user;
  next();
}

function adminAuth(req) {
  const token = parseCookies(req).vx_admin;
  if (!token) return false;
  if (!global.__adminTokens) global.__adminTokens = new Set();
  return global.__adminTokens.has(token);
}
function requireAdmin(req, res, next) {
  if (!adminAuth(req)) return res.status(401).json({ ok: false, error: "Dev panel: sign in first." });
  next();
}

function publicUser(u) {
  return {
    id: u.id, name: u.name, email: u.email, createdAt: u.createdAt,
    rank: u.rank, rankName: plans.plan(u.rank).name, rankColor: plans.plan(u.rank).color,
    ncbRemaining: u.ncbRemaining || 0,
    ncbTotal: plans.rankSeconds(u.rank),
    maxServers: plans.maxServers(u.rank),
    usageByDay: u.usageByDay || {},
    discordId: u.discordId || null,
    lastLoginAt: u.lastLoginAt || null,
    isAdmin: !!u.isAdmin,
  };
}

function botDirOf(bot) { return files.botDir(bot.ownerId, bot.id); }

function publicBot(bot) {
  const st = runner.status(bot.id);
  return {
    id: bot.id, name: bot.name, language: bot.language || "unknown",
    status: st.status, uptimeMs: st.uptimeMs, startedAt: st.startedAt,
    installing: st.installting || st.installing, exitCode: st.exitCode, lastError: st.lastError,
    createdAt: bot.createdAt, fileCount: (bot.files || []).length,
    tokenSet: !!bot.token, totalRuntimeMs: bot.totalRuntimeMs || 0, usageByDay: bot.usageByDay || {},
  };
}

function getBotForUser(id, user) {
  const db = store.get();
  const bot = db.bots[id];
  if (!bot) return null;
  if (user && user.isAdmin) return bot;
  if (user && bot.ownerId === user.id) return bot;
  // Allow access to running bots regardless of account switch
  if (runner && runner.isRunning && runner.isRunning(bot.id)) return bot;
  return null;
}

/* ---- security scan: bot-token-looking secrets inside project code ---- */
const TOKEN_RX = /\b[A-Za-z0-9_-]{20,40}\.[A-Za-z0-9_-]{5,12}\.[A-Za-z0-9_-]{20,120}\b/;
function scanContent(content) {
  const lines = String(content ?? "").split("\n");
  for (let i = 0; i < lines.length && i < 5000; i++) if (TOKEN_RX.test(lines[i])) return i + 1;
  return null;
}
function scanBotFiles(dir) {
  const leaks = [];
  let budget = 6 * 1024 * 1024;
  for (const f of files.listFiles(dir)) {
    if (leaks.length >= 8) break;
    if (/(^|\/)\.env(\.|$|\/)/i.test(f.path)) continue; // .env is the RIGHT place for the token
    if (!/\.(js|jsx|ts|mjs|cjs|py|json|txt|yml|yaml|cfg|ini|md|sh|toml)$/i.test(f.path)) continue;
    if (f.size <= 0 || f.size > budget) continue;
    budget -= f.size;
    try {
      const line = scanContent(files.readFile(dir, f.path));
      if (line) leaks.push({ path: f.path, line });
    } catch (_) {}
  }
  return leaks;
}

function countBots(userId) {
  const db = store.get();
  return Object.values(db.bots).filter((b) => b.ownerId === userId).length;
}

/* ---------------- health ---------------- */
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "vaxtor", version: "1.0.0", uptime: process.uptime() });
});

/* ---------------- AUTH ---------------- */

app.post("/api/auth/register", (req, res) => {
  const { name, email, password, confirmPassword } = req.body || {};
  if (!name || !/^[a-zA-Z0-9_\-.]{3,24}$/.test(name)) return res.status(400).json({ ok: false, error: "Name must be 3-24 chars (letters, numbers, _ - .)" });
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ ok: false, error: "Email is not valid." });
  if (!password || password.length < 6) return res.status(400).json({ ok: false, error: "Password must be at least 6 characters." });
  if (confirmPassword !== undefined && confirmPassword !== password) return res.status(400).json({ ok: false, error: "Passwords do not match." });

  const db = store.get();
  const exists = Object.values(db.users).some((u) => u.email.toLowerCase() === email.toLowerCase() || u.name.toLowerCase() === name.toLowerCase());
  if (exists) return res.status(409).json({ ok: false, error: "That name or email is already registered." });

  const id = crypto.randomBytes(8).toString("hex");
  const user = {
    id, name, email,
    password: auth.hashPassword(password),
    createdAt: Date.now(),
    rank: "free",
    ncbRemaining: plans.rankSeconds("free"),
    usageByDay: {},
    banned: false,
    paidKeys: [], // keys this user redeemed (for revoke on key delete)
  };
  db.users[id] = user;
  store.save();
  store.audit("user.register", `${name} <${email}>`);

  const token = auth.createSession(id);
  res.setHeader("Set-Cookie", `vx_session=${token}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`);
  res.json({ ok: true, user: publicUser(user) });
});

app.post("/api/auth/login", (req, res) => {
  const { id: identifier, password } = req.body || {};
  if (!identifier || !password) return res.status(400).json({ ok: false, error: "Enter your name/email and password." });
  const db = store.get();
  const user = Object.values(db.users).find((u) => u.name.toLowerCase() === String(identifier).toLowerCase() || u.email.toLowerCase() === String(identifier).toLowerCase());
  if (!user || !auth.verifyPassword(password, user.password)) return res.status(401).json({ ok: false, error: "Wrong name/email or password." });
  if (user.banned) return res.status(403).json({ ok: false, error: "This account is banned from Vaxtor." });

  user.lastLoginAt = Date.now();
  store.save();
  const token = auth.createSession(user.id);
  res.setHeader("Set-Cookie", `vx_session=${token}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`);
  res.json({ ok: true, user: publicUser(user) });
});

app.post("/api/auth/logout", (req, res) => {
  const token = parseCookies(req).vx_session;
  if (token) auth.destroySession(token);
  res.setHeader("Set-Cookie", "vx_session=; HttpOnly; Path=/; Max-Age=0");
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  const s = session(req);
  if (!s) return res.json({ ok: false, user: null });
  res.json({ ok: true, user: publicUser(s.user) });
});

/* ---- Discord OAuth (optional: set discord.clientId/clientSecret in data/config.json) ---- */

app.get("/api/auth/discord", (req, res) => {
  if (!CONFIG.discord.clientId || !CONFIG.discord.clientSecret) {
    return res.status(501).json({ ok: false, error: "Discord login is not configured yet. Set discord.clientId and discord.clientSecret in data/config.json." });
  }
  const state = crypto.randomBytes(12).toString("hex");
  if (!global.__oauthStates) global.__oauthStates = new Map();
  global.__oauthStates.set(state, Date.now());
  const params = new URLSearchParams({
    client_id: CONFIG.discord.clientId,
    redirect_uri: APP_URL + "/api/auth/discord/callback",
    response_type: "code",
    scope: "identify email",
    state,
  });
  res.redirect("https://discord.com/oauth2/authorize?" + params.toString());
});

app.get("/api/auth/discord/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!global.__oauthStates || !global.__oauthStates.has(String(state))) return res.redirect("/auth.html?error=bad-state");
  global.__oauthStates.delete(String(state));
  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CONFIG.discord.clientId,
        client_secret: CONFIG.discord.clientSecret,
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: APP_URL + "/api/auth/discord/callback",
      }),
    });
    const tok = await tokenRes.json();
    if (!tok.access_token) return res.redirect("/auth.html?error=discord-token");
    const meRes = await fetch("https://discord.com/api/users/@me", { headers: { Authorization: "Bearer " + tok.access_token } });
    const duser = await meRes.json();

    const db = store.get();
    let user = Object.values(db.users).find((u) => u.discordId === duser.id);
    if (!user) {
      const base = (duser.global_name || duser.username || "discord_user").replace(/[^a-zA-Z0-9_\-.]/g, "").slice(0, 20) || "discord_user";
      let name = base; let n = 1;
      while (Object.values(db.users).some((u) => u.name.toLowerCase() === name.toLowerCase())) name = base + n++;
      const id = crypto.randomBytes(8).toString("hex");
      user = {
        id, name,
        email: duser.email || `${duser.id}@discord.local`,
        password: null, discordId: duser.id,
        createdAt: Date.now(), rank: "free",
        ncbRemaining: plans.rankSeconds("free"),
        usageByDay: {}, banned: false, paidKeys: [],
      };
      db.users[id] = user;
      store.audit("user.discord", `Discord @${duser.username} -> ${name}`);
    }
    user.lastLoginAt = Date.now();
    store.save();
    const token = auth.createSession(user.id);
    res.setHeader("Set-Cookie", `vx_session=${token}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`);
    res.redirect("/Overview");
  } catch (e) {
    res.redirect("/auth.html?error=discord-failed");
  }
});

/* ---------------- PROFILE ---------------- */

app.patch("/api/me", requireUser, (req, res) => {
  const { name, email } = req.body || {};
  const db = store.get();
  if (name !== undefined) {
    if (!/^[a-zA-Z0-9_\-.]{3,24}$/.test(name)) return res.status(400).json({ ok: false, error: "Name must be 3-24 chars." });
    if (Object.values(db.users).some((u) => u.id !== req.user.id && u.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ ok: false, error: "Name already taken." });
    req.user.name = name;
  }
  if (email !== undefined) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ ok: false, error: "Email is not valid." });
    if (Object.values(db.users).some((u) => u.id !== req.user.id && u.email.toLowerCase() === email.toLowerCase())) return res.status(409).json({ ok: false, error: "Email already used." });
    req.user.email = email;
  }
  store.save();
  res.json({ ok: true, user: publicUser(req.user) });
});

app.post("/api/me/password", requireUser, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!auth.verifyPassword(oldPassword || "", req.user.password)) return res.status(401).json({ ok: false, error: "Current password is wrong." });
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ ok: false, error: "New password must be at least 6 characters." });
  req.user.password = auth.hashPassword(newPassword);
  store.save();
  res.json({ ok: true });
});

/* ---------------- PLANS & KEYS ---------------- */

app.get("/api/plans", (req, res) => {
  res.json({ ok: true, plans: plans.publicPlans(), middlewareUp: true });
});

app.get("/api/plans/status", requireUser, async (req, res) => {
  const health = await mw.health();
  const db = store.get();
  const bots = Object.values(db.bots).filter((b) => b.ownerId === req.user.id);
  const running = bots.filter((b) => runner.isRunning(b.id)).length;
  res.json({
    ok: true,
    plans: plans.publicPlans(),
    user: publicUser(req.user),
    usage: {
      bots: bots.length,
      running,
      maxServers: plans.maxServers(req.user.rank),
      ncbRemaining: req.user.ncbRemaining || 0,
      ncbTotal: plans.rankSeconds(req.user.rank),
      totalRuntimeMs: bots.reduce((a, b) => a + (b.totalRuntimeMs || 0), 0),
    },
    middleware: { up: !health.offline, url: mw.BASE },
  });
});

/** Redeem a key: middleware validates -> rank granted. */
app.post("/api/keys/redeem", requireUser, async (req, res) => {
  const key = String((req.body || {}).key || "").trim().toLowerCase();
  const isNewFormat = /^[a-z0-9]{16}-[a-z0-9]{16}-[a-z0-9]{16}$/.test(key);
  const isLegacyFormat = /^vxt-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(key);
  if (!isNewFormat && !isLegacyFormat) {
    return res.status(400).json({ ok: false, error: "Key format looks wrong — it should be three long random groups, e.g. k7xm2q9fz4hd8w1-p3n8xk2m7qf9wd4-z8kq2m4fj7hd9x2" });
  }
  const result = await mw.redeem(key, req.user.id);
  if (!result.ok) return res.status(result.offline ? 503 : 400).json({ ok: false, error: result.error || "Key rejected by middleware." });

  const rank = result.rank;
  req.user.rank = rank;
  req.user.ncbRemaining = plans.rankSeconds(rank);
  req.user.paidKeys = req.user.paidKeys || [];
  req.user.paidKeys.push({ key: result.key || key, rank, at: Date.now() });
  store.save();
  store.audit("key.redeem", `${req.user.name} redeemed ${key} -> ${rank}`);

  // free slot check — if the new rank allows fewer servers than they have, keep bots but block new ones
  res.json({ ok: true, rank, rankName: plans.plan(rank).name, ncbRemaining: req.user.ncbRemaining, success: true });
});

/* ---------------- BOTS ---------------- */

app.get("/api/bots", requireUser, (req, res) => {
  const db = store.get();
  const bots = Object.values(db.bots).filter((b) => b.ownerId === req.user.id).map(publicBot);
  res.json({ ok: true, bots, maxServers: plans.maxServers(req.user.rank), rank: req.user.rank });
});

app.post("/api/bots", requireUser, (req, res) => {
  const { name, language } = req.body || {};
  if (!name || !/^[\w\-. ]{2,32}$/.test(name)) return res.status(400).json({ ok: false, error: "Bot name must be 2-32 chars." });
  const max = plans.maxServers(req.user.rank);
  if (countBots(req.user.id) >= max) {
    return res.status(403).json({ ok: false, error: `Your rank (${plans.plan(req.user.rank).name}) allows ${max} server(s). Upgrade in Paids to add more.` });
  }
  const db = store.get();
  const id = crypto.randomBytes(6).toString("hex");
  const bot = {
    id, ownerId: req.user.id, name,
    language: language || "unknown",
    token: "", env: {},
    createdAt: Date.now(), files: [],
    status: "stopped", totalRuntimeMs: 0, usageByDay: {},
  };
  db.bots[id] = bot;
  files.ensureDir(botDirOf(bot));
  store.save();
  store.audit("bot.create", `${req.user.name} created bot "${name}"`);
  res.json({ ok: true, bot: publicBot(bot) });
});

app.get("/api/bots/:id", requireUser, (req, res) => {
  const bot = getBotForUser(req.params.id, req.user);
  if (!bot) return res.status(404).json({ ok: false, error: "Bot not found." });
  const dir = botDirOf(bot);
  const detected = runner.detectLanguage(dir);
  res.json({
    ok: true,
    bot: publicBot(bot),
    env: bot.env || {},
    tokenSet: !!bot.token,
    detected: detected.language,
    files: files.listFiles(dir),
    leaks: scanBotFiles(dir),
    runFile: bot.runFile || "",
    runCommand: runner.resolveRunCommand(dir, bot.runFile),
  });
});

app.patch("/api/bots/:id", requireUser, (req, res) => {
  const bot = getBotForUser(req.params.id, req.user);
  if (!bot) return res.status(404).json({ ok: false, error: "Bot not found." });
  const { name, token, env, language, runFile } = req.body || {};
  if (name !== undefined) { if (!/^[\w\-. ]{2,32}$/.test(name)) return res.status(400).json({ ok: false, error: "Invalid name." }); bot.name = name; }
  if (token !== undefined) bot.token = String(token).trim();
  if (language !== undefined) bot.language = String(language);
  if (runFile !== undefined) {
    const rf = String(runFile || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
    if (rf && (rf.includes("..") || rf.length > 180)) return res.status(400).json({ ok: false, error: "Invalid run file." });
    bot.runFile = rf;
  }
  if (env && typeof env === "object") {
    const clean = {};
    for (const [k, v] of Object.entries(env)) if (/^[A-Z0-9_]+$/i.test(k)) clean[k] = String(v);
    bot.env = clean;
  }
  const envChanged = token !== undefined || env !== undefined;
  store.save();
  // token & env vars land in the project's .env immediately — not only on boot
  if (envChanged) runner.writeEnv(botDirOf(bot), bot);
  res.json({ ok: true, bot: publicBot(bot), envSaved: envChanged });
});

app.delete("/api/bots/:id", requireUser, (req, res) => {
  const bot = getBotForUser(req.params.id, req.user);
  if (!bot) return res.status(404).json({ ok: false, error: "Bot not found." });
  if (runner.isRunning(bot.id)) runner.kill(bot);
  files.removeBotDir(botDirOf(bot));
  const db = store.get();
  delete db.bots[bot.id];
  store.save();
  store.audit("bot.delete", `${req.user.name} deleted bot "${bot.name}"`);
  res.json({ ok: true });
});

/* ---- files (drag & drop the project folder) ---- */

app.post("/api/bots/:id/files", requireUser, (req, res) => {
  const bot = getBotForUser(req.params.id, req.user);
  if (!bot) return res.status(404).json({ ok: false, error: "Bot not found." });
  const { files: incoming } = req.body || {};
  if (!Array.isArray(incoming) || !incoming.length) return res.status(400).json({ ok: false, error: "No files uploaded." });
  if (incoming.length > 500) return res.status(400).json({ ok: false, error: "Too many files (max 500 per upload)." });
  const result = files.saveFiles(botDirOf(bot), incoming);
  const dir = botDirOf(bot);
  bot.files = files.listFiles(dir).map((f) => f.path);
  const detected = runner.detectLanguage(dir);
  bot.language = detected.language;
  store.save();
  const warnings = [];
  for (const f of incoming) {
    if (/(^|\/)\.env(\.|$|\/)/i.test(String(f.path))) continue;
    const line = scanContent(f.content);
    if (line) warnings.push({ path: f.path, line });
    if (warnings.length >= 5) break;
  }
  res.json({ ok: true, saved: result.saved, errors: result.errors, files: bot.files, language: bot.language, warnings });
});

app.get("/api/bots/:id/file", requireUser, (req, res) => {
  const bot = getBotForUser(req.params.id, req.user);
  if (!bot) return res.status(404).json({ ok: false, error: "Bot not found." });
  try {
    const content = files.readFile(botDirOf(bot), String(req.query.path || ""));
    res.json({ ok: true, path: req.query.path, content });
  } catch (e) {
    res.status(404).json({ ok: false, error: "File not found." });
  }
});

app.delete("/api/bots/:id/file", requireUser, (req, res) => {
  const bot = getBotForUser(req.params.id, req.user);
  if (!bot) return res.status(404).json({ ok: false, error: "Bot not found." });
  try {
    files.deleteFile(botDirOf(bot), String(req.query.path || ""));
    const dir = botDirOf(bot);
    bot.files = files.listFiles(dir).map((f) => f.path);
    if (bot.runFile === String(req.query.path || "").replace(/\\/g, "/")) bot.runFile = "";
    store.save();
    res.json({ ok: true, files: bot.files });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.put("/api/bots/:id/file", requireUser, (req, res) => {
  const bot = getBotForUser(req.params.id, req.user);
  if (!bot) return res.status(404).json({ ok: false, error: "Bot not found." });
  try {
    const p = String(req.body.path || "");
    files.writeFile(botDirOf(bot), p, String(req.body.content ?? ""));
    const line = /(^|\/)\.env(\.|$|\/)/i.test(p) ? null : scanContent(req.body.content);
    res.json({ ok: true, warning: line ? { path: p, line } : null });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

/* ---- process control: start / stop / shutdown / kill ---- */

function controlGuard(req, res) {
  const bot = getBotForUser(req.params.id, req.user);
  if (!bot) { res.status(404).json({ ok: false, error: "Bot not found." }); return null; }
  if (req.user.rank !== "free" && (req.user.ncbRemaining || 0) <= 0) {
    req.user.rank = "free"; req.user.ncbRemaining = plans.rankSeconds("free"); store.save();
    res.status(403).json({ ok: false, error: "Your paid time (ncb) has ended. Redeem a new key in Paids, or continue on Free." });
    return null;
  }
  return bot;
}

app.post("/api/bots/:id/start", requireUser, async (req, res) => {
  const bot = controlGuard(req, res); if (!bot) return;
  if (!runner.isRunning(bot.id) && countBotsRunning(req.user.id) >= plans.maxServers(req.user.rank)) {
    return res.status(403).json({ ok: false, error: "Server slot limit reached for your rank." });
  }
  bot.lastStartAt = Date.now();
  const r = await runner.start(bot);
  store.save();
  if (!r.ok) return res.status(400).json({ ok: false, error: r.error, bot: publicBot(bot) });
  res.json({ ok: true, bot: publicBot(bot) });
});

function countBotsRunning(userId) {
  const db = store.get();
  return Object.values(db.bots).filter((b) => b.ownerId === userId && runner.isRunning(b.id)).length;
}

app.post("/api/bots/:id/stop", requireUser, (req, res) => {
  const bot = controlGuard(req, res); if (!bot) return;
  const r = runner.stop(bot);
  if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
  res.json({ ok: true });
});
app.post("/api/bots/:id/shutdown", requireUser, (req, res) => {
  const bot = controlGuard(req, res); if (!bot) return;
  const r = runner.shutdown(bot);
  if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
  res.json({ ok: true });
});
app.post("/api/bots/:id/kill", requireUser, async (req, res) => {
  const bot = controlGuard(req, res); if (!bot) return;
  const wasRunning = runner.isRunning(bot.id);
  const r = runner.kill(bot);
  if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
  if (wasRunning) await new Promise((d) => setTimeout(d, 1200)); // let the process tree die first
  // KILL = reset: wipe every project file, keep settings, start fresh
  const dir = botDirOf(bot);
  files.removeBotDir(dir);
  files.ensureDir(dir);
  bot.files = [];
  bot.runFile = "";
  bot.status = "stopped";
  bot.stoppedAt = Date.now();
  store.save();
  store.audit("bot.kill", `${req.user.name} killed bot "${bot.name}" — all project files wiped`);
  res.json({ ok: true, bot: publicBot(bot) });
});

app.get("/api/bots/:id/status", requireUser, (req, res) => {
  const bot = getBotForUser(req.params.id, req.user);
  if (!bot) return res.status(404).json({ ok: false, error: "Bot not found." });
  res.json({ ok: true, status: runner.status(bot.id), bot: publicBot(bot) });
});

app.get("/api/bots/:id/metrics", requireUser, async (req, res) => {
  const bot = getBotForUser(req.params.id, req.user);
  if (!bot) return res.status(404).json({ ok: false, error: "Bot not found." });
  const m = await runner.metrics(bot.id);
  const owner = store.get().users[bot.ownerId];
  const rank = owner ? owner.rank : req.user.rank;
  res.json({
    ok: true,
    metrics: m,
    limits: plans.plan(rank).limits,
    rank: rank,
    status: runner.status(bot.id).status,
  });
});

app.get("/api/bots/:id/metrics/history", requireUser, (req, res) => {
  const bot = getBotForUser(req.params.id, req.user);
  if (!bot) return res.status(404).json({ ok: false, error: "Bot not found." });
  const range = String(req.query.range || "60");
  let sec = 60;
  if (range === "1s") sec = 1;
  else if (range === "5s") sec = 5;
  else if (range === "30s") sec = 30;
  else if (range === "1m") sec = 60;
  else if (range === "5m") sec = 300;
  else if (range === "10m") sec = 600;
  else if (range === "15m") sec = 900;
  else if (range === "20m") sec = 1200;
  else if (range === "30m") sec = 1800;
  else if (range === "1h") sec = 3600;
  else if (range === "2h") sec = 7200;
  else if (range === "5h") sec = 18000;
  else if (range === "1d") sec = 86400;
  else sec = parseInt(range, 10) || 60;
  const hist = runner.getMetricsHistory ? runner.getMetricsHistory(bot.id, sec) : [];
  res.json({ ok: true, history: hist, range: sec });
});

app.get("/api/bots/:id/console", requireUser, (req, res) => {
  const bot = getBotForUser(req.params.id, req.user);
  if (!bot) return res.status(404).json({ ok: false, error: "Bot not found." });
  res.json({ ok: true, logs: runner.getRuntime(bot.id).logs });
});

/* ---------------- OVERVIEW / STATS ---------------- */

app.get("/api/overview", requireUser, (req, res) => {
  const db = store.get();
  const bots = Object.values(db.bots).filter((b) => b.ownerId === req.user.id);
  const running = bots.filter((b) => runner.isRunning(b.id));
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    week.push({ day: key, label: d.toLocaleDateString("en", { weekday: "short" }), seconds: (req.user.usageByDay || {})[key] || 0 });
  }
  res.json({
    ok: true,
    user: publicUser(req.user),
    stats: {
      bots: bots.length,
      running: running.length,
      maxServers: plans.maxServers(req.user.rank),
      totalRuntimeMs: bots.reduce((a, b) => a + (b.totalRuntimeMs || 0), 0),
      week,
    },
  });
});

/* ---------------- DEV PANEL (admin) ---------------- */

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body || {};
  if (String(password) !== String(CONFIG.adminPassword)) {
    store.audit("admin.login.fail", "wrong dev password");
    return res.status(401).json({ ok: false, error: "Wrong dev password." });
  }
  const token = crypto.randomBytes(24).toString("hex");
  if (!global.__adminTokens) global.__adminTokens = new Set();
  global.__adminTokens.add(token);
  res.setHeader("Set-Cookie", `vx_admin=${token}; HttpOnly; Path=/; Max-Age=${60 * 60 * 12}; SameSite=Lax`);
  res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  const t = parseCookies(req).vx_admin;
  if (t && global.__adminTokens) global.__adminTokens.delete(t);
  res.setHeader("Set-Cookie", "vx_admin=; HttpOnly; Path=/; Max-Age=0");
  res.json({ ok: true });
});

app.get("/api/admin/session", (req, res) => res.json({ ok: adminAuth(req) }));

app.get("/api/admin/stats", requireAdmin, async (req, res) => {
  const db = store.get();
  const users = Object.values(db.users);
  const bots = Object.values(db.bots);
  const health = await mw.health();
  res.json({
    ok: true,
    stats: {
      users: users.length,
      banned: users.filter((u) => u.banned).length,
      bots: bots.length,
      running: bots.filter((b) => runner.isRunning(b.id)).length,
      byRank: users.reduce((a, u) => { a[u.rank] = (a[u.rank] || 0) + 1; return a; }, {}),
    },
    middleware: { up: !health.offline, total: health.total || 0, live: health.live || 0, url: mw.BASE },
    audit: db.audit.slice(0, 40),
  });
});

/* ---- users management ---- */

app.get("/api/admin/users", requireAdmin, (req, res) => {
  const db = store.get();
  const users = Object.values(db.users).map((u) => ({
    ...publicUser(u),
    banned: !!u.banned,
    botCount: Object.values(db.bots).filter((b) => b.ownerId === u.id).length,
  })).sort((a, b) => b.createdAt - a.createdAt);
  res.json({ ok: true, users });
});

app.post("/api/admin/users/:id/ban", requireAdmin, (req, res) => setBan(req, res, true));
app.post("/api/admin/users/:id/unban", requireAdmin, (req, res) => setBan(req, res, false));
function setBan(req, res, value) {
  const db = store.get();
  const u = db.users[req.params.id];
  if (!u) return res.status(404).json({ ok: false, error: "User not found." });
  u.banned = value;
  if (value) {
    for (const b of Object.values(db.bots)) if (b.ownerId === u.id && runner.isRunning(b.id)) runner.kill(b);
    auth.destroyUserSessions(u.id);
  }
  store.save();
  store.audit(value ? "user.ban" : "user.unban", `${u.name} ${value ? "banned" : "unbanned"}`);
  res.json({ ok: true, banned: u.banned });
}

/** Kick sign in — force every session of that user to sign out. */
app.post("/api/admin/users/:id/kick", requireAdmin, (req, res) => {
  const db = store.get();
  const u = db.users[req.params.id];
  if (!u) return res.status(404).json({ ok: false, error: "User not found." });
  const n = auth.destroyUserSessions(u.id);
  store.audit("user.kick", `${u.name} kicked (${n} session(s))`);
  res.json({ ok: true, kicked: n });
});

/** Dev may grant / revoke a rank manually. */
app.post("/api/admin/users/:id/rank", requireAdmin, (req, res) => {
  const db = store.get();
  const u = db.users[req.params.id];
  if (!u) return res.status(404).json({ ok: false, error: "User not found." });
  const rk = ["free", "plus", "pro", "max"].includes((req.body || {}).rank) ? req.body.rank : "free";
  u.rank = rk;
  u.ncbRemaining = plans.rankSeconds(rk);
  store.save();
  store.audit("user.rank", `${u.name} rank set to ${rk} by dev`);
  res.json({ ok: true, rank: rk });
});

/** Delete user — removes account, sessions, bots and their files. */
app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  const db = store.get();
  const u = db.users[req.params.id];
  if (!u) return res.status(404).json({ ok: false, error: "User not found." });
  for (const b of Object.values(db.bots)) {
    if (b.ownerId === u.id) {
      if (runner.isRunning(b.id)) runner.kill(b);
      files.removeBotDir(botDirOf(b));
      delete db.bots[b.id];
    }
  }
  auth.destroyUserSessions(u.id);
  delete db.users[u.id];
  store.save();
  store.audit("user.delete", `${u.name} DELETED by dev`);
  res.json({ ok: true });
});

/* ---- keys management (proxied to middleware) ---- */

app.post("/api/admin/keys/generate", requireAdmin, async (req, res) => {
  const { rank, count } = req.body || {};
  const r = await mw.generate(rank, count);
  if (!r.ok) return res.status(r.offline ? 503 : 400).json({ ok: false, error: r.error });
  store.audit("key.generate", `${count || 1}x ${rank} key(s) summoned`);
  res.json({ ok: true, keys: r.keys });
});

/** Reset all licenses/ranks - delete all keys from middleware and reset all users to free */
app.post("/api/admin/licenses/reset", requireAdmin, async (req, res) => {
  try {
    // Try to delete all keys from middleware
    const all = await mw.list("all");
    if (all.ok && Array.isArray(all.keys)) {
      for (const k of all.keys) {
        try { await mw.remove(k.key); } catch (_) {}
      }
    }
    // Reset all users to free
    const db = store.get();
    let reset = 0;
    for (const u of Object.values(db.users)) {
      if (u.rank && u.rank !== "free") {
        u.rank = "free";
        u.ncbRemaining = plans.rankSeconds("free");
        u.paidKeys = [];
        reset++;
        // Stop running bots for users who had paid ranks
        for (const b of Object.values(db.bots)) {
          if (b.ownerId === u.id && runner.isRunning(b.id)) {
            try { runner.kill(b); } catch (_) {}
          }
        }
      } else if (u.paidKeys && u.paidKeys.length) {
        u.paidKeys = [];
      }
    }
    store.save();
    store.audit("licenses.reset", `All licenses reset by dev — ${reset} user(s) reverted to Free`);
    res.json({ ok: true, reset });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || "Failed to reset licenses" });
  }
});

app.get("/api/admin/keys", requireAdmin, async (req, res) => {
  const r = await mw.list(String(req.query.status || "all"));
  if (!r.ok) return res.status(r.offline ? 503 : 400).json({ ok: false, error: r.error, keys: [] });
  const db = store.get();
  const keys = (r.keys || []).map((k) => ({
    ...k,
    usedByName: k.usedBy && db.users[k.usedBy] ? db.users[k.usedBy].name : k.usedBy,
  }));
  res.json({ ok: true, keys });
});

app.delete("/api/admin/keys/:key", requireAdmin, async (req, res) => {
  const key = String(req.params.key).toUpperCase();
  const r = await mw.remove(key);
  if (!r.ok) return res.status(r.offline ? 503 : 404).json({ ok: false, error: r.error });
  // deleting a USED key also revokes the rank it granted
  let revoked = null;
  if (r.wasUsed && r.usedBy) {
    const db = store.get();
    const u = db.users[r.usedBy];
    if (u && (u.paidKeys || []).some((pk) => pk.key === key)) {
      u.rank = "free";
      u.ncbRemaining = plans.rankSeconds("free");
      u.paidKeys = u.paidKeys.filter((pk) => pk.key !== key);
      // stop their running bots — rank gone
      for (const b of Object.values(db.bots)) if (b.ownerId === u.id && runner.isRunning(b.id)) runner.kill(b);
      store.save();
      revoked = u.name;
    }
  }
  store.audit("key.delete", `${key} deleted${revoked ? ` -> rank revoked from ${revoked}` : ""}`);
  res.json({ ok: true, revokedFrom: revoked });
});

/* ---- settings ---- */

app.get("/api/admin/settings", requireAdmin, (req, res) => {
  res.json({
    ok: true,
    discord: { configured: !!(CONFIG.discord.clientId && CONFIG.discord.clientSecret), clientId: CONFIG.discord.clientId || "" },
    keyMiddlewareUrl: mw.BASE,
    appUrl: APP_URL,
  });
});

app.patch("/api/admin/settings", requireAdmin, (req, res) => {
  const { adminPassword, discordClientId, discordClientSecret, keyMiddlewareUrl } = req.body || {};
  if (adminPassword) CONFIG.adminPassword = String(adminPassword);
  if (discordClientId !== undefined) CONFIG.discord.clientId = String(discordClientId);
  if (discordClientSecret !== undefined) CONFIG.discord.clientSecret = String(discordClientSecret);
  saveConfig();
  store.audit("admin.settings", "settings updated");
  res.json({ ok: true });
});

app.get("/api/admin/audit", requireAdmin, (req, res) => res.json({ ok: true, audit: store.get().audit.slice(0, 200) }));

/* ---------------- static frontend ---------------- */

// always revalidate frontend files — no stale app.js/app.html after edits
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  next();
});
// clean URLs: redirect .html to clean paths
app.get("/app.html", (req, res) => res.redirect(302, "/Overview"));
app.get("/auth.html", (req, res) => res.redirect(302, "/auth"));
app.get("/index.html", (req, res) => res.redirect(302, "/"));
app.use(express.static(path.join(ROOT, "public")));
app.get("/auth", (req, res) => {
  res.sendFile(path.join(ROOT, "public", "auth.html"));
});
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ ok: false, error: "Unknown API route." });
  // SPA routes — serve the dashboard shell for clean paths like /Services or /Bot/:id/Manage
  const PAGES = "Overview|Services|Invoices|Paids|Settings";
  const BOT_PAGES = "Overview|Manage|Console|Seted";
  if (new RegExp("^/(?:" + PAGES + ")/?$", "i").test(req.path) ||
      new RegExp("^/Bot/[\\w-]+(?:/(?:" + BOT_PAGES + "))?/?$", "i").test(req.path)) {
    return res.sendFile(path.join(ROOT, "public", "app.html"));
  }
  next();
});

/* ---------------- WebSocket: live console ---------------- */

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname !== "/ws/console") { socket.destroy(); return; }
  const token = parseCookies(req).vx_session;
  const s = token ? auth.getSession(token) : null;
  if (!s || s.user.banned) { socket.destroy(); return; }
  const botId = url.searchParams.get("bot");
  const db = store.get();
  const bot = db.bots[botId];
  if (!bot || (!s.user.isAdmin && bot.ownerId !== s.user.id)) { socket.destroy(); return; }

  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.botId = botId;
    // send backlog
    ws.send(JSON.stringify({ type: "backlog", botId, logs: runner.getRuntime(botId).logs }));
    runner.subscribe(botId, ws);
    ws.on("close", () => runner.unsubscribe(botId, ws));
    ws.on("message", (raw) => {
      // optional: send stdin to the running process
      try {
        const msg = JSON.parse(raw.toString());
        const rt = runner.getRuntime(botId);
        if (msg.type === "stdin" && rt.proc && rt.proc.stdin) {
          rt.proc.stdin.write(String(msg.data ?? "") + "\n");
        }
      } catch (_) {}
    });
  });
});

/* ---------------- NCB runtime ticker ----------------
 * Paid ranks consume their "ncb" time ONLY while a bot is running.
 * Stop the bot -> the clock pauses. Time ends -> downgrade to Free.
 * Free rank never expires.
 * ---------------------------------------------------- */

setInterval(() => {
  const db = store.get();
  const runningByUser = new Map();
  for (const botId of runner.allRunning()) {
    const bot = db.bots[botId];
    if (!bot) continue;
    runningByUser.set(bot.ownerId, (runningByUser.get(bot.ownerId) || 0) + 1);
    bot.totalRuntimeMs = (bot.totalRuntimeMs || 0) + 1000;
    const day = new Date().toISOString().slice(0, 10);
    bot.usageByDay = bot.usageByDay || {};
    bot.usageByDay[day] = (bot.usageByDay[day] || 0) + 1;
  }
  for (const [userId, count] of runningByUser) {
    const u = db.users[userId];
    if (!u) continue;
    const day = new Date().toISOString().slice(0, 10);
    u.usageByDay = u.usageByDay || {};
    u.usageByDay[day] = (u.usageByDay[day] || 0) + 1;
    if (u.rank !== "free") {
      u.ncbRemaining = Math.max(0, (u.ncbRemaining || 0) - 1);
      if (u.ncbRemaining <= 0) {
        u.rank = "free";
        u.ncbRemaining = plans.rankSeconds("free");
        store.audit("rank.expire", `${u.name} ran out of ncb time -> back to Free`);
        for (const b of Object.values(db.bots)) {
          if (b.ownerId === u.id && runner.isRunning(b.id)) {
            runner.log(b.id, "VAXTOR: paid ncb time ended — shutting this bot down.", "sys");
            runner.stop(b);
          }
        }
      }
    }
  }
  if (runningByUser.size) store.save();
}, 1000);

/* ---------------- boot ---------------- */

store.load();
server.listen(PORT, () => {
  console.log("");
  console.log("  ██╗   ██╗██╗   ██╗██╗  ██╗██╗███████╗");
  console.log("  ██║   ██║╚██╗ ██╔╝██║ ██╔╝██║██╔════╝");
  console.log("  ╚██╗ ██╔╝ ╚████╔╝ █████╔╝ ██║███████╗");
  console.log("   ╚████╔╝   ╚██╔╝  ╚██╔╝  ██║╚════██║");
  console.log("    ╚═══╝     ██║   ██║   ███████╗███████║");
  console.log("              ╚═╝   ╚═╝   ╚══════╝╚══════╝");
  console.log("");
  console.log(`  ● Vaxtor is ONLINE — ${APP_URL}`);
  console.log(`  ● Dev panel     — ${APP_URL}/dev/Code.html  (password: ${CONFIG.adminPassword})`);
  console.log(`  ● Key middleware— run "node keyserver.js" for the ตัวกลาง on port 3200`);
  console.log("");
});
