import puppeteer, { Browser, Page } from 'puppeteer';

/**
 * Standard launch arguments for Puppeteer screenshots.
 * Uses headless: 'new' for full Chrome rendering fidelity.
 */
export const PUPPETEER_LAUNCH_OPTIONS = {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
  ],
};

/**
 * Promise-based delay. Replaces Playwright's page.waitForTimeout().
 */
export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Injects a popup/cookie-consent killer into the page BEFORE navigation.
 * Must be called after page creation but before page.goto().
 */
export async function injectPopupKiller(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(() => {
    // Run as early as possible — before any scripts load
    const killPopups = () => {
      // 1. CSS-hide known popup/cookie/chat selectors
      const hideSelectors = [
        // Cookie consent banners
        '#cookie-consent', '.cookie-banner', '.cc-banner', '.cc-window',
        '[class*="cookie-notice"]', '[class*="cookie-consent"]', '[id*="cookie"]',
        '.gdpr-banner', '#gdpr', '#gdpr-consent', '.cookie-notice',
        '#CybotCookiebotDialog', '#onetrust-consent-sdk', '.qc-cmp2-container',
        '[id*="cookiebot"]', '[class*="cookiebot"]',
        // Newsletter / promo popups
        '.popup-overlay', '.modal-overlay', '[class*="newsletter-popup"]',
        '[class*="exit-intent"]', '[class*="email-popup"]',
        // Chat widgets
        '#intercom-container', '#intercom-frame',
        '.tawk-widget', '#tawk-tooltip', '[class*="tawk"]',
        '#drift-widget', '#drift-frame-controller',
        '.crisp-client', '#crisp-chatbox',
        '[class*="livechat"]', '[id*="livechat"]',
        // Generic modal/overlay patterns
        '[class*="modal-backdrop"]', '[class*="overlay"][class*="popup"]',
      ];

      const style = document.createElement('style');
      style.id = 'qa-popup-killer';
      style.textContent = hideSelectors.map(s => `${s}`).join(',\n') +
        ` { display: none !important; visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; z-index: -9999 !important; }`;
      
      const target = document.head || document.documentElement;
      if (target) {
        target.appendChild(style);
      }

      // 2. Click common "Accept" / "Close" buttons
      const acceptSelectors = [
        '[class*="accept"]', '[id*="accept"]',
        'button[class*="agree"]', '.cc-accept', '.cc-btn',
        '[class*="cookie"] button', '[class*="consent"] button',
        '#onetrust-accept-btn-handler', '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
        'button[class*="dismiss"]', '[class*="close-popup"]',
      ];

      acceptSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(btn => {
          try { (btn as HTMLElement).click(); } catch (e) {}
        });
      });

      // 3. Remove overflow:hidden from body (often set by modals)
      if (document.body) document.body.style.overflow = '';
      if (document.documentElement) document.documentElement.style.overflow = '';
    };

    // Fire immediately if DOM is ready
    if (document.readyState !== 'loading') {
      killPopups();
    }

    // Also fire on DOMContentLoaded and load for late popups
    document.addEventListener('DOMContentLoaded', killPopups);
    window.addEventListener('load', () => {
      killPopups();
      // Delayed re-fire for popups that appear after a timer
      setTimeout(killPopups, 2000);
      setTimeout(killPopups, 5000);
    });

    // MutationObserver to catch dynamically injected popups
    const observer = new MutationObserver(killPopups);
    const startObserving = () => {
      const target = document.body || document.documentElement;
      if (target) {
        observer.observe(target, {
          childList: true, subtree: true,
        });
      }
    };
    if (document.body) startObserving();
    else document.addEventListener('DOMContentLoaded', startObserving);
  });
}

/**
 * Injects CSS to disable all animations and transitions.
 */
export async function disableAnimations(page: Page): Promise<void> {
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      *, *::before, *::after {
        transition: none !important;
        animation: none !important;
        scroll-behavior: auto !important;
      }
      [class*="skeleton"], [class*="loading-placeholder"], [class*="shimmer"] {
        opacity: 0 !important;
        visibility: hidden !important;
      }
    `;
    const target = document.head || document.documentElement;
    if (target) {
      target.appendChild(style);
    }
  });
}

/**
 * Forces all lazy-loaded images to load eagerly.
 */
export async function wakeUpLazyImages(page: Page): Promise<void> {
  // 1. Force eager loading attributes
  await page.evaluate(() => {
    const images = document.querySelectorAll('img');
    images.forEach(img => {
      img.setAttribute('loading', 'eager');
      const lazyAttributes = ['data-src', 'data-srcset', 'data-original', 'lazy-src'];
      lazyAttributes.forEach(attr => {
        if (img.hasAttribute(attr)) {
          if (attr === 'data-srcset') {
            img.srcset = img.getAttribute(attr)!;
          } else {
            img.src = img.getAttribute(attr)!;
          }
        }
      });
    });
  });

  // 2. Scroll to bottom to trigger IntersectionObserver-based lazy loaders
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 300;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight || totalHeight > 15000) {
          clearInterval(timer);
          resolve();
        }
      }, 150);
    });
  });

  // 3. Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));

  // 4. Wait for all images to decode
  await page.evaluate(async () => {
    const images = Array.from(document.querySelectorAll('img'));
    await Promise.all(images.map(img => {
      if (img.complete) return (img as any).decode?.().catch(() => null);
      return new Promise((resolve) => {
        img.addEventListener('load', () => (img as any).decode?.().then(resolve).catch(resolve));
        img.addEventListener('error', resolve);
      });
    }));
  });
}

/**
 * Launches a Puppeteer browser with standard options.
 */
export async function launchBrowser(): Promise<Browser> {
  return puppeteer.launch(PUPPETEER_LAUNCH_OPTIONS);
}
