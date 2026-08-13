import { GoogleGenAI } from "@google/genai"
import { genAI } from "./geminiClient"
import "dotenv/config"
import PQueue from "p-queue"

// Rate limit: 15 calls per minute (60000ms)
const queue = new PQueue({
  intervalCap: 15,
  interval: 60000,
  carryoverConcurrencyCount: true,
})

// Default vision models when a caller doesn't pass its own list. gemini-2.0-flash
// is retired-adjacent; the 2.5 flash-lite + living-alias pair matches the text
// fallback chain in the worker's aiFallback.
const DEFAULT_VISION_MODELS = ["gemini-2.5-flash-lite", "gemini-flash-latest"]

function toImageParts(imageBuffer: Buffer | Buffer[]) {
  const bufs = Array.isArray(imageBuffer) ? imageBuffer : [imageBuffer]
  return bufs.map((buf) => ({
    inlineData: { data: buf.toString("base64"), mimeType: "image/png" },
  }))
}

/**
 * analyzeImageWith — vision completion against a SPECIFIC client + model list,
 * trying each model in order. Unlike `analyzeImage` it THROWS when every model
 * fails, so a caller (e.g. the worker's describeImage) can fail over to the next
 * provider/key. Still shares the 15/min rate-limit queue.
 */
export async function analyzeImageWith(
  client: GoogleGenAI,
  models: string[],
  imageBuffer: Buffer | Buffer[],
  prompt: string,
): Promise<string> {
  const imageParts = toImageParts(imageBuffer)
  return queue.add(async () => {
    let lastErr: any
    for (const model of models.length ? models : DEFAULT_VISION_MODELS) {
      try {
        const response: any = await client.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: prompt }, ...(imageParts as any)] }],
        })
        const text =
          response?.text ||
          (response?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text).join("")
        if (text) return text
      } catch (e) {
        lastErr = e
      }
    }
    throw lastErr || new Error("Gemini vision returned no text")
  }) as Promise<string>
}

/**
 * analyzeImage
 * Sends an image buffer + prompt to Gemini vision using the default free client.
 * Swallows errors (returns "") — the legacy contract its callers rely on.
 */
export async function analyzeImage(
  imageBuffer: Buffer | Buffer[],
  prompt: string,
): Promise<string> {
  return analyzeImageWith(genAI, DEFAULT_VISION_MODELS, imageBuffer, prompt).catch(
    (error) => {
      console.error("Gemini Vision API error:", error)
      return ""
    },
  )
}

export interface Finding {
  issue: string
  area: string
}

/**
 * inspectPageScreenshot
 * Specialized vision check for common UI/UX issues.
 */
export async function inspectPageScreenshot(
  screenshotBuffer: Buffer,
): Promise<Finding[]> {
  const prompt = `Inspect this website screenshot. Return a JSON array of ONLY clear, definite issues: [{issue: string, area: string}]. Look for: visible image watermarks, clearly blurry/pixelated images, text overlapping other elements, buttons/links cut off, obvious broken layout. Return [] if no clear issues. Return ONLY JSON, no markdown.`

  const text = await analyzeImage(screenshotBuffer, prompt)

  try {
    // Attempt to extract JSON if the model included any conversational text or markdown blocks
    const jsonMatch = text.match(/\[.*\]/s)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }

    // Fallback to parsing whole text if no brackets found
    return JSON.parse(text)
  } catch (error) {
    // If it's not valid JSON, we return an empty array as instructed for no clear issues
    return []
  }
}

export interface VisionIssue {
  issue: string
  area: string
}

/**
 * analyzeScreenshot (Legacy/Helper)
 * Specialized helper that uses analyzeImage with a predefined prompt
 * and parses the resulting JSON.
 */
export async function analyzeScreenshot(
  imageBuffer: Buffer,
): Promise<VisionIssue[]> {
  const prompt = `Inspect this website screenshot carefully. Identify ONLY: (1) images that have visible watermarks, (2) images that are clearly blurry or pixelated at this resolution, (3) obvious layout breaks where content is overlapping. Return a JSON array: [{issue: string, area: string}]. Return empty array [] if no issues found.`

  const text = await analyzeImage(imageBuffer, prompt)

  try {
    const jsonMatch = text.match(/\[.*\]/s)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
    return []
  } catch (error) {
    console.error("Failed to parse Gemini Vision response:", error)
    return []
  }
}
