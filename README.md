> **AI 项目声明**：本项目为**纯 AI 项目**——仓库主要由 AI（LLM）生成，人类仅负责需求描述与验收，对代码的可靠性不做保证。

## Why

The Gemini API has [Free](https://ai.google.dev/gemini-api/docs/pricing#free) Tier
with *generous limits*, but there are still many tools that work exclusively with the OpenAI API.

This project provides a personal OpenAI-compatible endpoint for free.


## Serverless?

Although it runs in the cloud, it does not require server maintenance.
It can be easily deployed to various providers for free
(with generous limits suitable for personal use).

> [!TIP]
> Running the proxy endpoint locally is also an [option](#serve-locally---with-node-deno-bun)!


## How to start

You will need a personal Google [API key](https://aistudio.google.com/app/api-keys).

> [!IMPORTANT]
> Even if you are located outside of the [supported regions](https://ai.google.dev/gemini-api/docs/available-regions#available_regions),
> it is still possible to acquire one using a VPN.

Deploy the project to one of the providers, using the instructions below.
You will need to set up an account there.

If you opt for “button-deploy”, you'll be guided through the process of forking the repository first,
which is necessary for continuous integration (CI).


### Deploy with Vercel

 [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/PublicAffairs/openai-gemini&repository-name=my-openai-gemini)
- Alternatively can be deployed with [cli](https://vercel.com/docs/cli):
  `vercel deploy`
- Serve locally: `vercel dev`
- Vercel _Functions_ [limitations](https://vercel.com/docs/functions/limitations) (with _Edge_ runtime)


### Deploy to Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/PublicAffairs/openai-gemini&integrationName=integrationName&integrationSlug=integrationSlug&integrationDescription=integrationDescription)
- Alternatively can be deployed with [cli](https://docs.netlify.com/cli/get-started/):
  `netlify deploy`
- Serve locally: `netlify dev`
- Two different api bases provided:
  - `/v1` (e.g. `/v1/chat/completions` endpoint)  
    _Functions_ [limits](https://docs.netlify.com/build/functions/get-started/#synchronous-function)
  - `/edge/v1`  
    _Edge functions_ [limits](https://docs.netlify.com/build/edge-functions/limits/)


### Deploy to Cloudflare

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/PublicAffairs/openai-gemini)
- Alternatively can be deployed manually pasting content of [`src/worker.mjs`](src/worker.mjs)
  to https://workers.cloudflare.com/playground (see there `Deploy` button).
- Alternatively can be deployed with [cli](https://developers.cloudflare.com/workers/wrangler/):
  `wrangler deploy`
- Serve locally: `wrangler dev`
- _Worker_ [limits](https://developers.cloudflare.com/workers/platform/limits/#worker-limits)


### Deploy to Deno

See details [here](https://github.com/PublicAffairs/openai-gemini/discussions/19).


### Serve locally - with Node, Deno, Bun

Only for Node: `npm install`.

Then `npm run start` / `npm run start:deno` / `npm run start:bun`.

#### Environment Variables

You can customize the behavior using environment variables:

- `GEMINI_BASE_URL`: Override the Gemini API base URL (default: `https://generativelanguage.googleapis.com`)
- `PORT`: Override the server port (default: `8080`)
- `ENABLED_MODELS`: Curate the model list served by `/v1/models`. Comma-separated exact ids or glob patterns (`*` = any run, `?` = one character; case-insensitive). An all-static list (no wildcards) is served without contacting the upstream at all; patterns are expanded against the upstream list; if that request fails, only the static entries are served.

Example:
```sh
GEMINI_BASE_URL=https://custom-api.example.com PORT=3000 npm run start
```


#### Dev mode (watch source changes)

Only for Node: `npm install --include=dev`

Then: `npm run dev` / `npm run dev:deno` / `npm run dev:bun`.


## How to use
If you open your newly-deployed site in a browser, you will only see a `404 Not Found` message. This is expected, as the API is not designed for direct browser access.
To utilize it, you should enter your API address and your Gemini API key into the corresponding fields in your software settings.

> [!NOTE]
> Not all software tools allow overriding the OpenAI endpoint, but many do
> (however these settings can sometimes be deeply hidden).

Typically, you should specify the API base in this format:  
`https://my-super-proxy.vercel.app/v1`

The relevant field may be labeled as "_OpenAI proxy_".
You might need to look under "_Advanced settings_" or similar sections.
Alternatively, it could be in some config file (check the relevant documentation for details).

For some command-line tools, you may need to set an environment variable, _e.g._:
```sh
OPENAI_BASE_URL="https://my-super-proxy.vercel.app/v1"
```
_..or_:
```sh
OPENAI_API_BASE="https://my-super-proxy.vercel.app/v1"
```


## Models

Requests use the specified [model] if its name starts with "gemini-", "gemma-", or "models/".
Otherwise, these defaults apply:

- `chat/completions`: `gemini-flash-latest`
- `embeddings`: `gemini-embedding-001`

[model]: https://ai.google.dev/gemini-api/docs/models


## Built-in tools

To use the **web search** tool, append ":search" to the model name
(e.g., "gemini-2.5-flash:search").

Note: The `annotations` message property is not implemented.


## Media

[Vision] and [audio] input supported as per OpenAI [specs].
Implemented via [`inlineData`](https://ai.google.dev/api/caching#Part).

[vision]: https://platform.openai.com/docs/guides/images-vision?api-mode=chat&format=url#giving-a-model-images-as-input
[audio]: https://platform.openai.com/docs/guides/audio?example=audio-in&lang=curl#add-audio-to-your-existing-application
[specs]: https://platform.openai.com/docs/api-reference/chat/create


## Gemini-specific functions

There are several features supported by Gemini that are not available in OpenAI models
but can be enabled using the `extra_body` field.
The most notable of these is [`thinking_config`](https://ai.google.dev/gemini-api/docs/openai#thinking).

For more details, refer to the [Gemini API docs](https://ai.google.dev/gemini-api/docs/openai#extra-body).

---

## Supported API endpoints and applicable parameters

- [x] `chat/completions`

  Currently, most of the parameters that are applicable to both APIs have been implemented.
  <details>

  - [x] `messages`
      - [x] `content`
      - [x] `role`
          - [x] "system" (=>`system_instruction`)
          - [x] "user"
          - [x] "assistant"
          - [x] "tool"
      - [x] `tool_calls`
  - [x] `model`
  - [x] `frequency_penalty`
  - [ ] `logit_bias`
  - [ ] `logprobs`
  - [ ] `top_logprobs`
  - [x] `max_tokens`, `max_completion_tokens`
  - [x] `n` (`candidateCount` <8, not for streaming)
  - [x] `presence_penalty`
  - [x] `reasoning_effort`
  - [x] `response_format`
      - [x] "json_object"
      - [x] "json_schema" (a select subset of an OpenAPI 3.0 schema object)
      - [x] "text"
  - [x] `seed`
  - [x] `stop`: string|array (`stopSequences` [1,5])
  - [x] `stream`
  - [x] `stream_options`
      - [x] `include_usage`
  - [x] `temperature` (0.0..2.0 for OpenAI, but Gemini supports up to infinity)
  - [x] `top_p`
  - [x] `tools`
  - [x] `tool_choice`
  - [ ] `parallel_tool_calls` (is always active in Gemini)
  - [x] [`extra_body`](#gemini-specific-functions)

  </details>
- [ ] `completions`
- [x] `embeddings`
  - [x] `dimensions`
- [x] `models`

---

## Usage mapping

`usageMetadata` is re-shaped to the OpenAI / OpenRouter Chat Completions contract:

| OpenAI field | Gemini source |
| --- | --- |
| `prompt_tokens` | `promptTokenCount` + `toolUsePromptTokenCount` (all input tokens; `promptTokenCount` already contains cached content) |
| `completion_tokens` | `candidatesTokenCount` + `thoughtsTokenCount` |
| `total_tokens` | `prompt_tokens` + `completion_tokens` (equal to `totalTokenCount`) |
| `prompt_tokens_details.cached_tokens` | sum of `cacheTokensDetails[].tokenCount`, else `cachedContentTokenCount`, else `0` |
| `prompt_tokens_details.audio_tokens` | `promptTokensDetails` entry with `modality: "AUDIO"` |
| `completion_tokens_details.reasoning_tokens` | `thoughtsTokenCount` |
| `completion_tokens_details.audio_tokens` | `candidatesTokensDetails` entry with `modality: "AUDIO"` |

Cached tokens are part of `prompt_tokens`, never subtracted from it, and are
reported separately in `prompt_tokens_details.cached_tokens`. Gemini reports no
cache-write counter, so `cache_write_tokens` is never emitted.

Streaming emits `usage` on the final chunk only when `stream_options.include_usage`
is set, and it matches the non-stream shape field for field.

## Tool schema compatibility

Gemini's `Schema` (used for `tools[].function.parameters` and
`response_format.json_schema.schema` → `generationConfig.responseSchema`) is a
**restricted subset** of JSON Schema. Any keyword Gemini does not recognize is
rejected with `400 Invalid JSON payload received. Unknown name "..."`, so the
worker sanitizes every schema before forwarding it, and drops the unknown keys.
This is a **lossy** conversion: constraints that only existed as unsupported
keywords are weakened, not enforced.

Kept keywords:

`anyOf`, `default`, `description`, `enum`, `example`, `format`, `items`,
`maxItems`, `maxLength`, `maxProperties`, `maximum`, `minItems`, `minLength`,
`minProperties`, `minimum`, `nullable`, `pattern`, `properties`,
`propertyOrdering`, `required`, `title`, `type`

Rewrites:

| Input | Output |
| --- | --- |
| `const: "foo"` (string) | `enum: ["foo"]`, `const` removed (an existing `enum` is kept) |
| `const: 42` / `const: true` / object | `const` dropped — Gemini's `enum` is `repeated string` only |
| `type: ["string", "null"]` | `type: "string"` + `nullable: true` |
| `type: ["string", "integer"]` | `anyOf: [{type:"string"},{type:"integer"}]`, `type` removed |
| `examples: [x, ...]` | `example: x` (only when `example` is absent) |
| `strict`, `$schema`, `additionalProperties` | dropped |

Also dropped: `$id`, `$defs`, `definitions`, `$ref`, `patternProperties`,
`unevaluatedProperties`, `allOf`, `oneOf`, `not`, `if`, `then`, `else`,
`dependentRequired`, `dependentSchemas`, `contains`, `prefixItems`,
`exclusiveMinimum`, `exclusiveMaximum`, `readOnly`, `writeOnly`, `deprecated`,
`$comment`.

Rewrites and filtering only descend into schema-bearing children (`items`,
`properties` values, `anyOf`). Instance data under `default`, `example` and the
values inside `enum` is passed through untouched.
