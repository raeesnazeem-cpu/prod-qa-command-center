import { Page as PlaywrightPage } from 'playwright';
import { Finding } from '@qacc/shared';
import { looksBlocked } from '../lib/browserContext';

// Placeholder / dummy text left over from a theme or template. Each entry is a
// regex source matched case-insensitively on the page's VISIBLE text, with word
// boundaries so a phrase never matches inside a longer word.
const PATTERNS = [
  'lorem ipsum',
  'dolor sit amet',
  'placeholder',
  'your text here',
  'add your text',
  'insert text here',
  'coming soon',
  'sample text',
  'test content',
  '\\[first ?name\\]',
  '\\[last ?name\\]',
  'example\\.com',
  'email@email\\.com',
  '555-555-?\\d{0,4}',
  'john doe',
  'jane doe',
  'company name',
  'your company',
];

const MAX_MATCHES = 50;
// Visible text scanned per page. Enough for any real page; bounds the regex
// work on endless feeds / giant product grids.
const MAX_TEXT_CHARS = 500_000;

export async function checkDummyContent(page: PlaywrightPage, pageRecord: any): Promise<Finding[]> {
  let visibleText = '';
  try {
    visibleText = String(
      (await page.evaluate((max: number) => (document.body?.innerText || '').slice(0, max), MAX_TEXT_CHARS)) || '',
    );
  } catch {
    // The page re-rendered mid-read (SPA hydration / client redirect): retry once.
    await page.waitForTimeout(1500).catch(() => {});
    visibleText = String(
      (await page.evaluate((max: number) => (document.body?.innerText || '').slice(0, max), MAX_TEXT_CHARS)) || '',
    );
  }

  // A bot-challenge page is not the site; "no placeholder text" there is no pass.
  if (visibleText.length < 3000 && (await looksBlocked(page))) {
    return [{
      check_factor: 'dummy_content',
      title: 'Dummy Content Check Failed',
      description: 'Could not complete: the site served a bot-protection page to the QACC browser, so its text could not be checked. Process aborted gracefully.',
      context_text: 'System Error: bot protection',
      screenshot_url: null,
      status: 'open',
      ai_generated: false
    } as Finding];
  }

  const matches: { text: string; context: string }[] = [];

  outer: for (const pattern of PATTERNS) {
    // `\b` only works next to word characters, so bracketed patterns like
    // "[firstname]" skip it on that side.
    const lead = /^\\?\w/.test(pattern) ? '\\b' : '';
    const tail = /\w$/.test(pattern) ? '\\b' : '';
    const regex = new RegExp(`${lead}${pattern}${tail}`, 'gi');
    let match;
    while ((match = regex.exec(visibleText)) !== null) {
      const start = Math.max(0, match.index - 50);
      const end = Math.min(visibleText.length, match.index + match[0].length + 50);
      const context = visibleText.substring(start, end).replace(/\s+/g, ' ').trim();
      matches.push({ text: match[0], context: `...${context}...` });
      if (matches.length >= MAX_MATCHES) break outer;
    }
  }

  if (matches.length === 0) return [];

  const count = matches.length;
  const distinct = [...new Set(matches.map((m) => `"${m.text.toLowerCase()}"`))];

  return [{
    check_factor: 'dummy_content',
    title: `${count} placeholder/dummy content match${count === 1 ? '' : 'es'} found`,
    description: `The page shows placeholder or dummy text (${distinct.slice(0, 5).join(', ')}${distinct.length > 5 ? ', …' : ''}). Review and replace it with the real content before release.`,
    context_text: matches.map((m) => `Match: "${m.text}" | Context: ${m.context}`).join('\n').substring(0, 2000),
    screenshot_url: pageRecord?.desktopUrl ?? null,
    status: 'open',
    ai_generated: false
  }];
}
