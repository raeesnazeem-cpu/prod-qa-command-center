import { Page as PlaywrightPage } from 'playwright';
import { Finding } from '@qacc/shared';

export async function checkDummyContent(page: PlaywrightPage, pageRecord: any): Promise<Finding[]> {
  const visibleText = await page.evaluate(() => document.body.innerText);

  const patterns = [
    'lorem ipsum',
    'placeholder',
    'your text here',
    'coming soon',
    'sample text',
    'test content',
    '\\[firstname\\]',
    '\\[lastname\\]',
    'example\\.com',
    'email@email\\.com',
    '555-555',
    'John Doe',
    'Jane Doe',
    'company name',
    'your company'
  ];

  const findings: Finding[] = [];
  const allMatches: { pattern: string; context: string }[] = [];

  for (const pattern of patterns) {
    const regex = new RegExp(pattern, 'gi');
    let match;
    while ((match = regex.exec(visibleText)) !== null) {
      const index = match.index;
      const start = Math.max(0, index - 50);
      const end = Math.min(visibleText.length, index + pattern.length + 50);
      const context = visibleText.substring(start, end).replace(/\n/g, ' ').trim();
      
      allMatches.push({
        pattern: match[0],
        context: `...${context}...`
      });

      // Limit per pattern to avoid massive finding objects
      if (allMatches.length >= 50) break;
    }
    if (allMatches.length >= 50) break;
  }

  if (allMatches.length === 0) return [];

  const count = allMatches.length;
  let severity: 'low' | 'medium' | 'high' = 'low';
  if (count >= 10) severity = 'high';
  else if (count >= 5) severity = 'medium';

  return [{
    check_factor: 'dummy_content',
    severity,
    title: `${count} placeholder/dummy content matches found`,
    description: `The page contains text that appears to be placeholder or dummy content (e.g., "Lorem Ipsum", "Coming Soon"). This should be replaced with actual content before release.`,
    context_text: allMatches.map(m => `Match: "${m.pattern}" | Context: ${m.context}`).join('\n').substring(0, 2000),
    screenshot_url: pageRecord.desktopUrl,
    status: 'open',
    ai_generated: false
  }];
}
