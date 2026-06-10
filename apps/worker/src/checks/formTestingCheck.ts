import { Page as PlaywrightPage, BrowserContext } from 'playwright';
import { Finding } from '@qacc/shared';

export async function checkForms(page: PlaywrightPage, pageRecord: any): Promise<Finding[]> {
  const findings: Finding[] = [];
  const pageUrl = page.url();

  // Find all form elements that are not search forms and don't have action="#"
  const forms = await page.$$eval('form', (elements) => {
    return elements
      .map((form, index) => {
        const action = form.getAttribute('action');
        const id = form.getAttribute('id') || `form-${index}`;
        const className = form.className;
        const isSearch = 
          form.getAttribute('role') === 'search' || 
          id.toLowerCase().includes('search') || 
          className.toLowerCase().includes('search') ||
          form.querySelector('input[type="search"]') !== null;

        if (isSearch || action === '#') return null;

        return {
          index,
          id,
          action,
          html: form.outerHTML.substring(0, 500)
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);
  });

  if (forms.length === 0) return [];

  const browser = page.context().browser()!;

  for (const formInfo of forms) {
    let context: BrowserContext | null = null;
    try {
      // Use a separate browser context per form to avoid cross-contamination
      context = await browser.newContext();
      const formPage = await context.newPage();
      await formPage.goto(pageUrl, { waitUntil: 'load', timeout: 60000 });

      const formSelector = `form:nth-of-type(${formInfo.index + 1})`;
      const formElement = await formPage.$(formSelector);

      if (!formElement) continue;

      // Fill inputs
      const inputs = await formElement.$$('input, textarea, select');
      for (const input of inputs) {
        const type = await input.getAttribute('type');
        const name = (await input.getAttribute('name') || '').toLowerCase();
        const placeholder = (await input.getAttribute('placeholder') || '').toLowerCase();

        const tagName = await input.evaluate(el => el.tagName);
        if (type === 'submit' || type === 'button' || type === 'hidden') continue;

        if (type === 'email' || name.includes('email')) {
          await input.fill('qa-test@qacc.io');
        } else if (type === 'tel' || name.includes('phone') || name.includes('tel')) {
          await input.fill('01234567890');
        } else if (name.includes('name')) {
          await input.fill('QACC Test');
        } else if (tagName === 'TEXTAREA') {
          await input.fill('This is a QA automated test submission');
        } else if (type === 'text') {
          await input.fill('qa-test@qacc.io');
        }
      }

      // Submit the form
      const submitButton = await formElement.$('button[type="submit"], input[type="submit"]');
      if (submitButton) {
        await submitButton.click();
      } else {
        await formElement.evaluate((f: HTMLFormElement) => f.submit());
      }

      // Wait for confirmation (success message, redirect, or error)
      const confirmationFound = await Promise.race([
        // Check for common success indicators
        formPage.waitForSelector('.success, .thank-you, .wpcf7-response-output', { timeout: 5000 }).then(() => true),
        formPage.waitForFunction(() => {
          const text = document.body.innerText.toLowerCase();
          return text.includes('thank you') || 
                 text.includes('success') || 
                 text.includes('submitted') || 
                 text.includes('received') ||
                 text.includes('message sent');
        }, { timeout: 5000 }).then(() => true),
        // Check for redirect (URL change)
        formPage.waitForNavigation({ timeout: 5000 }).then(() => true)
      ]).catch(() => false);

      if (!confirmationFound) {
        findings.push({
          check_factor: 'forms',
          severity: 'high',
          title: 'Form submission unconfirmed',
          description: `A form on the page was submitted but no confirmation message or redirect was detected within 5 seconds.`,
          context_text: `Form ID: ${formInfo.id}\nAction: ${formInfo.action}\nPreview: ${formInfo.html}`,
          screenshot_url: pageRecord.desktopUrl,
          status: 'open',
          ai_generated: false
        } as Finding);
      }

    } catch (error: any) {
      console.error(`Error testing form ${formInfo.id}:`, error.message);
    } finally {
      if (context) await context.close();
    }
  }

  return findings;
}
