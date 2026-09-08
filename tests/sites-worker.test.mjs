import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import worker from "../worker/index.js";

test("serves existing static assets without a fallback", async () => {
  const calls = [];
  const response = await worker.fetch(new Request("https://example.test/assets/app.js"), {
    ASSETS: {
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200 });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/assets/app.js"]);
});

test("falls back to index.html for an unknown app route", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/flow/step-two?source=share", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async (request) => {
          const url = new URL(request.url);
          calls.push(url.pathname + url.search);
          return new Response(url.pathname === "/index.html" ? "app" : "missing", {
            status: url.pathname === "/index.html" ? 200 : 404,
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/flow/step-two?source=share", "/index.html"]);
});

test("does not turn missing API or write requests into the app shell", async () => {
  for (const request of [
    new Request("https://example.test/api/missing", { headers: { accept: "application/json" } }),
    new Request("https://example.test/flow", { method: "POST", headers: { accept: "text/html" } }),
  ]) {
    let calls = 0;
    const response = await worker.fetch(request, {
      ASSETS: {
        fetch: async () => {
          calls += 1;
          return new Response("missing", { status: 404 });
        },
      },
    });

    assert.equal(response.status, 404);
    assert.equal(calls, 1);
  }
});

test("analyzes a meal photo through the configured server-side model", async () => {
  const form = new FormData();
  form.append("image", new Blob(["image"], { type: "image/jpeg" }), "meal.jpg");
  let upstreamAuthorization = "";
  const response = await worker.fetch(
    new Request("https://example.test/api/analyze-meal", { method: "POST", body: form }),
    {
      AI_API_KEY: "test-secret",
      AI_FETCH: async (_url, options) => {
        upstreamAuthorization = options.headers.authorization;
        return Response.json({
          choices: [{ message: { content: '{"label":"午餐","foods":"米饭 150g、鸡胸肉 120g","carbs":45,"protein":38,"fat":9,"calories":413}' } }],
        });
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(upstreamAuthorization, "Bearer test-secret");
  assert.deepEqual(await response.json(), {
    label: "午餐",
    foods: "米饭 150g、鸡胸肉 120g",
    carbs: 45,
    protein: 38,
    fat: 9,
    calories: 413,
  });
});

test("keeps the AI key server-side and reports missing configuration", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/api/analyze-meal", { method: "POST", body: new FormData() }),
    {},
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "ai_not_configured" });
});

test("emits the files required by Sites packaging", async () => {
  await access(new URL("../dist/client/index.html", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
});
