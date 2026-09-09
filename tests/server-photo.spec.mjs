import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";
import Database from "better-sqlite3";

const rootDir = path.resolve(import.meta.dirname, "..");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHealth(origin, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {
      // The server may still be opening the database or binding the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not become healthy");
}

test("authenticated photos round-trip from a Unicode data directory", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fitai-照片-"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: rootDir,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(port),
      DATA_DIR: dataDir,
      SESSION_SECRET: "server-photo-test-only",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForHealth(origin, child);

    const userId = crypto.randomUUID();
    const token = "server-photo-test-session";
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const now = Math.floor(Date.now() / 1000);
    const db = new Database(path.join(dataDir, "fitai.sqlite"));
    db.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)")
      .run(userId, "photo-test@example.test", now);
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(tokenHash, userId, now + 3600, now);
    db.close();

    const source = fs.readFileSync(path.join(rootDir, "public/assets/meal-lunch.png"));
    const form = new FormData();
    form.set("image", new Blob([source], { type: "image/png" }), "meal-lunch.png");
    const uploadResponse = await fetch(`${origin}/api/photos/roundtrip`, {
      method: "PUT",
      headers: { cookie: `fitai_session=${token}` },
      body: form,
    });
    assert.equal(uploadResponse.status, 200);

    const photoResponse = await fetch(`${origin}/api/photos/roundtrip`, {
      headers: { cookie: `fitai_session=${token}` },
    });
    assert.equal(photoResponse.status, 200);
    assert.equal(photoResponse.headers.get("content-type"), "image/png");
    assert.equal(photoResponse.headers.get("x-content-type-options"), "nosniff");
    assert.equal(photoResponse.headers.get("x-frame-options"), "DENY");
    assert.match(photoResponse.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.deepEqual(Buffer.from(await photoResponse.arrayBuffer()), source);

    const missingResponse = await fetch(`${origin}/api/photos/missing`, {
      headers: { cookie: `fitai_session=${token}` },
    });
    assert.equal(missingResponse.status, 404);
    assert.deepEqual(await missingResponse.json(), { error: "photo_not_found" });

    const oversized = new FormData();
    oversized.set("image", new Blob([Buffer.alloc(4 * 1024 * 1024 + 1)], { type: "image/jpeg" }), "large.jpg");
    const oversizedResponse = await fetch(`${origin}/api/photos/oversized`, {
      method: "PUT",
      headers: { cookie: `fitai_session=${token}` },
      body: oversized,
    });
    assert.equal(oversizedResponse.status, 413);
    assert.deepEqual(await oversizedResponse.json(), {
      error: "image_too_large",
      maxBytes: 4 * 1024 * 1024,
    });
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
