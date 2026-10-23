"use strict";
/**
 * Vaxtor — client for the Key Middleware (ตัวกลาง).
 * Reads the shared secret from data/config.json; base URL from
 * KEYSERVER_URL env (default http://localhost:3200).
 */
const fs = require("fs");
const path = require("path");

const BASE = (process.env.KEYSERVER_URL || "http://localhost:3200").replace(/\/$/, "");

function secret() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "data", "config.json"), "utf8"));
    return cfg.keySecret;
  } catch (_) {
    return null;
  }
}

async function call(method, route, body) {
  const s = secret();
  if (!s) return { ok: false, offline: true, error: "Key middleware secret not found. Start `node keyserver.js` once." };
  let res;
  try {
    res = await fetch(BASE + route, {
      method,
      headers: { "Content-Type": "application/json", "X-Key-Secret": s },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    return { ok: false, offline: true, error: "Key middleware (ตัวกลาง) is offline — start it with: node keyserver.js" };
  }
  try { return await res.json(); }
  catch (_) { return { ok: false, error: "Middleware returned status " + res.status }; }
}

module.exports = {
  BASE,
  generate: (rank, count) => call("POST", "/api/keys/generate", { rank, count }),
  check: (key) => call("GET", "/api/keys/" + encodeURIComponent(key)),
  redeem: (key, userId) => call("POST", "/api/keys/redeem", { key, userId }),
  list: (status) => call("GET", "/api/keys?status=" + (status || "all")),
  remove: (key) => call("DELETE", "/api/keys/" + encodeURIComponent(key)),
  health: () => call("GET", "/api/health"),
};
