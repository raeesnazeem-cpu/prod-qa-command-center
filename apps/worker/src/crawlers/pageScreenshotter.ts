import { launchBrowser, injectPopupKiller, disableAnimations, wakeUpLazyImages, delay } from '../lib/puppeteerBrowser';
import sharp from 'sharp';
import { uploadScreenshot } from '../lib/supabaseStorage';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true },
  },
});

interface Viewport {
  name: 'desktop' | 'tablet' | 'mobile';
  width: number;
  height: number;
}

const VIEWPORTS: Viewport[] = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 812 },
];

export interface ScreenshotResult {
  desktopUrl?: string;
  tabletUrl?: string;
  mobileUrl?: string;
  desktopBuffer?: Buffer;
  mobileBuffer?: Buffer;
}

/**
 * Captures full-page screenshots for a URL in multiple viewports,
 * compresses them, and uploads to Supabase Storage.
 */
export async function screenshotPage(
  url: string,
  runId: string,
  pageId: string,
  onProgress?: (progress: number, step: string) => Promise<void>
): Promise<ScreenshotResult> {
  const result: ScreenshotResult = {};

  let completedViewports = 0;
  const totalViewports = VIEWPORTS.length;

  for (const viewport of VIEWPORTS) {
    if (onProgress) {
      await onProgress(
        Math.round((completedViewports / totalViewports) * 100),
        `Capturing ${viewport.name} screenshot...`
      );
    }
    const browser = await launchBrowser();
    try {
      if (onProgress) {
        await onProgress(
          Math.min(99, Math.round((completedViewports / totalViewports) * 100) + 5),
          `Opening browser (${viewport.name})...`
        );
      }
      const page = await browser.newPage();
      await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });

      logger.info({ url, viewport: viewport.name }, `Taking screenshot`);

      if (onProgress) {
        await onProgress(
          Math.round((completedViewports / totalViewports) * 100) + 10,
          `Navigating to URL (${viewport.name})...`
        );
      }

      // Inject popup/cookie killer BEFORE navigation
      await injectPopupKiller(page);

      // Navigate to URL
      await page.goto(url, { timeout: 30000, waitUntil: 'load' });

      if (onProgress) {
        await onProgress(
          Math.round((completedViewports / totalViewports) * 100) + 15,
          `Waiting for ${viewport.name} content...`
        );
      }
      // Wait for Elementor or fallback to networkidle
      try {
        await page.waitForSelector('.elementor-section, .elementor-widget, .elementor', { 
          timeout: 15000 
        });
        logger.debug({ url, viewport: viewport.name }, 'Elementor detected');
      } catch (e) {
        logger.debug({ url, viewport: viewport.name }, 'Elementor not detected, waiting for networkidle');
        await page.waitForNetworkIdle({ timeout: 20000 }).catch(() => null);
      }

      if (onProgress) {
        await onProgress(
          Math.round((completedViewports / totalViewports) * 100) + 18,
          `Waking up lazy loaders (${viewport.name})...`
        );
      }

      await disableAnimations(page);
      await wakeUpLazyImages(page);
      
      // Wait for network to settle and final stabilize
      await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => null);
      await delay(5000);

      if (onProgress) {
        await onProgress(
          Math.round((completedViewports / totalViewports) * 100) + 20,
          `Capturing ${viewport.name} screenshot...`
        );
      }
      // Take full-page screenshot
      const buffer = await page.screenshot({ 
        fullPage: true,
        captureBeyondViewport: true,
      });

      if (onProgress) {
        await onProgress(
          Math.round((completedViewports / totalViewports) * 100) + 25,
          `Optimizing ${viewport.name} image...`
        );
      }
      // Compress with sharp
      const compressedBuffer = await sharp(buffer)
        .resize({ width: viewport.width, withoutEnlargement: true })
        .jpeg({ quality: 80 }) // Using jpeg for better compression of screenshots, though request says .png path
        .toBuffer();

      if (onProgress) {
        await onProgress(
          Math.round((completedViewports / totalViewports) * 100) + 30,
          `Uploading ${viewport.name} to cloud...`
        );
      }
      // Upload to Supabase Storage using utility (ensures bucket exists)
      const storagePath = `${runId}/${pageId}/${viewport.name}.png`;
      const publicUrl = await uploadScreenshot(compressedBuffer, storagePath);

      if (viewport.name === 'desktop') {
        result.desktopUrl = publicUrl;
        result.desktopBuffer = compressedBuffer;
      }
      if (viewport.name === 'tablet') result.tabletUrl = publicUrl;
      if (viewport.name === 'mobile') {
        result.mobileUrl = publicUrl;
        result.mobileBuffer = compressedBuffer;
      }

      completedViewports++;
      logger.info({ url, viewport: viewport.name }, 'Screenshot uploaded successfully');

    } catch (error: any) {
      logger.error({ url, viewport: viewport.name, error: error.message }, 'Failed to capture screenshot');
    } finally {
      await browser.close();
    }
  }

  if (onProgress) {
    await onProgress(100, 'Screenshots complete');
  }

  return result;
}
