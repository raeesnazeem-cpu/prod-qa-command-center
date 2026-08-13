import { GoogleGenAI } from "@google/genai";
import 'dotenv/config';

export const genAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY || "" });

/**
 * Build a Gemini client for an arbitrary API key. Lets callers wire additional
 * keys (e.g. a paid GEMINI_API_KEY as a last-resort fallback) without importing
 * @google/genai directly.
 */
export function makeGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey: apiKey || "" });
}
