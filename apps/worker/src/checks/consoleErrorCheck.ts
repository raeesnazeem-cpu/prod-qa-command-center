import { Page as PlaywrightPage } from 'playwright';
import { Finding } from '@qacc/shared';

/**
 * Checks for console errors and critical page crashes.
 * IMPORTANT: This function attaches listeners and should be called 
 * BEFORE page.goto() to capture initial load errors.
 */
export async function checkConsoleErrors(page: PlaywrightPage, pageRecord: any): Promise<Finding[]> {
  const errors = new Set<string>();
  const criticalErrors = new Set<string>();

  // Attach listeners to capture errors during the page lifecycle
  page.on('console', msg => {
    if (msg.type() === 'error' && (errors.size + criticalErrors.size) < 80) {
      errors.add(msg.text());
    }
  });

  page.on('pageerror', err => {
    if ((errors.size + criticalErrors.size) < 80) {
      criticalErrors.add(err.message);
    }
  });

  // Wait for the page to finish loading or reach a stable state
  // This allows errors to propagate and be caught by the listeners
  try {
    await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
    // Small buffer for async/delayed errors
    await page.waitForTimeout(3000);
  } catch (e) {
    // Ignore timeout errors, we want to return whatever findings we caught
  }

  const findings: Finding[] = [];

  if (criticalErrors.size > 0) {
    findings.push({
      check_factor: 'console_errors',
      severity: 'critical',
      title: `${criticalErrors.size} Critical Runtime Errors`,
      description: `The page encountered critical JavaScript execution errors that may prevent it from functioning correctly:\n${Array.from(criticalErrors).join('\n')}`,
      context_text: Array.from(criticalErrors).join(' | '),
      screenshot_url: pageRecord.desktopUrl,
      status: 'open',
      ai_generated: false
    });
  }

  if (errors.size > 0) {
    findings.push({
      check_factor: 'console_errors',
      severity: 'high',
      title: `${errors.size} Console Errors Detected`,
      description: `JavaScript errors were logged to the console during the page session:\n${Array.from(errors).join('\n')}`,
      context_text: Array.from(errors).join(' | '),
      screenshot_url: pageRecord.desktopUrl,
      status: 'open',
      ai_generated: false
    });
  }

  return findings;
}
