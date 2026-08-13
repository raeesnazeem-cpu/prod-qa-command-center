import { Page as PlaywrightPage } from 'playwright';
import { Finding } from '@qacc/shared';

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

  // Dedupe while preserving order (the caller uses plain arrays, not Sets).
  const uniqueCritical = Array.from(new Set(criticalErrors));
  const uniqueConsole = Array.from(new Set(consoleErrors));

  const findings: Finding[] = [];

  if (uniqueCritical.length > 0) {
    findings.push({
      check_factor: 'console_errors',
      title: `${uniqueCritical.length} Critical Runtime Errors`,
      description: `The page encountered critical JavaScript execution errors that may prevent it from functioning correctly:\n${uniqueCritical.join('\n')}`,
      context_text: uniqueCritical.join(' | '),
      screenshot_url: pageRecord.desktopUrl,
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
      screenshot_url: pageRecord.desktopUrl,
      status: 'open',
      ai_generated: false
    });
  }

  return findings;
}
