const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function imageDataUrl(file, bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${file.type || "image/jpeg"};base64,${btoa(binary)}`;
}

function extractJson(content) {
  if (typeof content !== "string" || !content.trim()) throw new Error("empty_model_response");
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

function nutritionNumber(value, maximum) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(Math.min(maximum, Math.max(0, parsed)) * 10) / 10;
}

async function analyzeMeal(request, env) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!env.AI_API_KEY) return json({ error: "ai_not_configured" }, 503);

  const form = await request.formData();
  const image = form.get("image");
  if (!image || typeof image.arrayBuffer !== "function" || !String(image.type || "").startsWith("image/")) {
    return json({ error: "image_required" }, 400);
  }
  if (image.size > MAX_IMAGE_BYTES) return json({ error: "image_too_large" }, 413);

  const bytes = new Uint8Array(await image.arrayBuffer());
  const upstreamFetch = typeof env.AI_FETCH === "function" ? env.AI_FETCH : fetch;
  const upstream = await upstreamFetch(env.AI_API_URL || "https://yuangeluyou.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.AI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.AI_MODEL || "gpt-5.6-luna:stable",
      stream: false,
      max_tokens: 900,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "你是餐食营养估算助手。根据照片识别可见食物并估算可食重量与整餐营养。看不清时保守估算，不得声称精确。只返回 JSON，不要 Markdown。所有营养值必须是数字且不带单位。",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "分析这张餐食照片。返回字段：label（早餐/午餐/晚餐/加餐之一）、foods（中文食物名称和估算份量，用顿号分隔）、carbs（碳水克数）、protein（蛋白质克数）、fat（脂肪克数）、calories（千卡）。油、酱汁和隐藏配料无法判断时使用常见烹饪量估算。",
            },
            { type: "image_url", image_url: { url: imageDataUrl(image, bytes), detail: "low" } },
          ],
        },
      ],
    }),
  });

  if (!upstream.ok) return json({ error: "ai_upstream_failed" }, 502);
  const payload = await upstream.json();
  try {
    const result = extractJson(payload?.choices?.[0]?.message?.content);
    const carbs = nutritionNumber(result.carbs, 500);
    const protein = nutritionNumber(result.protein, 300);
    const fat = nutritionNumber(result.fat, 300);
    return json({
      label: ["早餐", "午餐", "晚餐", "加餐"].includes(result.label) ? result.label : "",
      foods: typeof result.foods === "string" ? result.foods.slice(0, 240) : "",
      carbs,
      protein,
      fat,
      calories: nutritionNumber(result.calories, 10_000) || Math.round(carbs * 4 + protein * 4 + fat * 9),
    });
  } catch {
    return json({ error: "invalid_ai_response" }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/analyze-meal") return analyzeMeal(request, env);

    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");

    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) {
      return response;
    }

    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};
