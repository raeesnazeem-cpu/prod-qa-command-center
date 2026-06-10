export interface RebuttalVerdict {
    verdict: 'resolved' | 'disputed';
    confidence: number;
    reasoning: string;
}
export declare function analyzeRebuttal(params: {
    findingDescription: string;
    findingScreenshotBuffer: Buffer;
    rebuttalText: string;
    rebuttalScreenshotBuffer?: Buffer;
}): Promise<RebuttalVerdict>;
//# sourceMappingURL=rebuttalAnalyzer.d.ts.map