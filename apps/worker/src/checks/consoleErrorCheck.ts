import { Page as PlaywrightPage } from 'playwright';
import { Finding } from '@qacc/shared';
import { looksBlocked } from '../lib/browserContext';

// One error message can be a multi-KB stack or minified source line; keep the
// report readable and the row small.
const MAX_ERROR_CHARS = 500;
const clip = (m: string) => {
  const s = String(m ?? '').trim();
  return s.length > MAX_ERROR_CHARS ? `${s.slice(0, MAX_ERROR_CHARS)}…` : s;
};

/**
 * Checks for console errors and critical page crashes.
 *
 * IMPORTANT: console/pageerror listeners MUST be attached BEFORE page.goto() to
 * capture load-time errors. The caller (crawlPageJob) attaches them before
 * navigation and passes the collected arrays in here — this function does NOT
 * attach its own listeners (doing so after goto would silently miss every
 * load-time error, reporting a broken page as "0 console errors" = a false pass).
 *
 * We still wait a short settle period so async/delayed errors land in the
 * shared arrays (the caller's listeners keep filling them on the same page).
 */
export async function checkConsoleErrors(
  page: PlaywrightPage,
  pageRecord: any,
  consoleErrors: string[],
  criticalErrors: string[],
): Promise<Finding[]> {
  // Let the page settle so async/delayed errors propagate to the (already
  // attached) listeners. Best-effort — never throw for a load timeout.
  try {
    await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
  } catch (e) {
    // Ignore — report whatever was captured so far.
  }

  // A bot-challenge page (Cloudflare "Just a moment…") logs its own errors;
  // they say nothing about the real site, and "0 errors" there is no pass
  // either. Short body text guards against real pages that mention "captcha".
  try {
    if (await looksBlocked(page)) {
      const textLen = await page.evaluate(() => (document.body?.innerText || '').length).catch(() => 0);
      if (textLen < 3000) {
        return [{
          check_factor: 'console_errors',
          title: 'Console Errors Check Failed',
          description: 'Could not complete: the site served a bot-protection page to the QACC browser, so its console errors could not be checked. Process aborted gracefully.',
          context_text: `URL: ${(() => { try { return page.url(); } catch { return ''; } })()}`,
          screenshot_url: null,
          status: 'open',
          ai_generated: false
        } as Finding];
      }
    }
  } catch {
    // Never fail the check over the bot-wall probe itself.
  }

  // Dedupe while preserving order (the caller uses plain arrays, not Sets).
  const uniqueCritical = Array.from(new Set((criticalErrors || []).map(clip).filter(Boolean)));
  const uniqueConsole = Array.from(new Set((consoleErrors || []).map(clip).filter(Boolean)));

  const findings: Finding[] = [];

  if (uniqueCritical.length > 0) {
    findings.push({
      check_factor: 'console_errors',
      title: `${uniqueCritical.length} Critical Runtime Errors`,
      description: `The page encountered critical JavaScript execution errors that may prevent it from functioning correctly:\n${uniqueCritical.join('\n')}`,
      context_text: uniqueCritical.join(' | '),
      screenshot_url: pageRecord?.desktopUrl ?? null,
      status: 'open',
      ai_generated: false
    });
  }

  if (uniqueConsole.length > 0) {
    findings.push({
      check_factor: 'console_errors',
      title: `${uniqueConsole.length} Console Errors Detected`,
      description: `JavaScript errors were logged to the console during the page session:\n${uniqueConsole.join('\n')}`,
      context_text: uniqueConsole.join(' | '),
      screenshot_url: pageRecord?.desktopUrl ?? null,
      status: 'open',
      ai_generated: false
    });
  }

  return findings;
}
