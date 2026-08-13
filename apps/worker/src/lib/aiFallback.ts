import { genAI, analyzeImageWith, makeGeminiClient } from "@qacc/ai"

type GeminiClient = ReturnType<typeof makeGeminiClient>

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

// gemini-2.5-flash-lite is the cheap, capable default that covers every LLM job
// we have (grammar, watermark vision, fix triage). gemini-1.5-flash is RETIRED
// (404) — do not resurrect it. `gemini-flash-latest` is a living alias that
// always points at the current flash model, kept as a self-healing fallback so
// this list does not rot the next time Google retires a version.
const GEMINI_MODELS = ["gemini-2.5-flash-lite", "gemini-flash-latest"]

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

  let lastErr: any
  for (const p of providers) {
    try {
      const text = await p.run()
      return { text, provider: p.name }
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error("No AI providers available (no keys set)")
}

/**
 * Vision: describe/analyze a screenshot, with the same free→paid fallback as
 * text. Only Gemini is multimodal among our providers (the llama/mistral/cohere
 * text models can't take an image), so the vision chain is:
 *   gemini (GOOGLE_AI_API_KEY) → gemini-keys-N (GEMINI_KEYS) → gemini-paid (GEMINI_API_KEY, last).
 * Each provider tries GEMINI_MODELS in order. Best-effort: returns "" if every
 * provider fails or no key is set — callers already treat empty as "no result".
 */
export async function describeImage(buffer: Buffer | Buffer[], prompt: string): Promise<string> {
  const env = process.env
  const providers: { name: string; client: GeminiClient }[] = []
  if (env.GOOGLE_AI_API_KEY) providers.push({ name: "gemini", client: genAI })
  // Extra Gemini keys (GEMINI_KEYS) before the paid key, same as the text chain.
  geminiKeyList().forEach((client, i) => providers.push({ name: `gemini-keys-${i + 1}`, client }))
  if (env.GEMINI_API_KEY) providers.push({ name: "gemini-paid", client: paidGemini() })

  for (const p of providers) {
    try {
      const text = await analyzeImageWith(p.client, GEMINI_MODELS, buffer, prompt)
      if (text) return text
    } catch {
      // try the next provider/key
    }
  }
  return ""
}
