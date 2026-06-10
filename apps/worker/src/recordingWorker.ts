import { chromium } from 'playwright';
import { supabase } from './lib/supabase';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

async function autoScroll(page: any) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

async function run() {
  const targetUrl = process.env.TARGET_URL;
  const viewportType = process.env.VIEWPORT_TYPE || 'desktop';
  const runId = process.env.RUN_ID;
  const pageId = process.env.PAGE_ID;

  if (!targetUrl || !runId || !pageId) {
    console.error('Missing required environment variables: TARGET_URL, RUN_ID, PAGE_ID');
    process.exit(1);
  }

  console.log(`Starting recording for ${targetUrl} [${viewportType}]`);

  const viewports: Record<string, { width: number; height: number }> = {
    desktop: { width: 1920, height: 1080 },
    laptop: { width: 1366, height: 768 },
    tablet: { width: 768, height: 1024 },
    mobile: { width: 375, height: 667 },
  };

  const viewport = viewports[viewportType] || viewports.desktop;
  const videoDir = '/tmp/videos';

  if (!fs.existsSync(videoDir)) {
    fs.mkdirSync(videoDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport,
    recordVideo: {
      dir: videoDir,
      size: viewport,
    },
  });

  const page = await context.newPage();

  try {
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
    
    // Perform auto-scroll to trigger lazy loading and animations
    await autoScroll(page);
    
    // Wait a bit at the bottom
    await page.waitForTimeout(2000);

    // Close context to flush video
    await context.close();
    await browser.close();

    // Find the video file
    const videoFile = await page.video()?.path();
    if (!videoFile) {
      throw new Error('Video file not found');
    }

    const fileName = `${runId}/${pageId}_${viewportType}.webm`;
    const fileBuffer = fs.readFileSync(videoFile);

    console.log(`Uploading video to Supabase: ${fileName}`);
    const { error: uploadError } = await supabase.storage
      .from('recordings')
      .upload(fileName, fileBuffer, {
        contentType: 'video/webm',
        upsert: true,
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('recordings')
      .getPublicUrl(fileName);

    console.log(`Video uploaded successfully: ${publicUrl}`);

    // Update findings table
    // We fetch current video_urls to avoid overwriting other viewports
    const { data: finding, error: fetchError } = await supabase
      .from('findings')
      .select('video_urls')
      .match({ run_id: runId, page_id: pageId })
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 is "no rows found"
      throw fetchError;
    }

    const currentVideoUrls = finding?.video_urls || {};
    const updatedVideoUrls = {
      ...currentVideoUrls,
      [viewportType]: publicUrl,
    };

    const { error: updateError } = await supabase
      .from('findings')
      .update({ video_urls: updatedVideoUrls })
      .match({ run_id: runId, page_id: pageId });

    if (updateError) {
      throw updateError;
    }

    console.log('Database updated successfully');
    
    // Clean up local video file
    fs.unlinkSync(videoFile);

  } catch (error) {
    console.error('Error during recording process:', error);
    await browser.close();
    process.exit(1);
  }
}

run();
