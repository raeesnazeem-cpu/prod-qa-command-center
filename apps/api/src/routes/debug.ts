import { Router, Request, Response } from 'express';
import { supabase } from '../lib/supabase';

export const debugRouter: Router = Router();

debugRouter.get('/env', (req: Request, res: Response) => {
  res.json({
    clerkWebhookSecretSet: !!process.env.CLERK_WEBHOOK_SECRET,
    supabaseUrlSet: !!process.env.SUPABASE_URL,
    supabaseServiceKeySet: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    clerkSecretKeySet: !!process.env.CLERK_SECRET_KEY,
    // Note: Never return actual secrets in production!
  });
});

debugRouter.get('/webhook-test', (req: Request, res: Response) => {
  res.json({
    message: 'Webhook endpoint is reachable',
    timestamp: new Date().toISOString(),
    headers: req.headers,
  });
});

debugRouter.get('/users', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('users')
    .select('*');
  
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  
  return res.json({ users: data, count: data?.length || 0 });
});

debugRouter.get('/webhook-log', async (req: Request, res: Response) => {
  // Simple endpoint to log all webhook requests
  res.json({
    message: 'Webhook logger endpoint',
    timestamp: new Date().toISOString(),
    method: req.method,
    headers: req.headers,
    query: req.query,
  });
});

debugRouter.post('/webhook-log', async (req: Request, res: Response) => {
  // Log any POST requests to see if Clerk is trying to reach us
  console.log('=== WEBHOOK REQUEST RECEIVED ===');
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  console.log('Timestamp:', new Date().toISOString());
  console.log('=== END WEBHOOK REQUEST ===');
  
  res.json({
    message: 'Webhook request logged',
    timestamp: new Date().toISOString(),
    received: true,
  });
});

debugRouter.get('/user-by-clerk-id/:clerkId', async (req: Request, res: Response) => {
  const { clerkId } = req.params;
  
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('clerk_user_id', clerkId)
    .single();
  
  if (error) {
    return res.status(404).json({ error: 'User not found', details: error.message });
  }
  
  return res.json(data);
});

debugRouter.post('/promote-user', async (req: Request, res: Response) => {
  const { clerkId, role } = req.body;
  
  if (!clerkId || !role) {
    return res.status(400).json({ error: 'clerkId and role are required' });
  }

  const { data, error } = await supabase
    .from('users')
    .update({ role })
    .eq('clerk_user_id', clerkId)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ message: `User ${clerkId} promoted to ${role}`, user: data });
});

debugRouter.get('/projects', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, org_id, is_pre_release');
  
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  
  return res.json({ projects: data, count: data?.length || 0 });
});

debugRouter.get('/organizations', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('organizations')
    .select('*');
  
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  
  return res.json({ organizations: data, count: data?.length || 0 });
});
