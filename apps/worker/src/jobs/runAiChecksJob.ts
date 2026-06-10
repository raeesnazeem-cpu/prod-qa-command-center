import { Job } from 'bullmq';
import { supabase } from '../lib/supabase';
import { auditPageText } from '@qacc/ai';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true },
  },
});

export async function processRunAiChecksJob(job: Job) {
  const { runId, pageId, pageUrl, pageText } = job.data;

  if (!runId || !pageId || !pageText) {
    logger.error({ runId, pageId, pageText }, 'Missing required data for run_ai_checks job');
    return;
  }

  logger.info({ runId, pageId, pageUrl }, 'Starting AI content audit');

  try {
    const aiFindings = await auditPageText(pageText, pageUrl);

    if (aiFindings && aiFindings.length > 0) {
      logger.info({ pageId, count: aiFindings.length }, 'Inserting AI findings');
      
      const findingsToInsert = aiFindings.map(f => ({
        ...f,
        page_id: pageId,
        run_id: runId,
        ai_generated: true,
        status: 'open'
      }));

      const { error: insertError } = await supabase
        .from('findings')
        .insert(findingsToInsert);

      if (insertError) {
        logger.error({ pageId, error: insertError.message }, 'Failed to insert AI findings');
      } else {
        logger.info({ pageId, count: aiFindings.length }, 'AI findings inserted successfully');
      }
    } else {
      logger.info({ pageId }, 'No AI findings detected');
    }
  } catch (error: any) {
    logger.error({ pageId, error: error.message }, 'Error during AI content audit');
    // We don't necessarily want to fail the whole job if AI fails, 
    // but we log it for debugging.
  }
}
