"use strict";
/**
 * Vaxtor — safe project file helpers (upload via drag & drop folder).
 * Blocks path traversal, keeps every bot inside bots/<owner>/<botId>/.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const BOTS_ROOT = path.join(ROOT, "bots");

const IGNORE_DIRS = new Set([".git", "node_modules", ".venv", "venv", "__pycache__", ".idea", ".vscode"]);
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB per file

function botDir(ownerId, botId) {
  const dir = path.join(BOTS_ROOT, String(ownerId), String(botId));
  return dir;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Resolve a relative upload path safely inside base dir. */
function safeJoin(base, rel) {
  rel = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel || rel.includes("..") || /^[a-zA-Z]:/.test(rel) || rel.includes("\0")) {
    throw new Error("Invalid path: " + rel);
  }
  const full = path.join(base, rel);
  const norm = path.normalize(full);
  if (!norm.startsWith(path.normalize(base + path.sep)) && norm !== path.normalize(base)) {
    throw new Error("Path escapes sandbox: " + rel);
  }
  return norm;
}

function shouldIgnore(rel) {
  const parts = rel.replace(/\\/g, "/").split("/");
  return parts.some((p) => IGNORE_DIRS.has(p));
}

/** Save { path, content }[] (base64 supported) into a bot dir. */
function saveFiles(dir, files) {
  ensureDir(dir);
  let saved = 0;
  const errors = [];
  for (const f of files || []) {
    try {
      if (!f || !f.path) continue;
      if (shouldIgnore(f.path)) continue;
      const full = safeJoin(dir, f.path);
      const content = f.encoding === "base64" ? Buffer.from(f.content || "", "base64") : Buffer.from(f.content ?? "", "utf8");
      if (content.length > MAX_FILE_BYTES) { errors.push(`${f.path}: too large (>2MB)`); continue; }
      ensureDir(path.dirname(full));
      fs.writeFileSync(full, content);
      saved++;
    } catch (e) {
      errors.push(String(e.message || e));
    }
  }
  return { saved, errors };
}

/** Recursively list files of a project (relative posix paths). */
function listFiles(dir, base = dir, out = [], depth = 0) {
  if (depth > 8 || out.length > 800) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries) {
    if (IGNORE_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full).split(path.sep).join("/");
    if (e.isDirectory()) listFiles(full, base, out, depth + 1);
    else {
      let size = 0;
      try { size = fs.statSync(full).size; } catch (_) {}
      out.push({ path: rel, size });
    }
  }
  return out;
}

function readFile(dir, rel) {
  const full = safeJoin(dir, rel);
  return fs.readFileSync(full, "utf8");
}

function writeFile(dir, rel, content) {
  const full = safeJoin(dir, rel);
  ensureDir(path.dirname(full));
  fs.writeFileSync(full, Buffer.from(content ?? "", "utf8"));
  return true;
}

function deleteFile(dir, rel) {
  const full = safeJoin(dir, rel);
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) throw new Error("File not found: " + rel);
  fs.unlinkSync(full);
  return true;
}

function removeBotDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); return true; } catch (_) { return false; }
}

module.exports = { BOTS_ROOT, botDir, ensureDir, safeJoin, saveFiles, listFiles, readFile, writeFile, deleteFile, removeBotDir };
