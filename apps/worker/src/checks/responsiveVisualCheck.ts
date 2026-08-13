import { describeImage } from '../lib/aiFallback';
import { Finding } from '@qacc/shared';

export interface ResponsiveIssue {
  issue: string;
  viewport: 'mobile' | 'desktop';
}

export async function checkResponsiveVisual(
  desktopScreenshotBuffer: Buffer,
  mobileScreenshotBuffer: Buffer,
  pageUrl: string
): Promise<Finding[]> {
  const prompt = `These are screenshots of the same webpage at desktop (1920px) and mobile (375px). Identify ONLY obvious responsive layout issues: text too small to read, content cut off, buttons overlapping, images overflowing their container, horizontal scrollbar visible. Return JSON: [{issue: string, viewport: 'mobile'|'desktop'}]. Return [] if no issues.`;

  const failed = (msg: string): Finding[] => [
    {
      check_factor: 'visual_regression',
      title: 'Responsive Visual Check Failed',
      description: `The responsive visual check could not complete: ${msg}. Process aborted gracefully; QACC will retry on the next run.`,
      context_text: `URL: ${pageUrl}\nSystem Error`,
      screenshot_url: null,
      status: 'open',
      ai_generated: false,
    } as Finding,
  ];

  try {
    const responseText = await describeImage([desktopScreenshotBuffer, mobileScreenshotBuffer], prompt);

    // Extract JSON from response. A response with NO array at all means the AI
    // call did not return a usable result — that is a failure, not "no issues".
    // (A genuine clean pass returns the literal "[]", which DOES match here.)
    const jsonMatch = responseText.match(/\[.*\]/s);
    if (!jsonMatch) return failed('AI returned no parseable result');

    const issues: ResponsiveIssue[] = JSON.parse(jsonMatch[0]);

    return issues.map(issue => ({
      check_factor: 'visual_regression',
      title: `Responsive Issue (${issue.viewport}): ${issue.issue}`,
      description: `AI detected a responsive layout issue on ${issue.viewport} view: ${issue.issue}`,
      context_text: `URL: ${pageUrl}\nViewport: ${issue.viewport}`,
      status: 'open',
      ai_generated: true
    } as Finding));

  } catch (error: any) {
    // Do NOT swallow to [] — an AI/parse error would be reported as a clean
    // "no responsive issues" pass over a page that was never actually analyzed.
    console.error('Error in responsive visual check:', error);
    return failed(error?.message || String(error));
  }
}
