import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await page.goto("https://socialsharepreview.com/");
  const inputLocator = page.locator('input[type="url"], input[type="text"]').first();
  await inputLocator.fill("https://example.com");
  await inputLocator.press("Enter");
  
  await page.waitForTimeout(5000);
  
  const buttons = await page.$$eval('.preview-nav-item, li, button, a', els => {
    return els
      .filter(e => e.textContent && (e.textContent.includes('Facebook') || e.textContent.includes('Twitter') || e.textContent.includes('LinkedIn') || e.textContent.includes('X')))
      .map(e => ({ tag: e.tagName, text: e.textContent.trim().substring(0, 50), className: e.className }));
  });
  console.log("Found buttons:", buttons);

  await browser.close();
})();
