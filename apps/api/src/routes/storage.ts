import { Router, Request, Response } from 'express';
import { clerkAuth } from '../middleware/clerkAuth';
import { uploadScreenshot } from '../lib/supabaseStorage';
import { logger } from '../lib/logger';
import crypto from 'crypto';

const router: Router = Router();

/**
 * POST /api/storage/upload
 * Accepts { base64, fileName } and uploads to Supabase.
 */
router.post('/upload', clerkAuth, async (req: Request, res: Response) => {
  const { base64, fileName } = req.body;

  if (!base64) {
    return res.status(400).json({ error: 'base64 data is required' });
  }

  try {
    const buffer = Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ""), 'base64');
    const extension = fileName?.split('.').pop() || 'png';
    const randomName = `${crypto.randomBytes(16).toString('hex')}.${extension}`;
    const storagePath = `uploads/${randomName}`;

    const publicUrl = await uploadScreenshot(buffer, storagePath, {
      isPublic: true
    });

    return res.json({ url: publicUrl });
  } catch (error: any) {
    logger.error(error, 'Failed to upload image via base64');
    return res.status(500).json({ error: error.message });
  }
});

export { router as storageRouter };
