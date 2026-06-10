import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { qaQueue } from '../lib/queue';
import { logger } from '../lib/logger';

const router: Router = Router();

/**
 * GET /api/pages/:id/visual-diff
 * Retrieves the visual diff results for a specific page.
 */
router.get('/pages/:id/visual-diff', async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from('visual_diffs')
      .select('*')
      .eq('page_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    res.json(data || null);
  } catch (error: any) {
    logger.error({ pageId: id, error: error.message }, 'Failed to fetch visual diff');
    res.status(500).json({ error: 'Failed to fetch visual diff results' });
  }
});

/**
 * POST /api/runs/:id/start-visual-diff
 * Enqueues visual_diff jobs for all completed pages in a run.
 */
router.post('/runs/:id/start-visual-diff', async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Get all completed pages for this run
    const { data: pages, error: pagesError } = await supabase
      .from('pages')
      .select('id')
      .eq('run_id', id)
      .eq('status', 'done');

    if (pagesError) throw pagesError;

    if (!pages || pages.length === 0) {
      return res.status(400).json({ error: 'No completed pages found for this run' });
    }

    // 2. Enqueue a visual_diff job for each page
    const jobs = pages.map(page => ({
      name: 'visual_diff',
      data: {
        runId: id,
        pageId: page.id
      },
      opts: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        }
      }
    }));

    await qaQueue.addBulk(jobs);

    logger.info({ runId: id, pageCount: pages.length }, 'Enqueued visual diff jobs for run');

    res.json({ 
      message: `Enqueued visual diff jobs for ${pages.length} pages`,
      pageCount: pages.length 
    });
  } catch (error: any) {
    logger.error({ runId: id, error: error.message }, 'Failed to start visual diff process');
    res.status(500).json({ error: 'Failed to start visual diff process' });
  }
});

export { router as visualDiffRouter };
