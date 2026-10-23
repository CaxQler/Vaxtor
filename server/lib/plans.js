"use strict";
/**
 * Vaxtor — plans & ranks ("ncb" = Not Close Bot, time only counts
 * while a bot is actually RUNNING).
 *
 * Free        : 1 server,  7 days
 * Plus        : 3 servers, 10 days  (79 ฿)
 * Pro         : 5 servers, 18 days  (149 ฿)
 * Max Vaxtor  : 10 servers, 30 days (249 ฿)
 */
const PLANS = {
  free: { id: "free", name: "Free",        servers: 1,  days: 7,  price: 0,   color: "#8b95a7", limits: { cpu: 25, memMB: 256 },  perks: ["1 Bot Server", "7 days NCB runtime", "256 MB RAM · 25% CPU", "Community support", "Node.js & Python runtime"] },
  plus: { id: "plus", name: "Plus",        servers: 3,  days: 10, price: 79,  color: "#22d3ee", limits: { cpu: 50, memMB: 512 },  perks: ["3 Bot Servers", "10 days NCB runtime", "512 MB RAM · 50% CPU", "Auto npm/pip install", "Live console"] },
  pro:  { id: "pro",  name: "Pro",         servers: 5,  days: 18, price: 149, color: "#a855f7", limits: { cpu: 100, memMB: 1024 }, perks: ["5 Bot Servers", "18 days NCB runtime", "1 GB RAM · 100% CPU", "Daily backup", "24/7 uptime watcher"] },
  max:  { id: "max",  name: "Max Vaxtor",  servers: 10, days: 30, price: 249, color: "#f59e0b", limits: { cpu: 200, memMB: 2048 }, perks: ["10 Bot Servers", "30 days NCB runtime", "2 GB RAM · 200% CPU", "Dedicated resources", "Everything unlocked"] },
  // not sold publicly — only the special DEV key grants it (see keyserver)
  dev:  { id: "dev",  name: "Dev Unlimited", servers: 999, days: 999999, price: 0, color: "#22d3ee", limits: { cpu: -1, memMB: -1 }, perks: ["999 Bot Servers", "999999 days NCB runtime", "Unlimited CPU & RAM", "Everything unlocked", "Dev key only"] },
};

const RANK_ORDER = ["free", "plus", "pro", "max"];

const DAY_SECONDS = 24 * 60 * 60;

function plan(id) { return PLANS[id] || PLANS.free; }
function maxServers(id) { return plan(id).servers; }

/** How many seconds of paid "ncb" runtime this rank grants. */
function rankSeconds(id) { return plan(id).days * DAY_SECONDS; }

function publicPlan(p) {
  return { id: p.id, name: p.name, servers: p.servers, days: p.days, price: p.price, color: p.color, perks: p.perks, limits: p.limits };
}

function publicPlans() {
  return RANK_ORDER.map((id) => publicPlan(PLANS[id]));
}

/** Seconds formatted as "2d 03h 12m". */
function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / DAY_SECONDS);
  const h = Math.floor((sec % DAY_SECONDS) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

module.exports = { PLANS, RANK_ORDER, plan, maxServers, rankSeconds, publicPlans, publicPlan, fmtDuration, DAY_SECONDS };
