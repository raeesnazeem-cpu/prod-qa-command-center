// import { GoogleGenerativeAI, TaskType } from "@google/generative-ai";
// import path from "path";
// import dotenv from "dotenv";

// // Look for .env in the process root (apps/api)
// dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// // Initialize the Google AI SDK
// const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

/**
 * text-embedding-005 is the 2026 stable successor to 004.
 * It natively supports 768 dimensions, making it a drop-in replacement 
 * for your existing Supabase vector(768) columns.
 */
// const model = genAI.getGenerativeModel(
//   { model: "text-embedding-005" },
//   { apiVersion: "v1" }
// );

// const embeddingCache = new Map<string, number[]>();

/**
 * Generates an embedding for the given text.
 * Uses an in-memory cache to optimize performance and reduce API costs.
 */
// export async function embedText(text: string): Promise<number[]> {
//   if (!text) return [];

//   // 1. Check local cache to avoid redundant network calls
//   if (embeddingCache.has(text)) {
//     return embeddingCache.get(text)!;
//   }

//   try {
//     // 2. Generate embedding using the RETRIEVAL_QUERY task type
//     // This informs Gemini the vector is for a chatbot search context.
//     const result = await model.embedContent({
//       content: { role: 'user', parts: [{ text }] },
//       taskType: TaskType.RETRIEVAL_QUERY,
//     });

//     const embedding = result.embedding.values;

//     // 3. Store in cache and return
//     embeddingCache.set(text, embedding);
//     return embedding;

//   } catch (error) {
//     console.error("Error generating embedding with text-embedding-005:", error);
//     throw error;
//   }
// }
import { genAI } from './geminiClient';

export async function generateEmbedding(text: string): Promise<number[]> {
  const models = ['gemini-embedding-2-preview'];
  let lastError: any = null;

  for (const modelName of models) {
    try {
      const result = await genAI.models.embedContent({
        model: modelName,
        contents: { role: 'user', parts: [{ text }] },
        config: {
          taskType: 'RETRIEVAL_QUERY',
          outputDimensionality: 768,
        }
      });
      const values = result.embeddings?.[0]?.values || (result as any).embedding?.values;
      if (!values) {
        throw new Error("No embedding values returned");
      }
      return values;
    } catch (e: any) {
      lastError = e;
      const isRateLimit = e.status === 429 || e.statusCode === 429 || e.response?.status === 429 || (typeof e.message === 'string' && (e.message.includes('429') || e.message.includes('RESOURCE_EXHAUSTED') || e.message.includes('Quota exceeded')));
      if (isRateLimit) {
        e.status = 429;
        throw e;
      }
      console.warn(`Failed to generate embedding with ${modelName}: ${e.message}`);
      continue;
    }
  }

  throw lastError || new Error('All Gemini embedding models failed');
}