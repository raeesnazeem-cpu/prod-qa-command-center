import { genAI, analyzeImageWith, makeGeminiClient } from "@qacc/ai"
import pino from "pino"

type GeminiClient = ReturnType<typeof makeGeminiClient>

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
})

/**
 * Worker-side text completion with multi-provider fallback.
 *
 * The API app's chatWithFallback (apps/api/src/lib/aiProviders.ts) is a
 * separate app and can't be imported here, so this mirrors its provider ORDER
 * for plain (tool-less) text completion. Providers without a key are skipped, so
 * adding GROQ/OPENROUTER/etc. keys activates them automatically. GEMINI_API_KEY
 * is a PAID key and is pinned LAST, so it is only billed after every free
 * provider has failed.
 *
 * Vision uses describeImage below, which runs the SAME free→paid Gemini key
 * chain (GOOGLE_AI_API_KEY → GEMINI_KEYS → GEMINI_API_KEY). All worker vision
 * callers go through it, so a 429 on one key fails over instead of dead-ending.
 */

export interface AiResult {
  text: string
  provider: string
}

async function openAiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  const r = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  })
  const body: any = await r.json().catch(() => ({}))
  const text = body?.choices?.[0]?.message?.content
  if (!r.ok || !text) {
    throw new Error(`${model}: HTTP ${r.status} ${body?.error?.message || ""}`)
  }
  return text
}

/**
 * Vision completion against an OpenAI-compatible provider (Groq, OpenRouter).
 * Sends the prompt plus one or more PNG screenshots as base64 data URIs and
 * tries each model in order. On an HTTP error the response status is attached to
 * the thrown error (err.status) so the caller's exhaustion/unreachable check can
 * see a 429/500/503/401/403 and mark the provider dead for the rest of the run.
 */
async function openAiCompatibleVision(
  baseUrl: string,
  apiKey: string,
  models: string[],
  buffer: Buffer | Buffer[],
  prompt: string,
): Promise<string> {
  const bufs = Array.isArray(buffer) ? buffer : [buffer]
  const imageParts = bufs.map((b) => ({
    type: "image_url",
    image_url: { url: `data:image/png;base64,${b.toString("base64")}` },
  }))

  let lastErr: any
  for (const model of models) {
    try {
      const r = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          // Cap the reply length. Our vision prompts want a short sentence or a
          // small JSON verdict, and OpenRouter reserves credits against this
          // ceiling up-front (a high default 402s on a low balance), so keep it
          // tight. Env-tunable for a prompt that legitimately needs more.
          max_tokens: Math.max(64, Number(process.env.VISION_MAX_TOKENS || 1024)),
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: prompt }, ...imageParts],
            },
          ],
        }),
      })
      const body: any = await r.json().catch(() => ({}))
      const text = body?.choices?.[0]?.message?.content
      if (!r.ok) {
        const err: any = new Error(
          `${model}: HTTP ${r.status} ${body?.error?.message || ""}`,
        )
        err.status = r.status
        throw err
      }
      if (text) return text
      lastErr = new Error(`${model}: returned an empty reply`)
    } catch (e) {
      lastErr = e
      // Try the next model unless this is a hard exhaustion/unreachable signal —
      // those won't clear by switching models on the same provider, so surface
      // them immediately and let the caller mark the whole provider dead.
      if (isExhaustedOrUnreachable(e)) throw e
    }
  }
  throw lastErr || new Error("vision: no model returned text")
}

/**
 * Vision via Cloudflare Workers AI (native /ai/run endpoint). Unlike the OpenAI
 * providers, CF takes the image as a raw byte array plus a prompt, and its
 * OpenAI-compat endpoint does NOT accept image_url — so this speaks the native
 * shape. Handles ONE image (CF's `image` field is a single image); multi-image
 * callers are handled upstream by not registering CF for them. On an HTTP error
 * the status is attached so the caller's exhaustion check can mark CF dead when
 * the daily free neuron allowance is spent (then the run falls to OpenRouter).
 */
async function cloudflareVision(
  models: string[],
  buffer: Buffer | Buffer[],
  prompt: string,
): Promise<string> {
  const acc = process.env.CLOUDFLARE_ACCOUNT_ID || ""
  const tok = process.env.CLOUDFLARE_API_TOKEN || ""
  const buf = Array.isArray(buffer) ? buffer[0] : buffer
  const image = Array.from(buf) // CF wants the image as an array of byte values
  const maxTokens = Math.max(64, Number(process.env.VISION_MAX_TOKENS || 1024))

  let lastErr: any
  for (const model of models) {
    try {
      const r = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/${model}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ prompt, image, max_tokens: maxTokens }),
        },
      )
      const body: any = await r.json().catch(() => ({}))
      if (!r.ok) {
        const err: any = new Error(
          `${model}: HTTP ${r.status} ${body?.errors?.[0]?.message || ""}`,
        )
        err.status = r.status
        throw err
      }
      const text = body?.result?.response
      if (text) return text
      lastErr = new Error(`${model}: returned an empty reply`)
    } catch (e) {
      lastErr = e
      // A hard exhaustion/unreachable signal won't clear by switching models on
      // the same provider — surface it so the caller marks CF dead for the run.
      if (isExhaustedOrUnreachable(e)) throw e
    }
  }
  throw lastErr || new Error("cloudflare vision: no model returned text")
}

// gemini-2.5-flash-lite is the cheap, capable default that covers every LLM job
// we have (grammar, watermark vision, fix triage). gemini-1.5-flash is RETIRED
// (404) — do not resurrect it. `gemini-flash-latest` is a living alias that
// always points at the current flash model, kept as a self-healing fallback so
// this list does not rot the next time Google retires a version.
const GEMINI_MODELS = ["gemini-2.5-flash-lite", "gemini-flash-latest"]

// Vision models for the OpenAI-compatible providers (Groq, OpenRouter). These
// are multimodal — unlike the llama/mistral/cohere TEXT models — so they extend
// the vision chain beyond Gemini. Kept as env-overridable, comma-separated lists
// (each tried in order) so a retired slug is a one-line ops fix, not a redeploy,
// same self-healing rationale as GEMINI_MODELS above.
//   Groq       → EMPTY by default: as of this writing Groq's account catalogue
//                has NO multimodal model (Llama-4 Scout/Maverick were removed),
//                so the Groq vision provider stays dormant. Set GROQ_VISION_MODELS
//                to a valid slug to light it up the moment one lands.
//   OpenRouter → Qwen3-VL (the current Qwen vision line). Both are ~$0.0001/image
//                and only hit when Gemini's free quota (20/day) is exhausted. The
//                8B is the cheap default; the 32B is a slightly stronger backup.
const GROQ_VISION_MODELS = (process.env.GROQ_VISION_MODELS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
const OPENROUTER_VISION_MODELS = (
  process.env.OPENROUTER_VISION_MODELS ||
  "qwen/qwen3-vl-8b-instruct,qwen/qwen3-vl-32b-instruct"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)

// Cloudflare Workers AI — the FREE primary. Llama-3.2-Vision reads a screenshot
// well (~15 neurons/call measured), and the free plan grants 10,000 neurons/day
// (~650 vision calls) that reset daily. On the Workers *free* plan there is no
// paid overage — once the daily allowance is spent the API errors and the
// dead-marking guard falls the run through to OpenRouter, so it stays free.
// Needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (Workers AI: Read). Note the
// model requires a one-time licence acceptance on the account before first use.
const CLOUDFLARE_VISION_MODELS = (
  process.env.CLOUDFLARE_VISION_MODELS ||
  "@cf/meta/llama-3.2-11b-vision-instruct"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)

// Vision must never stall the scan. When a provider is overloaded (e.g. Gemini
// 503 "high demand") the SDK backs off internally, so a single attempt can hang
// 60–90s; walking every provider/model then costs minutes PER image, and the run
// only finishes when its slowest check does. So we cap vision to a small number
// of provider attempts PER image, each hard-bounded by a timeout, and then report
// the check as failed (ok:false) rather than grinding on. The default of 3 lets a
// single image reach the first two fallbacks (Groq → OpenRouter → Gemini) while
// staying bounded; dead providers are skipped and don't consume an attempt. Both
// are env-tunable.
const VISION_MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.VISION_MAX_ATTEMPTS || 3),
)
const VISION_ATTEMPT_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.VISION_ATTEMPT_TIMEOUT_MS || 20000),
)

// Text (grammar, fix triage) must never stall the scan either, for the SAME
// reason vision can't: when Gemini is overloaded (503) the SDK backs off
// internally, so one attempt can hang 60–90s, and walking every provider/model
// then costs MINUTES per page (grammar runs once per crawled page on a
// serialized lane). So text mirrors vision — a small attempt cap, each attempt
// hard-bounded by a timeout, then the call fails and the check reports the
// lapse (checkGrammar surfaces it as "Grammar Check Failed"). Both env-tunable.
const TEXT_MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.TEXT_MAX_ATTEMPTS || 3),
)
const TEXT_ATTEMPT_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.TEXT_ATTEMPT_TIMEOUT_MS || 20000),
)

// Race a promise against a timeout. On timeout we reject and move on — the
// underlying (uncancellable) SDK call may keep running in the background, but it
// no longer blocks the scan.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    )
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

// Per-run vision provider health (the anti-retry-loop guard).
//
// A vision provider that returns a hard exhaustion/unreachable signal — rate
// limit / quota (429), server overload (500/503), bad/again-limited key
// (401/403), or a network-unreachable error — will NOT recover mid-run. So the
// first such failure marks THAT provider dead, and it is skipped for every later
// image this run: no point re-hitting a provider we already know is exhausted.
// A one-off transient error or an empty reply does NOT mark a provider dead — it
// just falls through to the next provider and stays eligible next image.
//
// When EVERY configured provider is dead, describeImageResult fails fast with no
// attempts at all — that is the guard against grinding the whole provider chain
// on image after image once it's clear they're all exhausted or unreachable.
//
// Only ONE run executes at a time (global run slot), so this module-level set is
// correctly scoped to the current run; it is cleared at run start and run end
// (see resetAiBreakers callers).
const deadVisionProviders = new Set<string>()

// Per-run TEXT circuit breaker — same rationale and scoping as the vision one
// above: a 429/500/503 from Gemini won't clear mid-run, so the first one trips
// this and every later text call (grammar on subsequent pages) fails fast
// instead of walking the whole provider chain again.
const textBreaker: { tripped: boolean; code: string | null } = {
  tripped: false,
  code: null,
}

/** Reset the per-run AI guards (text circuit breaker + dead vision providers).
 *  Called at run start and run end. */
export function resetAiBreakers(): void {
  deadVisionProviders.clear()
  textBreaker.tripped = false
  textBreaker.code = null
}

/** Extract a trip-worthy status (429/500/503) from an error, else null. */
function tripStatusCode(err: any): string | null {
  const status = err?.status ?? err?.code ?? err?.response?.status
  if (status === 429 || status === 500 || status === 503) return String(status)
  const msg = err?.message || String(err || "")
  // Gemini errors carry it as `"code":503` / `"status":"UNAVAILABLE"` in the body.
  const m = msg.match(/"code"\s*:\s*(429|500|503)\b/) || msg.match(/\b(429|500|503)\b/)
  return m ? m[1] : null
}

/**
 * True when an error means a provider is exhausted (rate limit / quota / bad
 * key) or unreachable (network) — i.e. it won't recover mid-run, so the provider
 * should be marked dead and skipped for the rest of the run. Broader than
 * tripStatusCode: also catches auth failures (401/403) and connection errors.
 */
function isExhaustedOrUnreachable(err: any): boolean {
  if (tripStatusCode(err)) return true
  // 401/403 bad key, 402 out of credits — none clear mid-run, so the provider is
  // effectively exhausted and should be skipped for the rest of the run.
  const status = err?.status ?? err?.response?.status
  if (status === 401 || status === 403 || status === 402) return true
  const msg = (err?.message || String(err || "")).toLowerCase()
  if (/\b(401|402|403)\b/.test(msg)) return true
  // Node fetch surfaces network failures as "fetch failed" with an errno cause.
  return /fetch failed|enotfound|econnrefused|eai_again|getaddrinfo|econnreset|socket hang up|und_err|network/.test(
    msg,
  )
}

// The paid Gemini client (GEMINI_API_KEY) is built lazily and reused. It is the
// LAST-resort provider, so it is only ever constructed if every free provider
// above it has failed at least once in a run.
let paidGeminiClient: GeminiClient | null = null
function paidGemini(): GeminiClient {
  if (!paidGeminiClient)
    paidGeminiClient = makeGeminiClient(process.env.GEMINI_API_KEY || "")
  return paidGeminiClient
}

// Extra Gemini keys (GEMINI_KEYS, comma-separated) tried in order AFTER the free
// providers but BEFORE the paid GEMINI_API_KEY. These extend free/available
// Gemini quota, so the paid key is only reached once every one of them has also
// failed. Built lazily and reused; empty/whitespace entries are dropped.
let geminiKeyClients: GeminiClient[] | null = null
function geminiKeyList(): GeminiClient[] {
  if (!geminiKeyClients)
    geminiKeyClients = (process.env.GEMINI_KEYS || "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
      .map((k) => makeGeminiClient(k))
  return geminiKeyClients
}

async function geminiText(
  client: GeminiClient,
  system: string,
  user: string,
): Promise<string> {
  let lastErr: any
  for (const model of GEMINI_MODELS) {
    try {
      const resp: any = await client.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: `${system}\n\n${user}` }] }],
      })
      const text = resp?.text || (resp?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text).join("")
      if (text) return text
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error("Gemini returned no text")
}

/** Complete a text prompt, trying providers in fallback order. */
export async function completeText(system: string, user: string): Promise<AiResult> {
  const env = process.env
  const providers: { name: string; run: () => Promise<string> }[] = []

  if (env.GROQ_API_KEY)
    providers.push({
      name: "groq",
      run: () => openAiCompatible("https://api.groq.com/openai/v1", env.GROQ_API_KEY!, "llama-3.3-70b-versatile", system, user),
    })
  if (env.GOOGLE_AI_API_KEY)
    providers.push({ name: "gemini", run: () => geminiText(genAI, system, user) })
  if (env.OPENROUTER_API_KEY)
    providers.push({
      name: "openrouter",
      run: () => openAiCompatible("https://openrouter.ai/api/v1", env.OPENROUTER_API_KEY!, "meta-llama/llama-3.3-70b-instruct:free", system, user),
    })
  if (env.MISTRAL_API_KEY)
    providers.push({
      name: "mistral",
      run: () => openAiCompatible("https://api.mistral.ai/v1", env.MISTRAL_API_KEY!, "mistral-small-latest", system, user),
    })
  if (env.COHERE_API_KEY)
    providers.push({
      name: "cohere",
      run: () => openAiCompatible("https://api.cohere.com/v1/compatibility/openai/v1", env.COHERE_API_KEY!, "command-r", system, user),
    })
  if (env.CEREBRAS_API_KEY)
    providers.push({
      name: "cerebras",
      run: () => openAiCompatible("https://api.cerebras.ai/v1", env.CEREBRAS_API_KEY!, "llama-3.3-70b", system, user),
    })
  // Extra Gemini keys (GEMINI_KEYS): tried in order after the free providers but
  // BEFORE the paid GEMINI_API_KEY below, so the paid key is only hit once every
  // one of these has also failed.
  geminiKeyList().forEach((client, i) =>
    providers.push({ name: `gemini-keys-${i + 1}`, run: () => geminiText(client, system, user) }),
  )
  // GEMINI_API_KEY is a PAID key — always LAST, so it is only billed when every
  // free provider (including GEMINI_KEYS) above has already failed.
  if (env.GEMINI_API_KEY)
    providers.push({ name: "gemini-paid", run: () => geminiText(paidGemini(), system, user) })

  if (providers.length === 0)
    throw new Error("No AI providers available (no keys set)")

  // Circuit open: a 429/500/503 already hit this run → fail fast, don't re-walk
  // the chain. checkGrammar catches this and reports the check as failed.
  if (textBreaker.tripped)
    throw new Error(
      `text AI unavailable: provider returned ${textBreaker.code} earlier this run (circuit open); failing fast without retry`,
    )

  let lastErr: any
  // Cap to TEXT_MAX_ATTEMPTS provider attempts, each hard-bounded by a timeout,
  // so an overloaded Gemini (503) fails FAST instead of stalling the scan for
  // minutes. After the cap (or a tripped breaker) we throw the last error.
  let attempts = 0
  for (const p of providers) {
    if (attempts >= TEXT_MAX_ATTEMPTS) break
    attempts++
    try {
      const text = await withTimeout(
        p.run(),
        TEXT_ATTEMPT_TIMEOUT_MS,
        `text attempt ${attempts} (${p.name})`,
      )
      return { text, provider: p.name }
    } catch (e) {
      lastErr = e
      logger.warn(
        { provider: p.name, attempt: attempts, error: (e as any)?.message },
        "Text provider failed; trying next",
      )
      // Trip the per-run breaker on a rate-limit/overload status — it won't
      // clear mid-run, so every later text call fails fast instead of retrying.
      const code = tripStatusCode(e)
      if (code) {
        textBreaker.tripped = true
        textBreaker.code = code
        logger.warn(
          { code },
          `Text circuit TRIPPED (${code}) — subsequent text calls this run will fail fast`,
        )
        break
      }
    }
  }
  throw lastErr || new Error("No AI providers available (no keys set)")
}

/**
 * Vision: describe/analyze a screenshot, with multi-provider fallback. The chain
 * puts the free Cloudflare tier first, then the cheap APIs, then Gemini keys:
 *   cloudflare (Llama-3.2-Vision, free ~650/day, single-image only)
 *     → groq (dormant) → openrouter (Qwen3-VL)
 *     → gemini (GOOGLE_AI_API_KEY) → gemini-keys-N (GEMINI_KEYS) → gemini-paid.
 * Providers without a key are skipped, so adding GROQ/OPENROUTER keys activates
 * them automatically. Each Gemini provider tries GEMINI_MODELS; Groq/OpenRouter
 * try their own model lists. A provider that comes back exhausted/unreachable is
 * marked dead and skipped for the rest of the run; once all are dead, vision
 * fails fast. Best-effort: returns "" (via describeImage) or ok:false (here) when
 * every provider fails or no key is set — callers treat that as "no result".
 */
export interface VisionResult {
  /** The model's reply, or "" when no provider returned text. */
  text: string
  /** true only when a provider actually returned a non-empty reply. */
  ok: boolean
  /** When !ok, the FULL reason (no providers configured, or every provider's
   *  error joined) — already logged to the worker log at error level. */
  error?: string
  /** The provider/key that answered, when ok. */
  provider?: string
}

/**
 * Vision with an EXPLICIT availability signal. Unlike describeImage (which
 * flattens every failure to ""), this distinguishes "vision ran and answered"
 * (ok:true) from "vision is unavailable" (ok:false) — no key configured, or
 * every provider/key errored. Every failure is logged in full to the worker log
 * so a real vision outage is never silent. Verdict checks (logo match, etc.)
 * MUST use this so an outage becomes an honest failure, never a false pass/fail.
 */
export async function describeImageResult(
  buffer: Buffer | Buffer[],
  prompt: string,
): Promise<VisionResult> {
  const env = process.env
  const providers: { name: string; run: () => Promise<string> }[] = []
  // Cloudflare Workers AI first — free (~650 calls/day), single-image only (CF's
  // `image` field takes one), so it's registered only when this call has a lone
  // screenshot; multi-image calls skip straight to the providers below.
  const singleImage = !Array.isArray(buffer) || buffer.length === 1
  if (
    env.CLOUDFLARE_ACCOUNT_ID &&
    env.CLOUDFLARE_API_TOKEN &&
    CLOUDFLARE_VISION_MODELS.length &&
    singleImage
  )
    providers.push({
      name: "cloudflare",
      run: () => cloudflareVision(CLOUDFLARE_VISION_MODELS, buffer, prompt),
    })
  // ...then the fast/cheap multimodal APIs...
  if (env.GROQ_API_KEY && GROQ_VISION_MODELS.length)
    providers.push({
      name: "groq",
      run: () =>
        openAiCompatibleVision(
          "https://api.groq.com/openai/v1",
          env.GROQ_API_KEY!,
          GROQ_VISION_MODELS,
          buffer,
          prompt,
        ),
    })
  if (env.OPENROUTER_API_KEY && OPENROUTER_VISION_MODELS.length)
    providers.push({
      name: "openrouter",
      run: () =>
        openAiCompatibleVision(
          "https://openrouter.ai/api/v1",
          env.OPENROUTER_API_KEY!,
          OPENROUTER_VISION_MODELS,
          buffer,
          prompt,
        ),
    })
  // ...then the free→paid Gemini chain as deeper fallback.
  if (env.GOOGLE_AI_API_KEY)
    providers.push({ name: "gemini", run: () => analyzeImageWith(genAI, GEMINI_MODELS, buffer, prompt) })
  geminiKeyList().forEach((client, i) =>
    providers.push({ name: `gemini-keys-${i + 1}`, run: () => analyzeImageWith(client, GEMINI_MODELS, buffer, prompt) }),
  )
  if (env.GEMINI_API_KEY)
    providers.push({ name: "gemini-paid", run: () => analyzeImageWith(paidGemini(), GEMINI_MODELS, buffer, prompt) })

  if (providers.length === 0) {
    const error =
      "no vision provider configured — set CLOUDFLARE_ACCOUNT_ID+CLOUDFLARE_API_TOKEN, GROQ_API_KEY, OPENROUTER_API_KEY, GOOGLE_AI_API_KEY, GEMINI_KEYS, or GEMINI_API_KEY"
    logger.error({ error }, "Vision unavailable: no provider configured")
    return { text: "", ok: false, error }
  }

  // Guard: skip providers already known dead this run. If they're ALL dead,
  // every provider is exhausted/unreachable — fail fast with no attempts rather
  // than grinding the chain again on this and every later image.
  const live = providers.filter((p) => !deadVisionProviders.has(p.name))
  if (live.length === 0) {
    const error = `vision unavailable: all ${providers.length} provider(s) exhausted/unreachable earlier this run (${[...deadVisionProviders].join(", ")}); failing fast without retry`
    logger.warn({ dead: [...deadVisionProviders] }, "Vision: all providers dead this run; skipping attempts")
    return { text: "", ok: false, error }
  }

  const errors: string[] = []
  // Cap to VISION_MAX_ATTEMPTS live-provider attempts, each hard-bounded by a
  // timeout, so an overloaded provider fails FAST instead of stalling the whole
  // scan. Dead providers were already filtered out and don't consume an attempt.
  let attempts = 0
  for (const p of live) {
    if (attempts >= VISION_MAX_ATTEMPTS) break
    attempts++
    try {
      const text = await withTimeout(
        p.run(),
        VISION_ATTEMPT_TIMEOUT_MS,
        `vision attempt ${attempts} (${p.name})`,
      )
      if (text) return { text, ok: true, provider: p.name }
      errors.push(`${p.name}: returned an empty reply`)
      logger.warn({ provider: p.name, attempt: attempts }, "Vision provider returned an empty reply; trying next")
    } catch (e: any) {
      const msg = e?.message || String(e)
      errors.push(`${p.name}: ${msg}`)
      // Mark the provider dead ONLY on a real exhaustion/unreachable signal — it
      // won't recover mid-run, so skip it for every later image. A one-off
      // transient error just falls through to the next provider.
      if (isExhaustedOrUnreachable(e)) {
        deadVisionProviders.add(p.name)
        logger.warn(
          { provider: p.name },
          `Vision provider ${p.name} exhausted/unreachable — marked dead, skipped for the rest of this run`,
        )
      } else {
        logger.warn({ provider: p.name, attempt: attempts }, "Vision provider failed (transient); trying next")
      }
    }
  }
  const skipped = live.length - attempts
  const error =
    errors.join(" | ") +
    (skipped > 0 ? ` | (${skipped} more provider(s) skipped after ${VISION_MAX_ATTEMPTS}-attempt cap)` : "")
  logger.error(
    { error, attempts, cap: VISION_MAX_ATTEMPTS, dead: [...deadVisionProviders] },
    `Vision unavailable: failed after ${attempts} attempt(s)`,
  )
  return { text: "", ok: false, error }
}

/** Best-effort vision that returns "" on any failure (back-compat). Prefer
 *  describeImageResult when the caller must know whether vision was available. */
export async function describeImage(buffer: Buffer | Buffer[], prompt: string): Promise<string> {
  return (await describeImageResult(buffer, prompt)).text
}
