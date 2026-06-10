import { launchBrowser, injectPopupKiller, disableAnimations, wakeUpLazyImages, delay } from '../lib/puppeteerBrowser';
import sharp from 'sharp';
import { uploadScreenshot } from '../lib/supabaseStorage';
import pino from 'pino';
import { Job } from 'bullmq';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true },
  },
});

const VIEWPORTS = [
  { width: 1920, height: 1080, label: 'desktop' },
  { width: 1366, height: 768, label: 'laptop' },
  { width: 768, height: 1024, label: 'tablet' },
  { width: 390, height: 844, label: 'mobile' },
];

export async function processCaptureMultiviewScreenshotsJob(job: Job) {
  const { url, userId } = job.data;
  
  if (!url) throw new Error('URL is required for capture');

  logger.info({ url, userId }, 'Starting multiview screenshot capture');

  const browser = await launchBrowser();

  const results: Record<string, string> = {};

  try {
    for (const vp of VIEWPORTS) {
      logger.info({ url, viewport: vp.label }, `Capturing ${vp.label} view...`);
      
      const page = await browser.newPage();
      await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });

      try {
        // Inject popup/cookie killer BEFORE navigation
        await injectPopupKiller(page);

        // Navigate to URL
        await page.goto(url, { timeout: 60000, waitUntil: 'load' });
        
        // Disable animations + wake up lazy loaders
        await disableAnimations(page);
        await wakeUpLazyImages(page);

        // Wait for network to settle + final stabilize
        await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => null);
        await delay(5000);

        // Take full-page screenshot
        const buffer = await page.screenshot({ 
          fullPage: true,
          captureBeyondViewport: true,
        });

        // Compress with sharp
        const compressedBuffer = await sharp(buffer)
          .jpeg({ quality: 85 })
          .toBuffer();

        // Upload to Supabase
        const timestamp = Date.now();
        const storagePath = `capture/${userId || 'manual'}/multiview_${vp.label}_${timestamp}.jpg`;
        
        const publicUrl = await uploadScreenshot(compressedBuffer, storagePath, {
          bucket: 'evidence',
          isPublic: true
        });

        results[vp.label] = publicUrl;
      } catch (err: any) {
        logger.error({ url, viewport: vp.label, error: err.message }, `Failed to capture ${vp.label} view`);
        results[vp.label] = ''; // Or handle failure differently
      } finally {
        await page.close();
      }
    }

    return results;

  } catch (error: any) {
    logger.error({ url, error: error.message }, 'Failed multiview screenshot job');
    throw error;
  } finally {
    await browser.close();
  }
}
