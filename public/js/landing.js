"use strict";
/* Vaxtor landing */

const PLANS_FALLBACK = [
  { id: "free", name: "Free", servers: 1, days: 7, price: 0, color: "#8b95a7", perks: ["1 Bot Server", "7 days NCB runtime", "Community support", "Node.js & Python runtime"] },
  { id: "plus", name: "Plus", servers: 3, days: 10, price: 79, color: "#22d3ee", perks: ["3 Bot Servers", "10 days NCB runtime", "Priority CPU", "Auto npm/pip install", "Live console"] },
  { id: "pro", name: "Pro", servers: 5, days: 18, price: 149, color: "#a855f7", perks: ["5 Bot Servers", "18 days NCB runtime", "High priority CPU", "Daily backup", "24/7 uptime watcher"] },
  { id: "max", name: "Max Vaxtor", servers: 10, days: 30, price: 249, color: "#f59e0b", perks: ["10 Bot Servers", "30 days NCB runtime", "Dedicated resources", "Priority support", "Everything unlocked"] },
];

function renderPlans(plans) {
  const grid = document.getElementById("planGrid");
  grid.innerHTML = plans.map((p, i) => `
    <div class="plan ${i === 2 ? "featured" : ""}">
      ${i === 2 ? '<span class="tag badge violet">POPULAR</span>' : ""}
      <div class="pname" style="color:${p.color}">${p.name}</div>
      <div class="card-sub">${p.servers} server${p.servers > 1 ? "s" : ""} · ${p.days} days ncb</div>
      <div class="price">${p.price === 0 ? "฿0" : "฿" + p.price}<small>${p.price === 0 ? " forever" : " / rank"}</small></div>
      <ul>${p.perks.map((x) => `<li>${x}</li>`).join("")}</ul>
      <a class="btn ${i === 2 ? "primary" : ""} block" href="/auth">Get ${p.name}</a>
    </div>
  `).join("");
}

async function init() {
  let plans = PLANS_FALLBACK;
  try {
    const r = await fetch("/api/plans");
    const j = await r.json();
    if (j.ok && j.plans) plans = j.plans;
  } catch (_) {}
  renderPlans(plans);

  // if signed in, dashboard button becomes the main action
  try {
    const me = await fetch("/api/auth/me").then((r) => r.json());
    if (me.ok && me.user) {
      const nav = document.getElementById("navDash");
      nav.innerHTML = ico("grid", 14) + " " + String(me.user.name).replace(/[<>&\"]/g, "");
      nav.classList.add("primary");
      const start = document.querySelector('.hero-cta a.btn.white');
      if (start) start.textContent = "Go to dashboard →";
    }
  } catch (_) {}
}
init();
