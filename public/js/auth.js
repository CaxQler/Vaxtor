"use strict";
/* Vaxtor — auth page */

const $ = (id) => document.getElementById(id);
const errBox = $("authErr");

function showErr(msg) {
  if (!msg) { errBox.classList.remove("show"); return; }
  errBox.textContent = msg;
  errBox.classList.add("show");
}

function setMode(mode) {
  const signin = mode === "signin";
  $("formSignin").style.display = signin ? "" : "none";
  $("formSignup").style.display = signin ? "none" : "";
  $("tabSignin").classList.toggle("active", signin);
  $("tabSignup").classList.toggle("active", !signin);
  $("authTitle").textContent = signin ? "Welcome back." : "Create your account.";
  $("authSub").textContent = signin
    ? "Sign in to manage your bots and keep them online 24/7."
    : "Start with 1 free bot server · 7 days ncb. No card needed.";
  $("authFootLead").textContent = signin ? "New to Vaxtor?" : "Already have an account?";
  const tgl = $("linkAuthToggle");
  tgl.textContent = signin ? "Create an account" : "Sign in";
  tgl.dataset.target = signin ? "signup" : "signin";
  showErr("");
}

$("tabSignin").onclick = () => setMode("signin");
$("tabSignup").onclick = () => setMode("signup");
$("linkAuthToggle").onclick = (e) => { e.preventDefault(); setMode($("linkAuthToggle").dataset.target); };

if (new URLSearchParams(location.search).get("mode") === "signup") setMode("signup");
const urlErr = new URLSearchParams(location.search).get("error");
if (urlErr) showErr("Discord sign-in failed (" + urlErr + "). Try again.");

/* ---- sign in ---- */
$("formSignin").addEventListener("submit", async (e) => {
  e.preventDefault();
  showErr("");
  const btn = $("btnSignin");
  btn.disabled = true; btn.textContent = "Signing in...";
  const r = await api.post("/api/auth/login", { id: $("loginId").value.trim(), password: $("loginPass").value });
  btn.disabled = false; btn.textContent = "Sign in →";
  if (!r.ok) return showErr(r.error);
  toast("Welcome back, " + r.user.name + "!", "ok");
  setTimeout(() => (location.href = "/Overview"), 400);
});

/* ---- sign up ---- */
$("formSignup").addEventListener("submit", async (e) => {
  e.preventDefault();
  showErr("");
  const pass = $("regPass").value;
  const pass2 = $("regPass2").value;
  if (pass !== pass2) return showErr("Passwords do not match.");
  const btn = $("btnSignup");
  btn.disabled = true; btn.textContent = "Creating...";
  const r = await api.post("/api/auth/register", {
    name: $("regName").value.trim(),
    email: $("regEmail").value.trim(),
    password: pass,
    confirmPassword: pass2,
  });
  btn.disabled = false; btn.textContent = "Create account →";
  if (!r.ok) return showErr(r.error);
  toast("Account created. Welcome to Vaxtor, " + r.user.name + "!", "ok");
  setTimeout(() => (location.href = "/Overview"), 500);
});

/* ---- discord ---- */
$("btnDiscord").onclick = () => {
  location.href = "/api/auth/discord";
};

/* if already signed in, jump to dashboard */
(async () => {
  const me = await api.get("/api/auth/me");
  if (me.ok && me.user) location.href = "/Overview";
})();
