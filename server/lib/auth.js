"use strict";
/**
 * Vaxtor — password hashing (scrypt) + session tokens.
 */
const crypto = require("crypto");
const { get, save } = require("./store");

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(password, salt, 64).toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(test, "hex"));
  } catch (_) {
    return false;
  }
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const d = get();
  if (!d.sessions) d.sessions = {};
  d.sessions[token] = { userId, at: Date.now() };
  save();
  return token;
}

function getSession(token) {
  const d = get();
  if (!d.sessions) d.sessions = {};
  const s = d.sessions[token];
  if (!s) return null;
  const user = d.users[s.userId];
  if (!user) { delete d.sessions[token]; return null; }
  return { token, userId: s.userId, user };
}

function destroySession(token) {
  const d = get();
  if (d.sessions && d.sessions[token]) {
    delete d.sessions[token];
    save();
    return true;
  }
  return false;
}

/** Kick every session of a user (admin "kick sign in"). */
function destroyUserSessions(userId) {
  const d = get();
  let n = 0;
  if (d.sessions) {
    for (const [t, s] of Object.entries(d.sessions)) {
      if (s.userId === userId) { delete d.sessions[t]; n++; }
    }
    save();
  }
  return n;
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  getSession,
  destroySession,
  destroyUserSessions,
};
