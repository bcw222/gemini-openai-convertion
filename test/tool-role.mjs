/**
 * Tool response role regression test.
 *
 * Gemini now validates Content.role and rejects "function" with:
 *   [400] Role 'function' is not supported. Please use a valid role:
 *   SYSTEM, SYSTEM_1, USER, ASSISTANT, DEVELOPER, CONTEXT, USER_CONTEXT,
 *   MODEL, USER.
 *
 * The converter grouped consecutive tool results into a content marked
 * role: "function" assuming the field was ignored. Tool responses must be
 * converted to role "user" with functionResponse parts instead; consecutive
 * tool results still merge into one content, and a user text message after
 * them must stay separate.
 *
 *   NO_PROXY='*' no_proxy='*' node test/tool-role.mjs
 */
import { createServer } from "node:http";
import assert from "node:assert/strict";

/* ------------------------------------------------------------ mock upstream */

let lastBody;
const upstream = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    lastBody = JSON.parse(raw || "{}");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      responseId: "resp_tool_role",
      candidates: [{ content: { parts: [{ text: "OK" }], role: "model" }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
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

const send = async (payload) => {
  lastBody = undefined;
  const res = await worker.fetch(new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-key" },
    body: JSON.stringify({ model: MODEL, max_tokens: 16, ...payload }),
  }));
  await res.text();
  assert.ok(lastBody, "upstream must receive a body");
  return lastBody;
};

/* ------------------------------------------------------------------- cases */

console.log("\n[tool results ride under role user]");
{
  const body = await send({
    messages: [
      { role: "user", content: "weather in a and b?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_a", type: "function", function: { name: "get_weather", arguments: '{"city":"a"}' } },
          { id: "call_b", type: "function", function: { name: "get_weather", arguments: '{"city":"b"}' } },
        ],
      },
      { role: "tool", tool_call_id: "call_a", content: '{"temp":20}' },
      { role: "tool", tool_call_id: "call_b", content: '{"temp":25}' },
    ],
  });
  const contents = body.contents;
  ok(contents.every((c) => c.role !== "function"), "no outbound content carries role 'function'");
  const toolContent = contents[2];
  ok(toolContent.role === "user", "tool responses use role 'user'");
  const fnParts = toolContent.parts.filter((p) => p.functionResponse);
  assert.equal(fnParts.length, 2, "two functionResponse parts");
  ok(fnParts[0].functionResponse.name === "get_weather"
     && fnParts[1].functionResponse.name === "get_weather",
     "both tool_call_ids resolved and merged into one content");
  ok(toolContent.parts[0].functionResponse.response.temp === 20, "first response payload intact");
  ok(toolContent.parts[1].functionResponse.response.temp === 25, "second response payload intact");
}

console.log("\n[trailing user text does not merge into tool responses]");
{
  const body = await send({
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: null, tool_calls: [
        { id: "call_x", type: "function", function: { name: "ping", arguments: "{}" } },
      ] },
      { role: "tool", tool_call_id: "call_x", content: '{"pong":true}' },
      { role: "user", content: "thanks" },
    ],
  });
  const contents = body.contents;
  ok(contents[2].role === "user"
     && contents[2].parts.some((p) => p.functionResponse),
     "tool response content precedes trailing user msg");
  ok(contents[3].role === "user"
     && contents[3].parts.length === 1
     && contents[3].parts[0].text === "thanks",
     "trailing user text is its own content, not merged");
}

console.log("\n" + passed + " assertions passed");

console.log("\n[synthetic first content keeps parts an array]");
{
  const body = await send({
    messages: [
      { role: "system", content: "sys" },
      { role: "assistant", content: null, tool_calls: [
        { id: "call_a", type: "function", function: { name: "ping", arguments: "{}" } },
      ] },
      { role: "tool", tool_call_id: "call_a", content: '{"pong":true}' },
    ],
  });
  const c0 = body.contents[0];
  ok(Array.isArray(c0?.parts), "spacer content parts is an array, not an object");
  ok(c0.parts[0]?.text === " ", "spacer content carries a blank text part");
}

console.log("\n" + passed + " assertions passed");
upstream.close();
process.exit(0);
