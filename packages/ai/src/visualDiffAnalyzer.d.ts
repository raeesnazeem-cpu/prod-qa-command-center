export interface VisualDiffIssue {
    issue: string;
    area: string;
    type: 'layout' | 'color' | 'typography' | 'missing_element' | 'extra_element' | 'spacing';
}
export interface VisualDiffResult {
    issues: VisualDiffIssue[];
    rawResponse?: string;
}
/**
 * compareScreenshots
 * Sends the Figma design (Image 1) and the live website screenshot (Image 2) to Gemini Vision.
 * Identifies visual discrepancies and returns them as a structured list.
 */
export declare function compareScreenshots(figmaBuffer: Buffer, siteBuffer: Buffer, pageUrl: string): Promise<VisualDiffResult>;
//# sourceMappingURL=visualDiffAnalyzer.d.ts.map