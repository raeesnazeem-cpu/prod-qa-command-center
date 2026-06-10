import { analyzeImage } from '@qacc/ai';
import { Finding } from '@qacc/shared';

export interface ResponsiveIssue {
  issue: string;
  viewport: 'mobile' | 'desktop';
  severity: 'high' | 'medium' | 'low';
}

export async function checkResponsiveVisual(
  desktopScreenshotBuffer: Buffer,
  mobileScreenshotBuffer: Buffer,
  pageUrl: string
): Promise<Finding[]> {
  const prompt = `These are screenshots of the same webpage at desktop (1440px) and mobile (375px). Identify ONLY obvious responsive layout issues: text too small to read, content cut off, buttons overlapping, images overflowing their container, horizontal scrollbar visible. Return JSON: [{issue: string, viewport: 'mobile'|'desktop', severity: 'high'|'medium'|'low'}]. Return [] if no issues.`;

  try {
    const responseText = await analyzeImage([desktopScreenshotBuffer, mobileScreenshotBuffer], prompt);
    
    // Extract JSON from response
    const jsonMatch = responseText.match(/\[.*\]/s);
    if (!jsonMatch) return [];

    const issues: ResponsiveIssue[] = JSON.parse(jsonMatch[0]);

    return issues.map(issue => ({
      check_factor: 'visual_regression',
      severity: issue.severity,
      title: `Responsive Issue (${issue.viewport}): ${issue.issue}`,
      description: `AI detected a responsive layout issue on ${issue.viewport} view: ${issue.issue}`,
      context_text: `URL: ${pageUrl}\nViewport: ${issue.viewport}`,
      status: 'open',
      ai_generated: true
    } as Finding));

  } catch (error) {
    console.error('Error in responsive visual check:', error);
    return [];
  }
}
