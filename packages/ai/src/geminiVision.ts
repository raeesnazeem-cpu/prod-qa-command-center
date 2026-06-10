import { genAI } from "./geminiClient";
import 'dotenv/config';
import PQueue from 'p-queue';

// Rate limit: 15 calls per minute (60000ms)
const queue = new PQueue({
  intervalCap: 15,
  interval: 60000,
  carryoverConcurrencyCount: true
});

/**
 * analyzeImage
 * Sends an image buffer and a prompt to Gemini 1.5 Flash.
 * Returns the raw text response from the model.
 * Handles errors gracefully and adheres to rate limits.
 */
export async function analyzeImage(imageBuffer: Buffer | Buffer[], prompt: string): Promise<string> {
  return queue.add(async () => {
    try {
      const imageParts = Array.isArray(imageBuffer) 
      ? imageBuffer.map(buf => ({
          inlineData: {
            data: buf.toString("base64"),
            mimeType: "image/png",
          },
        }))
      : [
          {
            inlineData: {
              data: imageBuffer.toString("base64"),
              mimeType: "image/png",
            },
          },
        ];

      const response = await genAI.models.generateContent({
        model: "gemini-1.5-flash",
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            ...imageParts as any
          ]
        }]
      });

      return response.text();
    } catch (error) {
      console.error("Gemini Vision API error:", error);
      return "";
    }
  }) as Promise<string>;
}

export interface Finding {
  issue: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  area: string;
}

/**
 * inspectPageScreenshot
 * Specialized vision check for common UI/UX issues.
 */
export async function inspectPageScreenshot(screenshotBuffer: Buffer): Promise<Finding[]> {
  const prompt = `Inspect this website screenshot. Return a JSON array of ONLY clear, definite issues: [{issue: string, severity: 'critical'|'high'|'medium'|'low', area: string}]. Look for: visible image watermarks, clearly blurry/pixelated images, text overlapping other elements, buttons/links cut off, obvious broken layout. Return [] if no clear issues. Return ONLY JSON, no markdown.`;
  
  const text = await analyzeImage(screenshotBuffer, prompt);
  
  try {
    // Attempt to extract JSON if the model included any conversational text or markdown blocks
    const jsonMatch = text.match(/\[.*\]/s);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    // Fallback to parsing whole text if no brackets found
    return JSON.parse(text);
  } catch (error) {
    // If it's not valid JSON, we return an empty array as instructed for no clear issues
    return [];
  }
}

export interface VisionIssue {
  issue: string;
  severity: 'high' | 'medium' | 'low';
  area: string;
}

/**
 * analyzeScreenshot (Legacy/Helper)
 * Specialized helper that uses analyzeImage with a predefined prompt
 * and parses the resulting JSON.
 */
export async function analyzeScreenshot(imageBuffer: Buffer): Promise<VisionIssue[]> {
  const prompt = `Inspect this website screenshot carefully. Identify ONLY: (1) images that have visible watermarks, (2) images that are clearly blurry or pixelated at this resolution, (3) obvious layout breaks where content is overlapping. Return a JSON array: [{issue: string, severity: 'high'|'medium'|'low', area: string}]. Return empty array [] if no issues found.`;
  
  const text = await analyzeImage(imageBuffer, prompt);
  
  try {
    const jsonMatch = text.match(/\[.*\]/s);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return [];
  } catch (error) {
    console.error("Failed to parse Gemini Vision response:", error);
    return [];
  }
}
