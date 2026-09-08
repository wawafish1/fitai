import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import multer from "multer";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "dist", "client");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, ".data"));
const photoDir = path.join(dataDir, "photos");
fs.mkdirSync(photoDir, { recursive: true });

const app = express();
const port = Number(process.env.PORT || 3000);
const maxImageBytes = 4 * 1024 * 1024;
const dailyAnalysisLimit = Number(process.env.DAILY_ANALYSIS_LIMIT || 10);
const codeTtlMinutes = Number(process.env.LOGIN_CODE_EXPIRY_MINUTES || 10);
const sessionDays = Number(process.env.SESSION_DAYS || 30);
const configuredOrigin = (process.env.APP_ORIGIN || "").replace(/\/$/, "");
const production = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

if (production && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required in production");
}

if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

const db = new Database(path.join(dataDir, "fitai.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS login_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    requested_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    consumed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_login_codes_email_requested
    ON login_codes(email, requested_at DESC);
  CREATE TABLE IF NOT EXISTS auth_request_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_hash TEXT NOT NULL,
    requested_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_auth_request_log_ip_time
    ON auth_request_log(ip_hash, requested_at DESC);
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS user_data (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS analysis_usage (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day_key TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day_key)
  );
  CREATE TABLE IF NOT EXISTS photos (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
  );
`);
db.pragma("optimize");

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const codeHash = (email, code) => crypto.createHmac("sha256", sessionSecret).update(`${email}:${code}`).digest("hex");
const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const validEmail = (email) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const nowSeconds = () => Math.floor(Date.now() / 1000);
const beijingDay = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

function sameOriginOnly(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (origin && configuredOrigin && origin !== configuredOrigin) {
    return res.status(403).json({ error: "invalid_origin" });
  }
  next();
}
app.use("/api", sameOriginOnly);
app.use("/api", (_req, res, next) => {
  res.set("cache-control", "no-store");
  next();
});

function currentUser(req) {
  const token = req.cookies.fitai_session;
  if (!token) return null;
  return db.prepare(`
    SELECT users.id, users.email
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hash(token), nowSeconds()) || null;
}

function requireUser(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "authentication_required" });
  req.user = user;
  next();
}

function setSession(res, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = nowSeconds();
  const expiresAt = now + sessionDays * 86400;
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(hash(token), userId, expiresAt, now);
  res.cookie("fitai_session", token, {
    httpOnly: true,
    secure: production,
    sameSite: "lax",
    path: "/",
    maxAge: sessionDays * 86400 * 1000,
  });
}

async function sendLoginCode(email, code) {
  const required = [
    "TENCENT_SES_SECRET_ID", "TENCENT_SES_SECRET_KEY", "TENCENT_SES_FROM",
    "TENCENT_SES_TEMPLATE_ID", "TENCENT_SES_REGION",
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing SES configuration: ${missing.join(", ")}`);
  const host = "ses.tencentcloudapi.com";
  const service = "ses";
  const action = "SendEmail";
  const timestamp = nowSeconds();
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const body = JSON.stringify({
    FromEmailAddress: process.env.TENCENT_SES_FROM,
    Destination: [email],
    Template: {
      TemplateID: Number(process.env.TENCENT_SES_TEMPLATE_ID),
      TemplateData: JSON.stringify({ code }),
    },
  });
  const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
  const hmac = (key, value) => crypto.createHmac("sha256", key).update(value).digest();
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = "content-type;host;x-tc-action";
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(body)}`;
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256(canonicalRequest)}`;
  const secretDate = hmac(`TC3${process.env.TENCENT_SES_SECRET_KEY}`, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = crypto.createHmac("sha256", secretSigning).update(stringToSign).digest("hex");
  const authorization = `TC3-HMAC-SHA256 Credential=${process.env.TENCENT_SES_SECRET_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(`https://${host}`, {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json; charset=utf-8",
      host,
      "x-tc-action": action,
      "x-tc-region": process.env.TENCENT_SES_REGION,
      "x-tc-timestamp": String(timestamp),
      "x-tc-version": "2020-10-02",
    },
    body,
  });
  const result = await response.json();
  if (!response.ok || result?.Response?.Error) {
    throw new Error(result?.Response?.Error?.Message || `Tencent SES HTTP ${response.status}`);
  }
}

app.post("/api/auth/request-code", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!validEmail(email)) return res.status(400).json({ error: "invalid_email" });
  const now = nowSeconds();
  const ipHash = hash(req.ip || req.socket.remoteAddress || "unknown");
  const recentIpRequests = db.prepare("SELECT COUNT(*) AS count FROM auth_request_log WHERE ip_hash = ? AND requested_at > ?")
    .get(ipHash, now - 3600).count;
  if (recentIpRequests >= 20) return res.status(429).json({ error: "code_requested_too_often", retryAfter: 3600 });
  const recent = db.prepare("SELECT requested_at FROM login_codes WHERE email = ? ORDER BY requested_at DESC LIMIT 1").get(email);
  if (recent && now - recent.requested_at < 60) {
    return res.status(429).json({ error: "code_requested_too_often", retryAfter: 60 - (now - recent.requested_at) });
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  db.prepare("INSERT INTO auth_request_log (ip_hash, requested_at) VALUES (?, ?)").run(ipHash, now);
  const result = db.prepare(`
    INSERT INTO login_codes (email, code_hash, requested_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(email, codeHash(email, code), now, now + codeTtlMinutes * 60);
  try {
    await sendLoginCode(email, code);
    res.json({ ok: true, expiresIn: codeTtlMinutes * 60 });
  } catch (error) {
    db.prepare("DELETE FROM login_codes WHERE id = ?").run(result.lastInsertRowid);
    console.error("SES send failed", error?.message || error);
    res.status(502).json({ error: "email_send_failed" });
  }
});

app.post("/api/auth/verify-code", (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || "").trim();
  if (!validEmail(email) || !/^\d{6}$/.test(code)) return res.status(400).json({ error: "invalid_code" });
  const record = db.prepare(`
    SELECT * FROM login_codes WHERE email = ? AND consumed_at IS NULL
    ORDER BY requested_at DESC LIMIT 1
  `).get(email);
  if (!record || record.expires_at <= nowSeconds() || record.attempts >= 5) {
    return res.status(400).json({ error: "code_expired" });
  }
  const expected = Buffer.from(record.code_hash, "hex");
  const supplied = Buffer.from(codeHash(email, code), "hex");
  if (!crypto.timingSafeEqual(expected, supplied)) {
    db.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?").run(record.id);
    return res.status(400).json({ error: "invalid_code" });
  }
  const now = nowSeconds();
  db.prepare("UPDATE login_codes SET consumed_at = ? WHERE id = ?").run(now, record.id);
  db.prepare("INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?, ?, ?)")
    .run(crypto.randomUUID(), email, now);
  const user = db.prepare("SELECT id, email FROM users WHERE email = ?").get(email);
  setSession(res, user.id);
  const usage = db.prepare("SELECT count FROM analysis_usage WHERE user_id = ? AND day_key = ?")
    .get(user.id, beijingDay());
  res.json({
    user: { email: user.email },
    analysis: { used: usage?.count || 0, limit: dailyAnalysisLimit },
  });
});

app.get("/api/auth/me", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "authentication_required" });
  const usage = db.prepare("SELECT count FROM analysis_usage WHERE user_id = ? AND day_key = ?")
    .get(user.id, beijingDay());
  res.json({ user: { email: user.email }, analysis: { used: usage?.count || 0, limit: dailyAnalysisLimit } });
});

app.post("/api/auth/logout", requireUser, (req, res) => {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash(req.cookies.fitai_session));
  res.clearCookie("fitai_session", { path: "/" });
  res.json({ ok: true });
});

app.get("/api/data", requireUser, (req, res) => {
  const record = db.prepare("SELECT data_json, updated_at FROM user_data WHERE user_id = ?").get(req.user.id);
  res.json({ data: record ? JSON.parse(record.data_json) : null, updatedAt: record?.updated_at || null });
});

app.put("/api/data", requireUser, (req, res) => {
  const serialized = JSON.stringify(req.body?.data ?? null);
  if (serialized === "null" || Buffer.byteLength(serialized) > 1_500_000) {
    return res.status(400).json({ error: "invalid_data" });
  }
  const now = nowSeconds();
  db.prepare(`
    INSERT INTO user_data (user_id, data_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
  `).run(req.user.id, serialized, now);
  res.json({ ok: true, updatedAt: now });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxImageBytes, files: 1 },
  fileFilter: (_req, file, done) => done(null, file.mimetype.startsWith("image/")),
});

function safePhotoId(value) {
  const id = String(value || "");
  return /^[a-zA-Z0-9_-]{1,100}$/.test(id) ? id : null;
}

app.put("/api/photos/:id", requireUser, upload.single("image"), (req, res) => {
  const id = safePhotoId(req.params.id);
  if (!id || !req.file) return res.status(400).json({ error: "image_required" });
  const old = db.prepare("SELECT file_name FROM photos WHERE user_id = ? AND id = ?").get(req.user.id, id);
  const fileName = `${hash(`${req.user.id}:${id}`)}.img`;
  fs.writeFileSync(path.join(photoDir, fileName), req.file.buffer);
  db.prepare(`
    INSERT INTO photos (id, user_id, file_name, mime_type, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, id) DO UPDATE SET file_name = excluded.file_name, mime_type = excluded.mime_type
  `).run(id, req.user.id, fileName, req.file.mimetype, nowSeconds());
  if (old?.file_name && old.file_name !== fileName) fs.rmSync(path.join(photoDir, old.file_name), { force: true });
  res.json({ ok: true });
});

app.get("/api/photos/:id", requireUser, (req, res) => {
  const id = safePhotoId(req.params.id);
  const record = id && db.prepare("SELECT file_name, mime_type FROM photos WHERE user_id = ? AND id = ?").get(req.user.id, id);
  if (!record) return res.status(404).json({ error: "photo_not_found" });
  res.type(record.mime_type).sendFile(path.join(photoDir, record.file_name));
});

function imageDataUrl(file) {
  return `data:${file.mimetype || "image/jpeg"};base64,${file.buffer.toString("base64")}`;
}

function extractJson(content) {
  if (typeof content !== "string" || !content.trim()) throw new Error("empty_model_response");
  return JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
}

function nutritionNumber(value, maximum) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(Math.min(maximum, Math.max(0, parsed)) * 10) / 10;
}

const reserveAnalysis = db.transaction((userId, dayKey) => {
  db.prepare("INSERT OR IGNORE INTO analysis_usage (user_id, day_key, count) VALUES (?, ?, 0)").run(userId, dayKey);
  const row = db.prepare("SELECT count FROM analysis_usage WHERE user_id = ? AND day_key = ?").get(userId, dayKey);
  if (row.count >= dailyAnalysisLimit) return null;
  db.prepare("UPDATE analysis_usage SET count = count + 1 WHERE user_id = ? AND day_key = ?").run(userId, dayKey);
  return row.count + 1;
});

app.post("/api/analyze-meal", requireUser, upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "image_required" });
  if (!process.env.AI_API_KEY) return res.status(503).json({ error: "ai_not_configured" });
  const dayKey = beijingDay();
  const used = reserveAnalysis(req.user.id, dayKey);
  if (used === null) return res.status(429).json({ error: "daily_limit_reached", used: dailyAnalysisLimit, limit: dailyAnalysisLimit });
  try {
    const upstream = await fetch(process.env.AI_API_URL || "https://yuangeluyou.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.AI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.AI_MODEL || "gpt-5.6-terra:stable",
        stream: false,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "你是餐食营养估算助手。根据照片识别可见食物并估算可食重量与整餐营养。看不清时保守估算，不得声称精确。只返回 JSON，不要 Markdown。所有营养值必须是数字且不带单位。" },
          { role: "user", content: [
            { type: "text", text: "分析这张餐食照片。返回字段：label（早餐/午餐/晚餐/加餐之一）、foods（中文食物名称和估算份量，用顿号分隔）、carbs（碳水克数）、protein（蛋白质克数）、fat（脂肪克数）、calories（千卡）。油、酱汁和隐藏配料无法判断时使用常见烹饪量估算。" },
            { type: "image_url", image_url: { url: imageDataUrl(req.file), detail: "low" } },
          ] },
        ],
      }),
    });
    if (!upstream.ok) throw new Error(`AI upstream ${upstream.status}`);
    const payload = await upstream.json();
    const result = extractJson(payload?.choices?.[0]?.message?.content);
    const carbs = nutritionNumber(result.carbs, 500);
    const protein = nutritionNumber(result.protein, 300);
    const fat = nutritionNumber(result.fat, 300);
    res.json({
      label: ["早餐", "午餐", "晚餐", "加餐"].includes(result.label) ? result.label : "",
      foods: typeof result.foods === "string" ? result.foods.slice(0, 240) : "",
      carbs, protein, fat,
      calories: nutritionNumber(result.calories, 10_000) || Math.round(carbs * 4 + protein * 4 + fat * 9),
      analysis: { used, limit: dailyAnalysisLimit },
    });
  } catch (error) {
    db.prepare("UPDATE analysis_usage SET count = MAX(0, count - 1) WHERE user_id = ? AND day_key = ?").run(req.user.id, dayKey);
    console.error("AI analysis failed", error?.message || error);
    res.status(502).json({ error: "ai_upstream_failed" });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use(express.static(publicDir, { index: false, maxAge: production ? "1h" : 0 }));
app.use((_req, res) => res.sendFile(path.join(publicDir, "index.html")));

db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(nowSeconds());
db.prepare("DELETE FROM login_codes WHERE requested_at < ?").run(nowSeconds() - 86400);
db.prepare("DELETE FROM auth_request_log WHERE requested_at < ?").run(nowSeconds() - 86400);
app.listen(port, "0.0.0.0", () => console.log(`FitAI listening on ${port}`));
