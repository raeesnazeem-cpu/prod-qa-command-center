const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto('https://elitederma.gogroth.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    console.error("Navigation timeout, but continuing");
  }
  await page.waitForTimeout(15000); // wait for chatbot to load
  
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('*')).filter(el => {
      const style = window.getComputedStyle(el);
      return (style.position === 'fixed' || style.position === 'absolute') &&
             parseInt(style.zIndex, 10) > 10 &&
             parseInt(style.bottom, 10) < 200 &&
             parseInt(style.right, 10) < 200;
    }).map(el => ({
      tagName: el.tagName,
      id: el.id,
      className: el.className,
      html: el.outerHTML.substring(0, 100)
    }));
  });
  console.log("Found floating elements:", buttons);
  await browser.close();
})();
