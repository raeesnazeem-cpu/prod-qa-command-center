import { genAI, analyzeImage } from "@qacc/ai"

/**
 * Worker-side text completion with multi-provider fallback.
 *
 * The API app's chatWithFallback (apps/api/src/lib/aiProviders.ts) is a
 * separate app and can't be imported here, so this mirrors its provider ORDER
 * for plain (tool-less) text completion. Providers without a key are skipped.
 * Today only GOOGLE_AI_API_KEY is set in the worker, so Gemini is the live
 * provider; adding GROQ/OPENROUTER/etc. keys activates them automatically.
 *
 * Vision goes through @qacc/ai's analyzeImage (Gemini) — re-exported as
 * describeImage — matching the "fallback loop + Gemini vision" decision.
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

async function geminiText(system: string, user: string): Promise<string> {
  const models = ["gemini-2.5-flash", "gemini-1.5-flash"]
  let lastErr: any
  for (const model of models) {
    try {
      const resp: any = await genAI.models.generateContent({
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
    providers.push({ name: "gemini", run: () => geminiText(system, user) })
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

/** Vision: describe/analyze a screenshot (Gemini via @qacc/ai). */
export async function describeImage(buffer: Buffer, prompt: string): Promise<string> {
  return analyzeImage(buffer, prompt)
}
