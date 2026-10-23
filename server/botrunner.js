"use strict";
/**
 * Vaxtor — Bot Runner.
 * Detects the project language, installs dependencies automatically,
 * then runs the bot 24/7 with a live console.
 *
 *   Start    (green)   -> boot (auto npm/pip install, then run)
 *   Stop     (yellow)  -> PAUSE: graceful SIGTERM, stays on standby (quick resume)
 *   Shutdown (red)     -> normal close: SIGTERM, force kill after grace period
 *   Kill     (purple)  -> instant SIGKILL of the whole tree; the API then wipes
 *                         every project file so the bot starts fresh
 */
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { botDir } = require("./lib/files");

const MAX_LOG_LINES = 600;
const SHUTDOWN_GRACE_MS = 8000;

/** botId -> runtime state (never persisted) */
const runtimes = new Map();

const isWin = process.platform === "win32";

/* ---------------- language detection ---------------- */

function detectLanguage(dir) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  const pkg = has("package.json") ? safeJson(path.join(dir, "package.json")) : null;
  if (pkg) return { language: "node", pkg };
  if (has("requirements.txt") || has("pyproject.toml") || has("Pipfile")) return { language: "python", pkg: null };
  try {
    const entries = fs.readdirSync(dir);
    if (entries.some((e) => e.endsWith(".py"))) return { language: "python", pkg: null };
    if (entries.includes("index.js") || entries.includes("main.js") || entries.includes("bot.js")) return { language: "node", pkg: null };
    if (entries.includes("index.ts")) return { language: "node-ts", pkg: null };
  } catch (_) {}
  return { language: "unknown", pkg: null };
}

function safeJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return null; }
}

/** Resolve how to run the project once deps are installed.
 *  overrideFile (bot.runFile) lets the user pick e.g. main.py or src/index.js. */
function resolveRunCommand(dir, overrideFile) {
  const { language, pkg } = detectLanguage(dir);
  if (overrideFile) {
    const safe = String(overrideFile).replace(/\\/g, "/").replace(/^\/+/, "");
    if (safe && !safe.includes("..") && fs.existsSync(path.join(dir, safe))) {
      if (safe.endsWith(".py")) {
        return { language: "python", command: isWin ? "python" : "python3", args: [safe], hasReq: fs.existsSync(path.join(dir, "requirements.txt")) };
      }
      if (safe.endsWith(".js")) return { language: "node", command: process.execPath, args: [safe] };
      if (safe.endsWith(".ts")) return { language: "node-ts", command: process.execPath, args: [safe] };
      return { language, command: process.execPath, args: [safe] };
    }
  }
  if (language === "node" || language === "node-ts") {
    if (pkg && pkg.scripts && pkg.scripts.start) {
      return { language: "node", command: isWin ? "npm.cmd" : "npm", args: ["start"] };
    }
    let main = (pkg && pkg.main) || null;
    if (!main) {
      for (const c of ["index.js", "bot.js", "main.js", "index.ts"]) {
        if (fs.existsSync(path.join(dir, c))) { main = c; break; }
      }
    }
    if (main && fs.existsSync(path.join(dir, main))) {
      return { language: "node", command: process.execPath, args: [main] };
    }
    if (pkg) return { language: "node", command: isWin ? "npm.cmd" : "npm", args: ["start"] };
    return null;
  }
  if (language === "python") {
    const hasReq = fs.existsSync(path.join(dir, "requirements.txt"));
    let main = null;
    for (const c of ["main.py", "bot.py", "app.py", "run.py"]) {
      if (fs.existsSync(path.join(dir, c))) { main = c; break; }
    }
    if (!main) {
      const entries = fs.readdirSync(dir);
      main = entries.find((e) => e.endsWith(".py")) || null;
    }
    if (!main) return null;
    const py = isWin ? "python" : "python3";
    return { language: "python", command: py, args: [main], hasReq };
  }
  return null;
}

/* ---------------- runtime helpers ---------------- */

function getRuntime(botId) {
  if (!runtimes.has(botId)) {
    runtimes.set(botId, {
      status: "stopped", // stopped | installing | running | paused
      proc: null,
      startedAt: null,
      logs: [],
      exitCode: null,
      lastError: null,
      depsInstalledFor: null,
      installRunning: false,
      paused: false,      // Stop = paused on standby (quick resume)
      stopIntent: null,   // "pause" | "shutdown" — decides the status after exit
    });
  }
  return runtimes.get(botId);
}

function log(botId, line, stream = "sys") {
  const rt = getRuntime(botId);
  const stamp = new Date().toLocaleTimeString("en-GB", { hour12: false });
  const entry = { t: Date.now(), stamp, stream, line: String(line).replace(/\r/g, "") };
  rt.logs.push(entry);
  if (rt.logs.length > MAX_LOG_LINES) rt.logs.splice(0, rt.logs.length - MAX_LOG_LINES);
  broadcast(botId, entry);
  return entry;
}

/* WebSocket subscribers: botId -> Set<ws> */
const subscribers = new Map();

function subscribe(botId, ws) {
  if (!subscribers.has(botId)) subscribers.set(botId, new Set());
  subscribers.get(botId).add(ws);
}
function unsubscribe(botId, ws) {
  const set = subscribers.get(botId);
  if (set) { set.delete(ws); if (!set.size) subscribers.delete(botId); }
}
function broadcast(botId, entry) {
  const set = subscribers.get(botId);
  if (!set || !set.size) return;
  const payload = JSON.stringify({ type: "log", botId, entry });
  for (const ws of set) {
    try { if (ws.readyState === 1) ws.send(payload); } catch (_) {}
  }
}

/* ---------------- process control ---------------- */

function killTree(pid) {
  if (!pid) return;
  try {
    if (isWin) {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try { process.kill(-pid, "SIGKILL"); } catch (_) { process.kill(pid, "SIGKILL"); }
    }
  } catch (_) {}
}

function termTree(pid, sig = "SIGTERM") {
  if (!pid) return;
  try {
    if (isWin) {
      // Node on Windows: close() sends CTRL_BREAK for detached procs; fallback to taskkill without /F
      spawn("taskkill", ["/pid", String(pid), "/T"], { stdio: "ignore" });
    } else {
      try { process.kill(-pid, sig); } catch (_) { process.kill(pid, sig); }
    }
  } catch (_) {}
}

function buildEnv(bot) {
  const env = Object.assign({}, process.env);
  env.NODE_ENV = "production";
  env.VAXTOR_BOT_ID = bot.id;
  if (bot.token) {
    env.DISCORD_TOKEN = bot.token;
    env.DISCORD_BOT_TOKEN = bot.token;
    env.BOT_TOKEN = bot.token;
  }
  for (const [k, v] of Object.entries(bot.env || {})) {
    if (typeof k === "string" && /^[A-Z0-9_]+$/i.test(k)) env[k] = String(v);
  }
  return env;
}

/** Write .env so bot code that reads dotenv still finds the token. */
function syncEnvFile(dir, bot) {
  const lines = [];
  if (bot.token) lines.push(`DISCORD_TOKEN=${bot.token}`, `DISCORD_BOT_TOKEN=${bot.token}`, `BOT_TOKEN=${bot.token}`);
  for (const [k, v] of Object.entries(bot.env || {})) lines.push(`${k}=${v}`);
  if (!lines.length) return;
  try {
    if (!fs.existsSync(dir)) return; // no project uploaded yet
    fs.writeFileSync(path.join(dir, ".env"), lines.join("\n") + "\n");
  } catch (_) {}
}

/* ---------------- install + start ---------------- */

function installDeps(bot, dir, plan) {
  return new Promise((resolve) => {
    if (plan.language === "node") {
      const hasPkg = fs.existsSync(path.join(dir, "package.json"));
      const hasModules = fs.existsSync(path.join(dir, "node_modules"));
      const pkgStat = hasPkg ? fs.statSync(path.join(dir, "package.json")).mtimeMs : 0;
      const nmStat = hasModules ? fs.statSync(path.join(dir, "node_modules")).mtimeMs : 0;
      if (hasModules && nmStat > pkgStat) return resolve(true); // deps already installed
      if (!hasPkg && hasModules) return resolve(true);
      if (!hasPkg && !hasModules) {
        log(bot.id, "No package.json found — running file directly.", "sys");
        return resolve(true);
      }
      log(bot.id, "Installing dependencies: npm install ...", "install");
      const p = spawn(isWin ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund"], { cwd: dir, env: buildEnv(bot), shell: isWin });
      let out = "";
      p.stdout.on("data", (d) => { out += d; log(bot.id, d.toString(), "npm"); });
      p.stderr.on("data", (d) => { out += d; log(bot.id, d.toString(), "npm"); });
      p.on("close", (code) => {
        if (code === 0) { log(bot.id, "Dependencies installed.", "ok"); resolve(true); }
        else { log(bot.id, `npm install exited with code ${code}`, "err"); resolve(code === 0); }
      });
      p.on("error", (e) => { log(bot.id, "npm install failed: " + e.message, "err"); resolve(false); });
      return;
    }
    if (plan.language === "python") {
      const hasReq = fs.existsSync(path.join(dir, "requirements.txt"));
      if (!hasReq) return resolve(true);
      log(bot.id, "Installing dependencies: pip install -r requirements.txt ...", "install");
      const py = isWin ? "python" : "python3";
      const p = spawn(py, ["-m", "pip", "install", "-r", "requirements.txt", "--disable-pip-version-check", "-q"], { cwd: dir, env: buildEnv(bot) });
      p.stdout.on("data", (d) => log(bot.id, d.toString(), "pip"));
      p.stderr.on("data", (d) => log(bot.id, d.toString(), "pip"));
      p.on("close", (code) => {
        if (code === 0) { log(bot.id, "Dependencies installed.", "ok"); resolve(true); }
        else { log(bot.id, `pip install exited with code ${code}`, "err"); resolve(code === 0); }
      });
      p.on("error", (e) => { log(bot.id, "pip install failed: " + e.message, "err"); resolve(false); });
      return;
    }
    resolve(false);
  });
}

async function start(bot) {
  const rt = getRuntime(bot.id);
  if (rt.proc || rt.installRunning) return { ok: false, error: "Bot is already starting or running." };
  if (!bot.files || !bot.files.length) return { ok: false, error: "Upload your bot project first (drag the project folder into Manage)." };

  const dir = botDir(bot.ownerId, bot.id);
  const plan = resolveRunCommand(dir, bot.runFile);
  if (!plan) return { ok: false, error: "Cannot detect project language. Add package.json (Node.js) or a .py file / requirements.txt (Python)." };

  bot.language = plan.language;
  rt.exitCode = null;
  rt.lastError = null;
  rt.paused = false;
  rt.stopIntent = null;
  rt.installRunning = true;
  rt.status = "installing";
  log(bot.id, `Boot requested — runtime: ${plan.language}.`, "sys");
  syncEnvFile(dir, bot);

  const okInstall = await installDeps(bot, dir, plan);
  rt.installRunning = false;
  if (!okInstall) {
    rt.status = "stopped";
    log(bot.id, "Startup aborted: dependency installation failed.", "err");
    return { ok: false, error: "Dependency installation failed. Check the console." };
  }

  log(bot.id, `Starting: ${plan.command} ${plan.args.join(" ")}`, "sys");
  const proc = spawn(plan.command, plan.args, {
    cwd: dir,
    env: buildEnv(bot),
    // shell is only needed for .cmd/.bat launchers (npm.cmd). Using it for a
    // path like "C:\Program Files\nodejs\node.exe" would break on the space.
    shell: isWin && /\.(cmd|bat)$/i.test(String(plan.command)),
    detached: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  rt.proc = proc;
  rt.status = "running";
  rt.startedAt = Date.now();
  bot.status = "running";

  proc.stdout.on("data", (d) => log(bot.id, d.toString(), "out"));
  proc.stderr.on("data", (d) => log(bot.id, d.toString(), "err"));

  proc.on("error", (e) => {
    rt.status = "stopped";
    rt.proc = null;
    rt.paused = false;
    rt.stopIntent = null;
    rt.lastError = e.message;
    bot.status = "stopped";
    log(bot.id, "Process error: " + e.message, "err");
    if (bot.onStateChange) bot.onStateChange("stopped");
  });

  proc.on("close", (code, signal) => {
    rt.proc = null;
    rt.status = "stopped";
    rt.paused = rt.stopIntent === "pause";
    rt.stopIntent = null;
    rt.exitCode = signal ? `killed (${signal})` : code;
    bot.status = rt.paused ? "paused" : "stopped";
    bot.stoppedAt = Date.now();
    log(bot.id, rt.paused
      ? `Paused (standby) — exited (${signal || "code " + code}). Press Start to resume.`
      : `Process exited (${signal || "code " + code}).`, "sys");
    if (bot.onStateChange) bot.onStateChange(bot.status);
  });

  if (bot.onStateChange) bot.onStateChange("running");
  log(bot.id, `Process started — ${plan.language} runtime is UP.`, "ok");
  return { ok: true };
}

/** Yellow Stop — pause the bot: process ends, bot stays on standby (quick resume). */
function stop(bot) {
  const rt = getRuntime(bot.id);
  if (!rt.proc) {
    if (rt.paused) return { ok: true }; // already on standby
    return { ok: false, error: "Bot is not running." };
  }
  const pid = rt.proc.pid;
  rt.stopIntent = "pause";
  log(bot.id, "Stop requested — pausing the bot (stays on standby)...", "sys");
  termTree(pid, "SIGTERM");
  // on Windows the graceful signal rarely reaches a node child of cmd.exe —
  // escalate automatically if the process is still alive after the grace period.
  setTimeout(() => {
    if (rt.proc && rt.proc.pid === pid) {
      log(bot.id, "Process ignored graceful stop — forcing termination.", "sys");
      killTree(pid);
    }
  }, 4000);
  return { ok: true };
}

/** Red Shutdown — normal close: graceful, then force kill after grace period. */
function shutdown(bot) {
  const rt = getRuntime(bot.id);
  if (!rt.proc) {
    if (rt.paused) { rt.paused = false; log(bot.id, "Shutdown — standby cleared, bot is fully off.", "sys"); return { ok: true }; }
    return { ok: false, error: "Bot is not running." };
  }
  const pid = rt.proc.pid;
  rt.stopIntent = "shutdown";
  log(bot.id, `Shutdown requested — force kill in ${SHUTDOWN_GRACE_MS / 1000}s if the process ignores SIGTERM.`, "sys");
  termTree(pid, "SIGTERM");
  setTimeout(() => {
    if (rt.proc && rt.proc.pid === pid) {
      log(bot.id, "Grace period over — force killing.", "sys");
      killTree(pid);
    }
  }, SHUTDOWN_GRACE_MS);
  return { ok: true };
}

/** Purple Kill — instant kill of the whole tree; the API then wipes the files (reset). */
function kill(bot) {
  const rt = getRuntime(bot.id);
  rt.paused = false;
  rt.stopIntent = null;
  if (!rt.proc) {
    log(bot.id, "KILL — no process running; files will be wiped for a fresh start.", "sys");
    return { ok: true };
  }
  log(bot.id, "KILL — terminating the whole process tree instantly, then wiping all files.", "sys");
  killTree(rt.proc.pid);
  return { ok: true };
}

function isRunning(botId) {
  const rt = runtimes.get(botId);
  return !!(rt && rt.proc);
}

function allRunning() {
  const list = [];
  for (const [id, rt] of runtimes) if (rt.proc) list.push(id);
  return list;
}

function recordMetric(botId, val) {
  try {
    if (!metricsHistory.has(botId)) metricsHistory.set(botId, []);
    const arr = metricsHistory.get(botId);
    arr.push({ t: Date.now(), cpu: Number(val.cpuPercent) || 0, mem: Number(val.memMB) || 0 });
    if (arr.length > 5000) arr.splice(0, arr.length - 5000);
  } catch (_) {}
}

function getMetricsHistory(botId, rangeSec) {
  const arr = metricsHistory.get(botId) || [];
  const now = Date.now();
  const cutoff = rangeSec ? now - rangeSec * 1000 : 0;
  return arr.filter((p) => p.t >= cutoff);
}

/* ---------------- live CPU / memory sampling ---------------- */

const metricsCache = new Map(); // botId -> { at, cpuSec, val }
const metricsHistory = new Map(); // botId -> Array<{ t, cpu, mem }>

/** Real CPU% (incremental) + RSS in MB for a running bot — cached 2.5s. */
function metrics(botId) {
  const rt = runtimes.get(botId);
  if (!rt || !rt.proc || !rt.proc.pid) return Promise.resolve({ cpuPercent: 0, memMB: 0 });
  const pid = rt.proc.pid;
  const now = Date.now();
  const prev = metricsCache.get(botId);
  if (prev && now - prev.at < 2500) return Promise.resolve(prev.val);

  const finish = (val, cpuSec) => {
    metricsCache.set(botId, { at: now, cpuSec, val });
    return val;
  };

  return new Promise((resolve) => {
    if (isWin) {
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        `Get-Process -Id ${pid} | Select-Object CPU,WorkingSet64 | ConvertTo-Json -Compress`],
        { timeout: 3500, windowsHide: true }, (err, stdout) => {
        if (err) {
          const val = { cpuPercent: 0, memMB: 0 };
          recordMetric(botId, val);
          return resolve(finish(val, undefined));
        }
        try {
          let j = JSON.parse(String(stdout).trim());
          if (Array.isArray(j)) j = j[0] || {};
          const cpuSec = typeof j.CPU === "number" ? j.CPU : undefined;
          const memMB = Math.round(((j.WorkingSet64 || 0) / 1048576) * 10) / 10;
          let cpuPercent = 0;
          if (typeof cpuSec === "number") {
            // lifetime average keeps truth even when short-window deltas
            // round to 0 (Windows timer granularity is 15.6ms)
            const ageSec = Math.max(1, (now - (rt.startedAt || now)) / 1000);
            const lifetime = (cpuSec / ageSec) * 100;
            if (prev && typeof prev.cpuSec === "number") {
              const dt = Math.max(0.5, (now - prev.at) / 1000);
              const delta = Math.max(0, ((cpuSec - prev.cpuSec) / dt) * 100);
              cpuPercent = delta > 0.05 ? delta : lifetime;
            } else cpuPercent = lifetime;
            const cap = 100 * Math.max(1, os.cpus().length);
            if (cpuPercent > cap) cpuPercent = cap;
          }
          const val = { cpuPercent: Math.round(cpuPercent * 10) / 10, memMB };
          recordMetric(botId, val);
          resolve(finish(val, cpuSec));
        } catch (_) {
          const val = { cpuPercent: 0, memMB: 0 };
          recordMetric(botId, val);
          resolve(finish(val, undefined));
        }
      });
    } else {
      execFile("ps", ["-o", "pcpu=,rss=", "-p", String(pid)], { timeout: 3500 }, (err, stdout) => {
        if (err) {
          const val = { cpuPercent: 0, memMB: 0 };
          recordMetric(botId, val);
          return resolve(finish(val, undefined));
        }
        const parts = String(stdout).trim().split(/\s+/);
        const val = {
          cpuPercent: Math.round((parseFloat(parts[0]) || 0) * 10) / 10,
          memMB: Math.round(((parseFloat(parts[1]) || 0) / 1024) * 10) / 10,
        };
        recordMetric(botId, val);
        resolve(finish(val, undefined));
      });
    }
  });
}

function status(botId) {
  const rt = getRuntime(botId);
  return {
    status: rt.proc ? rt.status : rt.status === "installing" ? "installing" : rt.paused ? "paused" : "stopped",
    startedAt: rt.startedAt,
    uptimeMs: rt.proc && rt.startedAt ? Date.now() - rt.startedAt : 0,
    exitCode: rt.exitCode,
    lastError: rt.lastError,
    installing: rt.status === "installing",
  };
}

module.exports = {
  start, stop, shutdown, kill, isRunning, allRunning, status, log, metrics,
  subscribe, unsubscribe, getRuntime, detectLanguage, resolveRunCommand,
  writeEnv: syncEnvFile,
  getMetricsHistory,
};
