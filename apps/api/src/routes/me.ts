import { Router, Request, Response } from 'express';
import { clerkAuth } from '../middleware/clerkAuth';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

const router: Router = Router();

router.get('/', clerkAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const clerkUserId = (req.auth as any).clerkUserId;
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('clerk_user_id', clerkUserId)
      .single();

    if (error || !user) {
      logger.error({ error, userId }, 'User not found in Supabase');
      return res.status(404).json({ error: 'User not found in local database', userId });
    }

    return res.json(user);
  } catch (error) {
    logger.error(error, 'Error in /api/me');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/me/notifications
 * Returns recent notifications for the logged-in user.
 */
router.get('/notifications', clerkAuth, async (req: Request, res: Response) => {
  try {
    const { clerkUserId } = req.auth!;
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('clerk_user_id', clerkUserId)
      .single();

    if (!user) return res.status(404).json({ error: 'User not found' });

    const { data, error } = await supabase
      .from('notifications')
      .select(`
        *,
        activity:activity_logs (*)
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    return res.json(data);
  } catch (error: any) {
    logger.error(error, 'Error fetching notifications');
    return res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/me/notifications/:id/read
 * Marks a notification as read.
 */
router.patch('/notifications/:id/read', clerkAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id);

    if (error) throw error;
    return res.json({ success: true });
  } catch (error: any) {
    logger.error(error, 'Error marking notification as read');
    return res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/me/notifications/read-all
 * Marks all notifications as read for the user.
 */
router.patch('/notifications/read-all', clerkAuth, async (req: Request, res: Response) => {
  try {
    const { userId: clerkUserId } = req.auth!;
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('clerk_user_id', clerkUserId)
      .single();

    if (!user) return res.status(404).json({ error: 'User not found' });

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', user.id)
      .eq('is_read', false);

    if (error) throw error;
    return res.json({ success: true });
  } catch (error: any) {
    logger.error(error, 'Error marking all notifications as read');
    return res.status(500).json({ error: error.message });
  }
});

export { router as meRouter };