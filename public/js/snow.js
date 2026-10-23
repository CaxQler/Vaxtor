"use strict";
/* Vaxtor — soft falling-snow background. Lightweight canvas, respects reduced motion. */
(function () {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const canvas = document.createElement("canvas");
  canvas.className = "snow-canvas";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  let W = 0, H = 0, flakes = [], dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const target = Math.round(Math.min(90, Math.max(35, W / 18)));
    flakes = Array.from({ length: target }, () => spawn(true));
  }

  function spawn(anywhere) {
    return {
      x: Math.random() * W,
      y: anywhere ? Math.random() * H : -8,
      r: 0.6 + Math.random() * 1.9,
      vy: 0.25 + Math.random() * 0.75,
      drift: (Math.random() - 0.5) * 0.5,
      phase: Math.random() * Math.PI * 2,
      a: 0.10 + Math.random() * 0.30,
    };
  }

  let raf = null, last = 0;
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (t - last < 33) return; // ~30fps is plenty for snow
    const dt = Math.min(64, t - last) / 16.7; last = t;
    ctx.clearRect(0, 0, W, H);
    for (let f of flakes) {
      f.phase += 0.012 * dt;
      f.y += f.vy * dt;
      f.x += (Math.sin(f.phase) * 0.6 + f.drift) * dt;
      if (f.y > H + 6 || f.x < -10 || f.x > W + 10) Object.assign(f, spawn(false), { x: Math.random() * W });
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(226, 225, 255, ${f.a})`;
      ctx.fill();
    }
  }

  window.addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = null; }
    else if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
  });

  resize();
  raf = requestAnimationFrame(frame);
})();
