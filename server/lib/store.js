"use strict";
/**
 * Vaxtor — tiny JSON datastore (no database needed).
 * Keeps everything in data/db.json and hot-reloads on change.
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const EMPTY = () => ({
  users: {}, // id -> user
  bots: {},  // id -> bot
  audit: [], // admin actions
});

let db = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDir();
  if (fs.existsSync(DB_FILE)) {
    try {
      db = Object.assign(EMPTY(), JSON.parse(fs.readFileSync(DB_FILE, "utf8")));
    } catch (e) {
      console.error("[store] db.json corrupt, starting fresh:", e.message);
      db = EMPTY();
    }
  } else {
    db = EMPTY();
  }
  return db;
}

function get() {
  if (!db) load();
  return db;
}

let saveTimer = null;
function save() {
  ensureDir();
  // debounce writes a little so bursts of changes don't hammer the disk
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const tmp = DB_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(get(), null, 2));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) {
      console.error("[store] save failed:", e.message);
    }
  }, 50);
}

// flush on exit so we never lose the last writes
process.on("exit", () => {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try {
    if (db) {
      ensureDir();
      const tmp = DB_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
      fs.renameSync(tmp, DB_FILE);
    }
  } catch (_) {}
});

function audit(action, detail) {
  const d = get();
  d.audit.unshift({ at: Date.now(), action, detail });
  if (d.audit.length > 500) d.audit.length = 500;
  save();
}

module.exports = { get, save, load, audit, DATA_DIR, DB_FILE };
