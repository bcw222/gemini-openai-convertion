/**
 * Usage-mapping test: spins a mock Gemini upstream, points the worker at it, and
 * checks that `usageMetadata` is re-shaped to the OpenRouter / OpenAI Chat
 * Completions usage contract:
 *
 *   prompt_tokens      = promptTokenCount + toolUsePromptTokenCount
 *   completion_tokens  = candidatesTokenCount + thoughtsTokenCount
 *   total_tokens       = prompt_tokens + completion_tokens
 *   prompt_tokens_details.cached_tokens = cacheTokensDetails sum, else
 *                                         cachedContentTokenCount, else 0
 *   completion_tokens_details.reasoning_tokens = thoughtsTokenCount
 *   no cache_write_tokens (Gemini reports no cache writes)
 *
 *   NO_PROXY='*' no_proxy='*' node test/usage.mjs
 */
import { createServer } from "node:http";
import assert from "node:assert/strict";

/* ------------------------------------------------------------ mock upstream */

const sseline = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

// promptTokenCount already contains the cached content; toolUsePromptTokenCount
// is a separate input-side bucket; totalTokenCount is the upstream sum.
const USAGE = {
  details: {
    promptTokenCount: 100,
    candidatesTokenCount: 20,
    toolUsePromptTokenCount: 7,
    thoughtsTokenCount: 13,
    cacheTokensDetails: [
      { modality: "TEXT", tokenCount: 30 },
      { modality: "IMAGE", tokenCount: 10 },
    ],
    promptTokensDetails: [{ modality: "AUDIO", tokenCount: 5 }],
    totalTokenCount: 140,
  },
  fallback: {
    promptTokenCount: 100,
    candidatesTokenCount: 20,
    toolUsePromptTokenCount: 7,
    thoughtsTokenCount: 13,
    cachedContentTokenCount: 40,
    totalTokenCount: 140,
  },
  nocache: {
    promptTokenCount: 100,
    candidatesTokenCount: 20,
    thoughtsTokenCount: 13,
    totalTokenCount: 133,
  },
};

const caseOf = (body) => {
  const text = body?.contents?.at(-1)?.parts?.[0]?.text ?? "";
  if (text.includes("fallback")) return "fallback";
  if (text.includes("nocache")) return "nocache";
  return "details";
};

let lastPath = "";
const upstream = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    lastPath = req.url;
    const body = JSON.parse(raw || "{}");
    const usageMetadata = USAGE[caseOf(body)];

    if (req.url.includes("streamGenerateContent")) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(sseline({
        candidates: [{ content: { parts: [{ text: "PO" }], role: "model" }, finishReason: "UNSPECIFIED" }],
        modelVersion: "gemini-test",
      }));
      res.write(sseline({
        candidates: [{ content: { parts: [{ text: "NG" }], role: "model" }, finishReason: "STOP" }],
        usageMetadata,
        modelVersion: "gemini-test",
      }));
      res.end();
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      responseId: "resp_1",
      candidates: [{ content: { parts: [{ text: "PONG" }], role: "model" }, finishReason: "STOP" }],
      usageMetadata,
      modelVersion: "gemini-test",
    }));
  });
});

await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
process.env.GEMINI_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;

const worker = (await import("../src/worker.mjs")).default;

/* ------------------------------------------------------------------ helpers */

let passed = 0;
const ok = (cond, msg) => {
  if (!cond) throw new Error("FAIL: " + msg);
  passed++;
  console.log("  ok  " + msg);
};

const MODEL = "gemini-2.5-flash";

const call = (content, extra = {}) =>
  worker.fetch(new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-key" },
    body: JSON.stringify({ model: MODEL, max_tokens: 32, messages: [{ role: "user", content }], ...extra }),
  }));

const streamUsage = async (content, includeUsage) => {
  const res = await call(content, { stream: true, ...(includeUsage ? { stream_options: { include_usage: true } } : {}) });
  const events = (await res.text()).split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
  assert.equal(events.at(-1), "[DONE]", "stream must end with [DONE]");
  return events.slice(0, -1).map((e) => JSON.parse(e)).filter((o) => o.usage != null).map((o) => o.usage);
};

const noCacheWrite = (usage) =>
  !("prompt_tokens_details" in usage) || !("cache_write_tokens" in usage.prompt_tokens_details);

/* --------------------------------------------------------- non-stream cases */

console.log("\n[non-stream: cacheTokensDetails source]");
let detailsUsage;
{
  const json = await (await call("details")).json();
  const u = json.usage;
  detailsUsage = u;
  ok(u.prompt_tokens === 107, "prompt_tokens = promptTokenCount 100 + toolUsePromptTokenCount 7");
  ok(u.completion_tokens === 33, "completion_tokens = candidatesTokenCount 20 + thoughtsTokenCount 13 (no toolUsePrompt)");
  ok(u.total_tokens === 140 && u.total_tokens === u.prompt_tokens + u.completion_tokens, "total == prompt + completion == upstream totalTokenCount");
  ok(u.prompt_tokens_details.cached_tokens === 40, "cached_tokens = sum of cacheTokensDetails (30 + 10)");
  ok(u.prompt_tokens_details.audio_tokens === 5, "prompt audio_tokens preserved");
  ok(u.completion_tokens_details.reasoning_tokens === 13, "reasoning_tokens = thoughtsTokenCount");
  ok(noCacheWrite(u), "no cache_write_tokens invented");
  ok(lastPath.includes(":generateContent"), "non-stream hits :generateContent");
}

console.log("\n[non-stream: cachedContentTokenCount fallback]");
let fallbackUsage;
{
  const u = (await (await call("fallback")).json()).usage;
  fallbackUsage = u;
  ok(u.prompt_tokens === 107, "prompt_tokens still includes toolUsePromptTokenCount");
  ok(u.completion_tokens === 33, "completion_tokens unchanged");
  ok(u.total_tokens === u.prompt_tokens + u.completion_tokens, "total == prompt + completion");
  ok(u.prompt_tokens_details.cached_tokens === 40, "cached_tokens falls back to cachedContentTokenCount");
  ok(!("audio_tokens" in u.prompt_tokens_details), "no prompt audio details -> no audio_tokens key");
  ok(noCacheWrite(u), "no cache_write_tokens invented");
}

console.log("\n[non-stream: no cache info at all]");
{
  const u = (await (await call("nocache")).json()).usage;
  ok(u.prompt_tokens === 100, "prompt_tokens = promptTokenCount when no toolUsePrompt");
  ok(u.completion_tokens === 33, "completion_tokens = candidates + thoughts");
  ok(u.total_tokens === 133 && u.total_tokens === u.prompt_tokens + u.completion_tokens, "total == prompt + completion");
  ok(u.prompt_tokens_details.cached_tokens === 0, "cached_tokens defaults to 0");
  ok(noCacheWrite(u), "no cache_write_tokens invented");
}

/* ------------------------------------------------------------- stream cases */

console.log("\n[stream + include_usage]");
{
  const usages = await streamUsage("details", true);
  ok(usages.length === 1, "exactly one usage chunk");
  assert.deepEqual(usages[0], detailsUsage);
  ok(true, "stream usage is field-for-field identical to non-stream");
  ok(usages[0].prompt_tokens === 107 && usages[0].completion_tokens === 33, "stream buckets correct");
}

console.log("\n[stream + include_usage, fallback cached source]");
{
  const usages = await streamUsage("fallback", true);
  assert.deepEqual(usages[0], fallbackUsage);
  ok(true, "stream fallback usage matches non-stream");
}

console.log("\n[stream without include_usage]");
{
  const usages = await streamUsage("details", false);
  ok(usages.length === 0, "no usage chunk at all");
}

upstream.close();
console.log(`\nALL PASSED (${passed} assertions)`);
