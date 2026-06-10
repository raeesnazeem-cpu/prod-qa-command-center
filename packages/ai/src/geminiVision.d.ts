import 'dotenv/config';
/**
 * analyzeImage
 * Sends an image buffer and a prompt to Gemini 1.5 Flash.
 * Returns the raw text response from the model.
 * Handles errors gracefully and adheres to rate limits.
 */
export declare function analyzeImage(imageBuffer: Buffer | Buffer[], prompt: string): Promise<string>;
export interface Finding {
    issue: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    area: string;
}
/**
 * inspectPageScreenshot
 * Specialized vision check for common UI/UX issues.
 */
export declare function inspectPageScreenshot(screenshotBuffer: Buffer): Promise<Finding[]>;
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
export declare function analyzeScreenshot(imageBuffer: Buffer): Promise<VisionIssue[]>;
//# sourceMappingURL=geminiVision.d.ts.map