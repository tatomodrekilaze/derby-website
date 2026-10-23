// DERBY live tournament server.
// Holds the tournament state, checks the console password, and pushes every save
// to all open screens over Server-Sent Events. No dependencies: plain Node.
"use strict";
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 8787;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString("hex");
const DATA_FILE = process.env.DATA_FILE || path.join(require("os").tmpdir(), "derby-tournament.json");
const MAX_BODY = 256 * 1024;
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 3;

if (!ADMIN_PASSWORD) console.warn("[derby] ADMIN_PASSWORD is not set: nobody can log in to the console.");

/* ---------- state ---------- */
let state = { version: 0, updatedAt: null, data: null };
try {
  const saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  if (saved && typeof saved.version === "number") state = saved;
} catch (e) { /* first run */ }

function persist() {
  fs.writeFile(DATA_FILE, JSON.stringify(state), err => { if (err) console.error("[derby] save failed", err.message); });
}

/* ---------- auth ---------- */
const sha = s => crypto.createHash("sha256").update(String(s)).digest();
function passwordOk(input) {
  if (!ADMIN_PASSWORD) return false;
  return crypto.timingSafeEqual(sha(input), sha(ADMIN_PASSWORD));
}
const b64 = buf => Buffer.from(buf).toString("base64url");
function sign(payload) { return b64(crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest()); }
function makeToken() {
  const payload = b64(JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS, n: crypto.randomBytes(6).toString("hex") }));
  return payload + "." + sign(payload);
}
function tokenOk(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  const expect = sign(payload);
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return false;
  try { return JSON.parse(Buffer.from(payload, "base64url").toString()).exp > Date.now(); } catch (e) { return false; }
}

// a few wrong passwords per minute, per address
const attempts = new Map();
function tooMany(ip) {
  const now = Date.now(), list = (attempts.get(ip) || []).filter(t => now - t < 60_000);
  attempts.set(ip, list);
  return list.length >= 8;
}
function noteFail(ip) { (attempts.get(ip) || attempts.set(ip, []).get(ip)).push(Date.now()); }

/* ---------- live stream ---------- */
const clients = new Set();
function broadcast() {
  const msg = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) { try { res.write(msg); } catch (e) { clients.delete(res); } }
}
setInterval(() => { for (const res of clients) { try { res.write(": ping\n\n"); } catch (e) { clients.delete(res); } } }, 20_000);

/* ---------- http ---------- */
function send(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > MAX_BODY) { reject(new Error("too_large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch (e) { reject(new Error("bad_json")); } });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  // pages live on another origin (GitHub Pages / derbybilliards.com); auth is a bearer token, not a cookie
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, "http://x");
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();

  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/api/health")) {
      return send(res, 200, { ok: true, version: state.version, viewers: clients.size });
    }
    if (req.method === "GET" && url.pathname === "/api/state") return send(res, 200, state);

    if (req.method === "GET" && url.pathname === "/api/stream") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
      res.write("retry: 3000\n\n");
      res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      if (tooMany(ip)) return send(res, 429, { error: "too_many_attempts" });
      const body = await readBody(req);
      if (!passwordOk(body.password || "")) { noteFail(ip); return send(res, 401, { error: "wrong_password" }); }
      return send(res, 200, { token: makeToken() });
    }

    if (req.method === "POST" && url.pathname === "/api/state") {
      const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!tokenOk(token)) return send(res, 401, { error: "not_logged_in" });
      const body = await readBody(req);
      if (!body || typeof body.data !== "object" || body.data === null) return send(res, 400, { error: "no_data" });
      // two consoles open at once: refuse a save built on an old copy unless forced
      if (!body.force && typeof body.baseVersion === "number" && body.baseVersion !== state.version) {
        return send(res, 409, { error: "conflict", state });
      }
      state = { version: state.version + 1, updatedAt: new Date().toISOString(), data: body.data };
      persist();
      broadcast();
      return send(res, 200, { ok: true, version: state.version, updatedAt: state.updatedAt });
    }

    send(res, 404, { error: "not_found" });
  } catch (e) {
    send(res, e.message === "too_large" ? 413 : 400, { error: e.message || "bad_request" });
  }
});

server.listen(PORT, () => console.log(`[derby] live server on :${PORT}, ${clients.size} viewers, state v${state.version}`));
