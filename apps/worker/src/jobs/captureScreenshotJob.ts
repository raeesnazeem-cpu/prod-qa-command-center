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

export async function processCaptureScreenshotJob(job: Job) {
  const { 
    url, 
    userId, 
    scrollX = 0, 
    scrollY = 0, 
    width = 1280, 
    height = 720,
    fullPage = false,
    viewportWidth,
    viewportHeight
  } = job.data;
  
  if (!url) throw new Error('URL is required for capture');

  const browser = await launchBrowser();

  try {
    // Use provided viewport dimensions or fallback to width/height
    const vWidth = Math.max(Math.floor(Number(viewportWidth)) || Math.floor(Number(width)) || 1280, 100);
    const vHeight = Math.max(Math.floor(Number(viewportHeight)) || Math.floor(Number(height)) || 720, 100);
    
    const finalScrollX = Math.max(0, Math.floor(Number(scrollX)) || 0);
    const finalScrollY = Math.max(0, Math.floor(Number(scrollY)) || 0);

    const page = await browser.newPage();
    await page.setViewport({ width: vWidth, height: vHeight, deviceScaleFactor: 1 });

    // Inject popup/cookie killer BEFORE navigation
    await injectPopupKiller(page);

    logger.info({ 
      url, 
      userId, 
      fullPage,
      viewport: `${vWidth}x${vHeight}`
    }, 'Capturing screenshot with robust parameters');

    // Navigate to URL - 'load' is more reliable than 'networkidle' for sites with constant trackers
    await page.goto(url, { timeout: 45000, waitUntil: 'load' });
    
    // Wait for content to stabilize and initial animations to settle
    await delay(3000);

    // Apply lazy-load wakeup logic ONLY if it's a full page capture
    if (fullPage) {
      logger.info({ url }, 'Waking up lazy loaders for full-page capture');
      
      await disableAnimations(page);
      await wakeUpLazyImages(page);
      
      // Wait for network to settle and final stabilize
      await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => null);
      await delay(5000);
    }
    else if (finalScrollX > 0 || finalScrollY > 0) {
      // Apply scroll position ONLY if not a full page capture
      try {
        await page.evaluate(({ x, y }) => {
          window.scrollTo(x, y);
        }, { x: finalScrollX, y: finalScrollY });
        
        await delay(1000);
      } catch (scrollErr) {
        logger.warn({ url, scrollErr }, 'Failed to apply scroll position');
      }
    }

    // Take screenshot (fullPage if requested)
    const buffer = await page.screenshot({ 
      fullPage: !!fullPage,
      captureBeyondViewport: true,
    });

    // Compress with sharp
    const compressedBuffer = await sharp(buffer)
      .jpeg({ quality: 85 })
      .toBuffer();

    // Upload to Supabase Storage using a public bucket for Basecamp accessibility
    const timestamp = Date.now();
    const storagePath = `capture/${userId || 'manual'}/${timestamp}.jpg`;
    
    const publicUrl = await uploadScreenshot(compressedBuffer, storagePath, {
      bucket: 'evidence',
      isPublic: true
    });
    
    logger.info({ url, storagePath }, 'Interactive screenshot captured and uploaded');
    
    return { imageUrl: publicUrl };

  } catch (error: any) {
    logger.error({ url, error: error.message }, 'Failed to capture interactive screenshot');
    throw error;
  } finally {
    await browser.close();
  }
}
