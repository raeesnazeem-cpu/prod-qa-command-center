import PQueue from 'p-queue';
export declare const geminiQueue: PQueue<import("p-queue/dist/priority-queue").default, import("p-queue").QueueAddOptions>;
/**
 * All Gemini calls must go through this queue to respect rate limits.
 * 15 requests per minute = 1 request every 4 seconds.
 */
export declare function queueGeminiCall<T>(fn: () => Promise<T>): Promise<T>;
//# sourceMappingURL=rateLimiter.d.ts.map