import { GoogleGenAI } from "@google/genai";
import 'dotenv/config';

// SDK-level request timeout (ms). The worker also races each call against its
// own withTimeout wrapper, but this caps the @google/genai internal retry/backoff
// so an overloaded Gemini (429/503) can't hang a single request for 60–90s.
// Env-tunable; keep it >= the worker's per-attempt timeouts so this is a backstop.
const GEMINI_HTTP_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.GEMINI_HTTP_TIMEOUT_MS || 25000),
);

export const genAI = new GoogleGenAI({
  apiKey: process.env.GOOGLE_AI_API_KEY || "",
  httpOptions: { timeout: GEMINI_HTTP_TIMEOUT_MS },
});

/**
 * Build a Gemini client for an arbitrary API key. Lets callers wire additional
 * keys (e.g. a paid GEMINI_API_KEY as a last-resort fallback) without importing
 * @google/genai directly.
 */
export function makeGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: apiKey || "",
    httpOptions: { timeout: GEMINI_HTTP_TIMEOUT_MS },
  });
}
