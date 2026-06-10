const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://elitederma.gogroth.com', { waitUntil: 'networkidle' });
  await page.waitForTimeout(10000); // wait for chatbot to load
  
  // Find all elements that might be a chatbot launcher (fixed/absolute at bottom right, high z-index, etc)
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('*')).filter(el => {
      const style = window.getComputedStyle(el);
      return (style.position === 'fixed' || style.position === 'absolute') &&
             parseInt(style.zIndex, 10) > 100 &&
             parseInt(style.bottom, 10) < 100 &&
             parseInt(style.right, 10) < 100;
    }).map(el => ({
      tagName: el.tagName,
      id: el.id,
      className: el.className,
      html: el.outerHTML.substring(0, 200)
    }));
  });
  console.log("Found floating elements:", buttons);
  await browser.close();
})();
