import PQueue from 'p-queue';

export const geminiQueue = new PQueue({
  concurrency: 1,
  interval: 4000,
});

/**
 * All Gemini calls must go through this queue to respect rate limits.
 * 15 requests per minute = 1 request every 4 seconds.
 */
export async function queueGeminiCall<T>(fn: () => Promise<T>): Promise<T> {
  return geminiQueue.add(fn) as Promise<T>;
}
