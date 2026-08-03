import { Router, Request, Response } from 'express';
import { Webhook } from 'svix';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { randomUUID } from 'crypto';

export const webhookRouter: Router = Router();

const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET || '';

webhookRouter.post('/clerk', async (req: Request, res: Response) => {
  console.log('=== WEBHOOK DEBUG ===');
  console.log('Headers:', req.headers);
  console.log('Body type:', typeof req.body);
  console.log('Body is Buffer:', Buffer.isBuffer(req.body));
  
  if (!CLERK_WEBHOOK_SECRET) {
    console.error('CLERK_WEBHOOK_SECRET is not set');
    logger.error('CLERK_WEBHOOK_SECRET is not set');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  // Get headers for verification
  const svix_id = req.headers['svix-id'] as string;
  const svix_timestamp = req.headers['svix-timestamp'] as string;
  const svix_signature = req.headers['svix-signature'] as string;

  console.log('Svix headers:', { svix_id, svix_timestamp, svix_signature: svix_signature ? 'present' : 'missing' });

  if (!svix_id || !svix_timestamp || !svix_signature) {
    console.error('Missing svix headers');
    return res.status(400).json({ error: 'Missing svix headers' });
  }

  // Clerk sends raw body for signature verification.
  // Since we use express.raw() in index.ts, req.body is a Buffer.
  const payload = req.body;
  console.log('Payload length:', payload?.length || 'undefined');
  
  const wh = new Webhook(CLERK_WEBHOOK_SECRET);

  let evt: any;

  try {
    evt = wh.verify(payload, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    });
    console.log('Webhook verified successfully');
  } catch (err) {
    console.error('Webhook verification failed:', err);
    logger.error(err, 'Webhook signature verification failed');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const { id, type, data } = evt;
  console.log('Webhook event:', { id, type });
  logger.info({ type, id }, 'Received Clerk webhook event');

  try {
    if (type === 'user.created') {
      console.log('Processing user.created event');
      const { id: clerk_id, email_addresses, first_name, last_name } = data;
      const email = email_addresses[0]?.email_address;
      const full_name = `${first_name || ''} ${last_name || ''}`.trim();
      
      console.log('User data:', { clerk_id, email, full_name });

      // Check if this is the first user in the system
      const { count } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true });

      console.log('Current user count:', count);
      const role = (count === 0) ? 'super_admin' : 'developer';
      console.log('Assigned role:', role);

      // 1. Ensure an organization exists
      let { data: org } = await supabase
        .from('organizations')
        .select('id')
        .limit(1)
        .maybeSingle();

      if (!org) {
        const { data: newOrg, error: orgError } = await supabase
          .from('organizations')
          .insert({ name: 'Default Organization' })
          .select()
          .single();
        
        if (orgError || !newOrg) {
          console.error('Error creating default organization:', orgError);
          throw orgError || new Error('Failed to create default organization');
        }
        org = newOrg;
      }

      if (!org) {
        throw new Error('Critical: No organization found or created');
      }

      console.log('Using organization:', org.id);

      const { error } = await supabase
        .from('users')
        .insert({
          id: randomUUID(), // Generate UUID for the required id field
          clerk_user_id: clerk_id, // Store Clerk user ID in clerk_user_id column
          clerk_id: clerk_id, // Also store in clerk_id for reference
          email,
          full_name,
          role,
          org_id: org.id,
        });

      if (error) {
        console.error('Supabase insert error:', error);
        throw error;
      }
      console.log('User successfully created in Supabase');
      logger.info({ clerk_id, role }, 'User created in Supabase via webhook');
    }

    if (type === 'user.updated') {
      const { id: clerk_id, email_addresses, first_name, last_name } = data;
      const email = email_addresses[0]?.email_address;
      const full_name = `${first_name || ''} ${last_name || ''}`.trim();

      const { error } = await supabase
        .from('users')
        .update({
          email,
          full_name,
        })
        .eq('clerk_id', clerk_id);

      if (error) throw error;
      logger.info({ clerk_id }, 'User updated in Supabase via webhook');
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    logger.error(error, `Error processing webhook event: ${type}`);
    return res.status(500).json({ error: 'Database sync failed' });
  }
});

// --- TED Webhook Receiver ---
// This endpoint will be available at POST /webhooks/ted
webhookRouter.post('/ted', async (req: Request, res: Response) => {
  try {
    // 1. The body comes in as raw bytes (Buffer) because of how /webhooks is configured in index.ts.
    // We convert those bytes into text, and then parse it into a standard JSON object.
    const payload = JSON.parse(req.body.toString());

    // 2. We extract the secret password that TED sent inside the payload's headers block.
    const secret = payload?.headers?.['X-TED-Webhook-Secret'];
    
    // 3. We define the exact password we expect (we check the environment variables first, 
    // and fallback to the hardcoded sample password you provided).
    const expectedSecret = process.env.TED_WEBHOOK_SECRET || 'ted_tok_3ba0f5sdfsdfwefwevcefwf';

    // 4. We check if the password provided matches our expected password.
    // If it doesn't match, we immediately reject the request as Unauthorized (status 401).
    if (secret !== expectedSecret) {
      logger.warn('Unauthorized TED webhook attempt: Invalid secret');
      return res.status(401).json({ error: 'Unauthorized: Invalid secret' });
    }

    // 5. If the password is correct, we check what kind of event happened.
    if (payload.event === 'TASK_UPDATED' || payload.event === 'TASK_STATUS_CHANGED') {
      // Check if the project/task was just marked as ready to release
      // (Adjust the exact status text if TED uses a slightly different wording like "Ready for Release")
      if (payload.data?.status === 'Ready to Release' || payload.data?.status === 'Ready for Release') {
        console.log('Project is marked as Ready to Release! Triggering QACC pre-release workflow...');
        console.log('Project Data:', payload.data);
        
        // Note: This is exactly where we will write the code to trigger QACC's pre-release.
        // e.g., await triggerPreRelease(payload.data.id);
      }
    }

    // 6. We send a successful 200 OK response back to TED so they know we got the message.
    return res.status(200).json({ success: true, message: 'Webhook securely verified' });
    
  } catch (error) {
    // 7. If the JSON was completely broken, we catch the error so the server doesn't crash.
    logger.error(error, 'Error processing TED webhook');
    return res.status(400).json({ error: 'Invalid payload format' });
  }
});
