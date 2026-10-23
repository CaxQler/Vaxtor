"use strict";
/**
 * VAXTOR — KEY MIDDLEWARE ("ตัวกลาง")
 * ------------------------------------------------------------------
 * Dev summons a key from a private source  -->  it lands HERE
 * The front door (Vaxtor web) checks HERE  -->  grants the rank
 *
 * Run:  node keyserver.js         (default port 3200)
 * Auth: every route needs header  X-Key-Secret: <secret>
 * Secret lives in data/config.json (created on first run).
 *
 * Routes
 *   POST   /api/keys/generate   { rank, count }  -> { keys: [...] }
 *   GET    /api/keys/:key                       -> { valid, rank, used }
 *   POST   /api/keys/redeem    { key, userId }  -> { ok, rank }  (atomic, single use)
 *   GET    /api/keys?status=live|unlive|all     -> { keys: [...] }
 *   DELETE /api/keys/:key                       -> { ok }
 *   GET    /api/health                          -> { ok, total, live }
 */
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.KEYSERVER_PORT) || 3200;
const DATA_DIR = path.join(__dirname, "data");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const KEYS_FILE = path.join(DATA_DIR, "keys.json");

const RANKS = ["free", "plus", "pro", "max", "dev"];

function loadConfig() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  let cfg = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch (_) { cfg = {}; }
  }
  if (!cfg.keySecret) {
    cfg.keySecret = crypto.randomBytes(24).toString("hex");
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
    console.log("[keyserver] generated a fresh key secret ->", CONFIG_FILE);
  }
  return cfg;
}
const CONFIG = loadConfig();

let keys = {}; // key -> { key, rank, used, usedBy, createdAt, usedAt }
function loadKeys() {
  if (fs.existsSync(KEYS_FILE)) {
    try { keys = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8")); } catch (_) { keys = {}; }
  }
  // migrate legacy UPPERCASE keys -> lowercase (lookups are case-insensitive, storage is lowercase)
  let changed = false;
  const migrated = {};
  for (const [k, rec] of Object.entries(keys)) {
    const nk = String(k).toLowerCase();
    if (nk !== k) changed = true;
    if (rec && typeof rec === "object") rec.key = nk;
    migrated[nk] = rec;
  }
  keys = migrated;
  if (changed) fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
}
loadKeys();

/** Always keep one unlimited DEV key around (random, created on first run). */
function ensureDevKey() {
  if (Object.values(keys).some((k) => k && k.rank === "dev")) return;
  let key = genKey();
  while (keys[key]) key = genKey();
  keys[key] = { key, rank: "dev", used: false, usedBy: null, createdAt: Date.now(), usedAt: null };
  saveKeys();
  console.log(`[keyserver] DEV UNLIMITED key created -> ${key}`);
}

let saveTimer = null;
function saveKeys() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = KEYS_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(keys, null, 2));
    fs.renameSync(tmp, KEYS_FILE);
  }, 30);
}
process.on("exit", () => {
  if (saveTimer) { clearTimeout(saveTimer); try { fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2)); } catch (_) {} }
});

function genKey() {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789"; // lowercase, no l/o/0/1
  const block = (n) => Array.from({ length: n }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  return `${block(16)}-${block(16)}-${block(16)}`;
}

ensureDevKey(); // safe here: saveKeys/saveTimer + genKey are all defined above

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (_) { resolve({}); }
    });
  });
}

function authed(req) {
  const h = req.headers["x-key-secret"];
  return h && crypto.timingSafeEqual(Buffer.from(String(h)), Buffer.from(CONFIG.keySecret));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;

  if (p === "/api/health") {
    const live = Object.values(keys).filter((k) => !k.used).length;
    return send(res, 200, { ok: true, total: Object.keys(keys).length, live, service: "vaxtor-key-middleware" });
  }

  if (!authed(req)) return send(res, 401, { ok: false, error: "Bad or missing X-Key-Secret." });

  // POST /api/keys/generate
  if (req.method === "POST" && p === "/api/keys/generate") {
    const body = await readBody(req);
    const rank = RANKS.includes(body.rank) ? body.rank : null;
    const count = Math.min(100, Math.max(1, parseInt(body.count, 10) || 1));
    if (!rank) return send(res, 400, { ok: false, error: "rank must be free|plus|pro|max" });
    const made = [];
    for (let i = 0; i < count; i++) {
      let key = genKey();
      while (keys[key]) key = genKey(); // collision guard
      const rec = { key, rank, used: false, usedBy: null, createdAt: Date.now(), usedAt: null };
      keys[key] = rec;
      made.push(rec);
    }
    saveKeys();
    console.log(`[keyserver] generated ${count}x ${rank} key(s)`);
    return send(res, 200, { ok: true, keys: made });
  }

  // GET /api/keys?status=
  if (req.method === "GET" && p === "/api/keys") {
    const status = url.searchParams.get("status") || "all";
    let list = Object.values(keys);
    if (status === "live") list = list.filter((k) => !k.used);
    if (status === "unlive") list = list.filter((k) => k.used);
    list.sort((a, b) => b.createdAt - a.createdAt);
    return send(res, 200, { ok: true, keys: list });
  }

  // GET /api/keys/:key  (check)
  if (req.method === "GET" && p.startsWith("/api/keys/")) {
    const key = decodeURIComponent(p.slice("/api/keys/".length)).toLowerCase();
    const rec = keys[key];
    if (!rec) return send(res, 404, { ok: false, valid: false, error: "Key not found in middleware." });
    return send(res, 200, { ok: true, valid: !rec.used, used: rec.used, rank: rec.rank, createdAt: rec.createdAt, usedAt: rec.usedAt });
  }

  // POST /api/keys/redeem  (atomic single-use)
  if (req.method === "POST" && p === "/api/keys/redeem") {
    const body = await readBody(req);
    const key = String(body.key || "").trim().toLowerCase();
    const userId = String(body.userId || "");
    const rec = keys[key];
    if (!rec) return send(res, 404, { ok: false, error: "Key not found. Check again." });
    if (rec.used) return send(res, 409, { ok: false, error: "This key has already been used." });
    rec.used = true;
    rec.usedBy = userId;
    rec.usedAt = Date.now();
    saveKeys();
    console.log(`[keyserver] key ${key} redeemed for rank ${rec.rank} by user ${userId}`);
    return send(res, 200, { ok: true, rank: rec.rank, key: rec.key });
  }

  // DELETE /api/keys/:key  (delete => unusable, and rank is revoked by the front door)
  if (req.method === "DELETE" && p.startsWith("/api/keys/")) {
    const key = decodeURIComponent(p.slice("/api/keys/".length)).toLowerCase();
    if (!keys[key]) return send(res, 404, { ok: false, error: "Key not found." });
    const rec = keys[key];
    delete keys[key];
    saveKeys();
    console.log(`[keyserver] key ${key} deleted`);
    return send(res, 200, { ok: true, key: rec.key, usedBy: rec.usedBy, wasUsed: rec.used });
  }

  return send(res, 404, { ok: false, error: "Unknown route." });
});

server.listen(PORT, () => {
  console.log("──────────────────────────────────────────────");
  console.log("  VAXTOR KEY MIDDLEWARE (ตัวกลาง)  ●  ONLINE");
  console.log(`  http://localhost:${PORT}`);
  console.log(`  secret file: ${CONFIG_FILE}`);
  console.log("──────────────────────────────────────────────");
});
