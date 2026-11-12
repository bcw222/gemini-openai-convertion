/**
 * Tool / response-format schema compatibility test.
 *
 * Gemini's `Schema` is a restricted subset of JSON Schema: unknown keywords are
 * rejected with HTTP 400. This test points the worker at a mock upstream that
 * captures the outbound body, then asserts that tool parameters and structured
 * output schemas are sanitized:
 *
 *   - `const: "foo"`                 -> `enum: ["foo"]` (const removed)
 *   - non-string `const`             -> dropped entirely (enum is repeated string)
 *   - unknown keywords               -> dropped ($schema, $defs, oneOf, ...)
 *   - `type: ["string", "null"]`     -> `type: "string"` + `nullable: true`
 *   - `examples: [x]`                -> `example: x`
 *   - `default` / `example` instance data is never filtered
 *
 *   NO_PROXY='*' no_proxy='*' node test/schema.mjs
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
      responseId: "resp_schema",
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
    body: JSON.stringify({ model: MODEL, max_tokens: 16, messages: [{ role: "user", content: "hi" }], ...payload }),
  }));
  await res.text();
  assert.ok(lastBody, "upstream must receive a body");
  return lastBody;
};

const toolRequest = (parameters) =>
  send({ tools: [{ type: "function", function: { name: "f", description: "d", parameters } }] });

const fnParams = (body) => body.tools[0].function_declarations[0].parameters;

/* --------------------------------------------------- 1. const -> enum (owner) */

console.log("\n[const -> enum, nested items]");
{
  // Shape from the reported failure: properties.X.items.properties.Y.const
  const body = await toolRequest({
    type: "object",
    $schema: "https://json-schema.org/draft/2020-12/schema",
    properties: {
      list: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", const: "foo" },
          },
          required: ["kind"],
        },
      },
    },
    required: ["list"],
    additionalProperties: false,
  });
  const kind = fnParams(body).properties.list.items.properties.kind;
  ok(!("const" in kind), "const removed from properties.X.items.properties.Y");
  assert.deepEqual(kind.enum, ["foo"]);
  ok(true, "const 'foo' became enum ['foo']");
  ok(fnParams(body).properties.list.items.properties.kind.type === "string", "sibling type preserved");
}

console.log("\n[const -> enum, does not clobber existing enum]");
{
  const kind = fnParams(await toolRequest({
    type: "object",
    properties: { kind: { type: "string", const: "foo", enum: ["foo", "bar"] } },
  })).properties.kind;
  assert.deepEqual(kind.enum, ["foo", "bar"]);
  ok(true, "existing enum kept, const removed");
}

/* ------------------------------------------------- 2. nested array items const */

console.log("\n[nested arrays: inner const converted]");
{
  const body = await toolRequest({
    type: "object",
    properties: {
      matrix: {
        type: "array",
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { tag: { type: "string", const: "leaf" } },
          },
        },
      },
    },
  });
  const tag = fnParams(body).properties.matrix.items.items.properties.tag;
  assert.deepEqual(tag.enum, ["leaf"]);
  ok(!("const" in tag), "const at array-of-array items converted to enum");
}

/* ------------------------------------------------ 3. non-string const dropped */

console.log("\n[non-string const dropped from enum]");
{
  const body = await toolRequest({
    type: "object",
    properties: {
      n: { type: "integer", const: 42 },
      b: { type: "boolean", const: true },
      o: { type: "object", const: { a: 1 } },
    },
  });
  for (const [key, name] of [["n", "number"], ["b", "boolean"], ["o", "object"]]) {
    const prop = fnParams(body).properties[key];
    ok(!("const" in prop), `const removed from ${name} constant`);
    ok(!("enum" in prop), `no enum injected for ${name} constant`);
  }
}

/* ------------------------------------------------ 4. unknown keywords dropped */

console.log("\n[unknown keywords dropped]");
{
  const body = await toolRequest({
    type: "object",
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:x",
    $defs: { Foo: { type: "string" } },
    definitions: { Bar: { type: "string" } },
    additionalProperties: false,
    patternProperties: { "^x": { type: "string" } },
    unevaluatedProperties: false,
    properties: {
      a: {
        type: "string",
        oneOf: [{ const: "x" }, { const: "y" }],
        allOf: [{ type: "string" }],
        exclusiveMinimum: 1,
        exclusiveMaximum: 9,
        readOnly: true,
        writeOnly: false,
        deprecated: true,
        $comment: "note",
      },
    },
  });
  const top = fnParams(body);
  const banned = [
    "$schema", "$id", "$defs", "definitions", "additionalProperties",
    "patternProperties", "unevaluatedProperties",
  ];
  for (const key of banned) {
    ok(!(key in top), `top-level ${key} dropped`);
  }
  const a = top.properties.a;
  for (const key of ["oneOf", "allOf", "exclusiveMinimum", "exclusiveMaximum", "readOnly", "writeOnly", "deprecated", "$comment"]) {
    ok(!(key in a), `nested ${key} dropped`);
  }
  ok(a.type === "string" && a.description === undefined, "known keywords survive");
}

/* --------------------------------------------- 5. type array -> nullable */

console.log("\n[type array -> nullable]");
{
  const body = await toolRequest({
    type: "object",
    properties: {
      s: { type: ["string", "null"] },
      u: { type: ["string", "integer", "null"] },
      onlyNull: { type: ["null"] },
    },
  });
  const p = fnParams(body).properties;
  ok(p.s.type === "string" && p.s.nullable === true, "['string','null'] -> type string + nullable");
  ok(!("type" in p.u), "multi-type drops type");
  assert.deepEqual(p.u.anyOf, [{ type: "string" }, { type: "integer" }]);
  ok(p.u.nullable === true, "multi-type keeps nullable marker");
  ok(!("type" in p.onlyNull), "['null'] alone drops type");
  ok(p.onlyNull.nullable === true, "['null'] alone sets nullable");
}

/* ---------------------------------- 6. default/example instance data intact */

console.log("\n[default/example instance data not filtered]");
{
  const body = await toolRequest({
    type: "object",
    properties: {
      cfg: {
        type: "object",
        default: { const: 1, foo: 2 },
        example: { const: "keep", oneOf: true },
        properties: { mode: { type: "string" } },
      },
    },
  });
  const cfg = fnParams(body).properties.cfg;
  assert.deepEqual(cfg.default, { const: 1, foo: 2 });
  ok(true, "default object kept verbatim (const/foo not stripped)");
  assert.deepEqual(cfg.example, { const: "keep", oneOf: true });
  ok(true, "example object kept verbatim");
}

console.log("\n[examples: [x] -> example: x]");
{
  const body = await toolRequest({
    type: "object",
    properties: {
      a: { type: "string", examples: ["first", "second"] },
      b: { type: "string", examples: [], example: "already" },
    },
  });
  const p = fnParams(body).properties;
  ok(p.a.example === "first", "non-empty examples[0] promoted to example");
  ok(!("examples" in p.a), "examples array dropped");
  ok(p.b.example === "already", "existing example not overwritten");
}

/* --------------------------------------- 7. response_format regression guard */

console.log("\n[response_format json_schema]");
{
  const body = await send({
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "x",
        strict: true,
        schema: {
          type: "object",
          $schema: "https://json-schema.org/draft/2020-12/schema",
          additionalProperties: false,
          properties: { a: { type: "string", const: "k" } },
          required: ["a"],
        },
      },
    },
  });
  const cfg = body.generationConfig;
  assert.ok(cfg.responseSchema, "responseSchema still emitted (json_schema wrapper preserved)");
  ok(cfg.responseMimeType === "application/json", "responseMimeType = application/json");
  assert.deepEqual(cfg.responseSchema.properties.a.enum, ["k"]);
  ok(!("const" in cfg.responseSchema.properties.a), "schema const -> enum inside responseSchema");
  ok(!("$schema" in cfg.responseSchema) && !("additionalProperties" in cfg.responseSchema), "responseSchema sanitized");
  ok(!("strict" in (body.response_format?.json_schema ?? {})), "json_schema.strict removed");
}

console.log("\n[response_format top-level enum keeps text/x.enum]");
{
  const body = await send({
    response_format: { type: "json_schema", json_schema: { name: "e", schema: { type: "string", enum: ["a", "b"] } } },
  });
  ok(body.generationConfig.responseMimeType === "text/x.enum", "top-level enum -> text/x.enum unchanged");
}

/* --------------------------------------------- 8. plain requests unaffected */

console.log("\n[plain request untouched]");
{
  const body = await send({});
  ok(!("tools" in body), "no tools key invented");
  ok(!("responseSchema" in body.generationConfig), "no responseSchema invented");
  ok(!("responseMimeType" in body.generationConfig), "no responseMimeType invented");
  ok(body.contents[0].parts[0].text === "hi", "message content passes through");
}

upstream.close();
console.log(`\nALL PASSED (${passed} assertions)`);
