import { Router, Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { clerkAuth } from '../middleware/clerkAuth';
import { requireRole } from '../middleware/requireRole';

const router: Router = Router();

/**
 * Helper to get Supabase user UUID from Clerk ID
 */
async function getSupabaseUserId(clerkId: string): Promise<string> {
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('clerk_user_id', clerkId)
    .single();
  
  if (error || !data) {
    throw new Error(`User not synced: ${clerkId}`);
  }
  return data.id;
}

/**
 * POST /api/runs/:id/sign-off
 * Sign off on a completed QA run. Restricted to project_manager and above.
 */
router.post(
  '/:id/sign-off',
  clerkAuth,
  requireRole('project_manager'),
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { notes } = req.body;
    const { userId: clerkUserId } = req.auth!;

    try {
      const supabaseUserId = await getSupabaseUserId(clerkUserId);

      // 1. Verify run exists and is completed
      const { data: run, error: runError } = await supabase
        .from('qa_runs')
        .select('status')
        .eq('id', id)
        .single();

      if (runError || !run) {
        return res.status(404).json({ error: 'Run not found' });
      }

      if (run.status !== 'completed') {
        return res.status(400).json({ error: 'Only completed runs can be signed off' });
      }

      // 2. Check if already signed off
      const { data: existingSignOff } = await supabase
        .from('sign_offs')
        .select('id')
        .eq('run_id', id)
        .single();

      if (existingSignOff) {
        return res.status(400).json({ error: 'Run is already signed off' });
      }

      // 3. Create sign-off record
      const { data: signOff, error: signOffError } = await supabase
        .from('sign_offs')
        .insert({
          run_id: id,
          signed_by: supabaseUserId,
          notes: notes || null
        })
        .select()
        .single();

      if (signOffError) throw signOffError;

      return res.status(201).json(signOff);
    } catch (error: any) {
      console.error('[Sign-off Error]:', error);
      return res.status(500).json({ error: error.message });
    }
  }
);

export { router as signOffRouter };
