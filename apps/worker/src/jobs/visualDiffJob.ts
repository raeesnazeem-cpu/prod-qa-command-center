import { Job } from 'bullmq';
import { supabase } from '../lib/supabase';
import { exportFigmaFrames, compareScreenshots, queueGeminiCall, FigmaFrame } from '@qacc/ai';
import { decrypt } from '../../../api/src/lib/encryption';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true },
  },
});

async function downloadBuffer(url: string | null | undefined): Promise<Buffer | undefined> {
  if (!url) return undefined;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error: any) {
    logger.warn({ url, error: error.message }, 'Failed to download image buffer');
    return undefined;
  }
}

export async function processVisualDiffJob(job: Job) {
  const { runId, pageId } = job.data;

  if (!runId || !pageId) {
    throw new Error('Missing runId or pageId in job data');
  }

  logger.info({ runId, pageId }, 'Starting visual diff job');

  // Step 1: Load page record + run record
  const { data: page, error: pageError } = await supabase
    .from('pages')
    .select('*, qa_runs!inner(figma_url, project_id)')
    .eq('id', pageId)
    .single();

  if (pageError || !page) {
    throw new Error(`Failed to load page or run details: ${pageError?.message}`);
  }

  const run = (page as any).qa_runs;
  if (!run.figma_url) {
    logger.warn({ runId }, 'No Figma URL provided for this run, skipping visual diff');
    return;
  }

  // Step 2: Get decrypted Figma token from project settings
  const { data: project, error: projectError } = await supabase
    .from('project_settings')
    .select('figma_token_encrypted')
    .eq('project_id', run.project_id)
    .single();

  if (projectError || !project?.figma_token_encrypted) {
    throw new Error('Figma token not found in project settings');
  }

  const figmaToken = decrypt(project.figma_token_encrypted);

  // Step 3: Export Figma frames
  logger.info({ figmaUrl: run.figma_url }, 'Exporting Figma frames...');
  const frames = await exportFigmaFrames(run.figma_url, figmaToken, supabase, runId);

  if (!frames || frames.length === 0) {
    logger.error({ figmaUrl: run.figma_url }, 'Figma exporter returned no frames');
    throw new Error('No Figma frames could be extracted from the provided URL. Please verify the URL and Figma token.');
  }

  // Step 4: Match frames to page URL
  let normalizedPagePath = '/';
  try {
    const urlObj = new URL(page.url);
    normalizedPagePath = urlObj.pathname.replace(/\/$/, '') || '/';
  } catch (e) {
    logger.warn({ url: page.url }, 'Invalid page URL, using / as path for matching');
  }
  
  logger.info({ normalizedPagePath, frameCount: frames.length }, 'Matching Figma frames to page path');
  
  // Try exact match first
  let matchedFrame = frames.find((f: FigmaFrame) => f.pageUrl === normalizedPagePath);
  
  // Try partial match if no exact match
  if (!matchedFrame) {
    matchedFrame = frames.find((f: FigmaFrame) => normalizedPagePath.includes(f.pageUrl) && f.pageUrl !== '/');
  }

  // Fallback to first frame if still no match
  if (!matchedFrame && frames.length > 0) {
    logger.warn({ normalizedPagePath }, 'No exact or partial frame match found, falling back to first available frame');
    matchedFrame = frames[0];
  }

  if (!matchedFrame) {
    throw new Error(`No Figma frames found to compare for path: ${normalizedPagePath}. Available frame paths: ${frames.map((f: FigmaFrame) => f.pageUrl).join(', ')}`);
  }

  // Step 5: Download Figma PNG and Site desktop screenshot
  logger.info({ matchedFrame: matchedFrame.frameName, frameUrl: matchedFrame.pageUrl }, 'Downloading images for comparison...');
  const figmaBuffer = await downloadBuffer(matchedFrame.imageUrl);
  
  if (!page.screenshot_url_desktop) {
    throw new Error('Site desktop screenshot is missing for this page');
  }

  // Site screenshot might have an expired signed URL in the DB, so we generate a fresh one
  const screenshotPath = `${runId}/${pageId}/desktop.png`;
  const { data: signedSite, error: signedSiteError } = await supabase.storage
    .from('screenshots')
    .createSignedUrl(screenshotPath, 3600);

  if (signedSiteError || !signedSite?.signedUrl) {
    logger.warn({ pageId, error: signedSiteError?.message }, 'Failed to generate fresh signed URL for site screenshot, falling back to DB URL');
  }

  const siteBuffer = await downloadBuffer(signedSite?.signedUrl || page.screenshot_url_desktop);

  if (!figmaBuffer || !siteBuffer) {
    throw new Error('Failed to download images for visual diff');
  }

  // Step 6: Call compareScreenshots (via queueGeminiCall)
  logger.info('Analyzing visual differences with Gemini...');
  const diffResult = await queueGeminiCall(() => compareScreenshots(figmaBuffer, siteBuffer, page.url));

  // Step 7: Insert into visual_diffs table
  const { data: visualDiff, error: diffError } = await supabase
    .from('visual_diffs')
    .insert({
      page_id: pageId,
      run_id: runId,
      figma_screenshot_url: matchedFrame.imageUrl,
      site_screenshot_url: page.screenshot_url_desktop,
      ai_summary: { issues: diffResult.issues },
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (diffError) {
    throw new Error(`Failed to save visual diff results: ${diffError.message}`);
  }

  // Step 8: Create findings of type 'visual_diff' for each identified issue
  if (diffResult.issues.length > 0) {
    const findings = diffResult.issues.map((issue: any) => ({
      run_id: runId,
      page_id: pageId,
      check_factor: 'visual_diff',
      severity: issue.severity,
      title: `[VISUAL DIFF] ${issue.type.toUpperCase()} in ${issue.area}`,
      description: issue.issue,
      status: 'open'
    }));

    const { error: findingsError } = await supabase.from('findings').insert(findings);
    if (findingsError) {
      logger.error({ error: findingsError.message }, 'Failed to create findings from visual diff');
    }
  }

  logger.info({ pageId, issuesFound: diffResult.issues.length }, 'Visual diff job completed successfully');
}
