import 'dotenv/config';
import { SupabaseClient } from '@supabase/supabase-js';
export interface FigmaFrame {
    frameId: string;
    frameName: string;
    imageUrl: string;
    pageUrl: string;
}
/**
 * exportFigmaFrames
 * Fetches frames from Figma, saves to Supabase Storage, and returns metadata.
 */
export declare function exportFigmaFrames(figmaUrl: string, figmaToken: string, supabase: SupabaseClient, runId: string): Promise<FigmaFrame[]>;
//# sourceMappingURL=figmaExporter.d.ts.map