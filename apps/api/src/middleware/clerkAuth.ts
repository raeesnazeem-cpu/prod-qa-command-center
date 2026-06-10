import { Request, Response, NextFunction } from 'express'
import { getAuth, clerkClient } from '@clerk/express'
import { supabase } from '../lib/supabase'
import { randomUUID } from 'crypto'

export interface AuthPayload {
  userId: string
  clerkUserId: string
  orgId: string | null
  role: string | null
  email: string | null
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload
    }
  }
}

export const clerkAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const auth = getAuth(req)

    if (!auth.userId) {
      console.error('--- Clerk Auth Failed: No User ID in Request ---')
      res.status(401).json({ error: 'Unauthorized', details: 'No active session found' })
      return
    }

    // 1. Get raw claims to extract name/email
    const claims = auth.sessionClaims as any;
    let email = claims?.email || claims?.primary_email_address || null;
    let firstName = claims?.first_name || claims?.given_name || '';
    let lastName = claims?.last_name || claims?.family_name || '';
    let fullName = claims?.full_name || claims?.name || (firstName ? `${firstName} ${lastName}`.trim() : null);

    // 1.5 Fallback to Clerk Backend API if claims are missing data
    if (!email || !fullName) {
      console.log(`[clerkAuth] Missing claims for ${auth.userId}, fetching from Clerk API...`);
      try {
        const fullClerkUser = await clerkClient.users.getUser(auth.userId);
        if (!email) {
          email = fullClerkUser.emailAddresses.find(e => e.id === fullClerkUser.primaryEmailAddressId)?.emailAddress || 
                  fullClerkUser.emailAddresses[0]?.emailAddress || null;
        }
        if (!fullName) {
          firstName = fullClerkUser.firstName || '';
          lastName = fullClerkUser.lastName || '';
          fullName = (firstName || lastName) ? `${firstName} ${lastName}`.trim() : null;
        }
      } catch (clerkErr) {
        console.error(`[clerkAuth] Failed to fetch user from Clerk API:`, clerkErr);
      }
    }

    // 2. Get role from Clerk if available (priority)
    let role = (auth.orgRole as string) || null
    let orgId: string | null = null

    // 3. Always fetch user from Supabase to get the internal UUID org_id and profile
    console.log(`[clerkAuth] Fetching user profile for ${auth.userId}...`);
    let { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('clerk_user_id', auth.userId)
      .maybeSingle()

    // 4. Synchronization: Update name/email if they changed or were missing in Supabase
    if (user && (fullName || email)) {
      const updates: any = {};
      if (fullName && (!user.full_name || user.full_name !== fullName)) updates.full_name = fullName;
      if (email && (!user.email || user.email !== email)) updates.email = email;
      
      if (Object.keys(updates).length > 0) {
        console.log(`[clerkAuth] Syncing profile updates for ${auth.userId}:`, updates);
        const { error: syncError } = await supabase.from('users').update(updates).eq('id', user.id);
        if (syncError) {
          console.error(`[clerkAuth] Failed to sync profile for ${auth.userId}:`, syncError);
        } else {
          // Refresh local user object
          user = { ...user, ...updates };
        }
      }
    }

    // 5. Self-healing: If user doesn't exist in Supabase, create them
    if (!user && !error) {
      console.log(`[clerkAuth] User ${auth.userId} not found in Supabase. Creating profile...`);
      
      // Ensure a default organization exists
      let { data: defaultOrg } = await supabase
        .from('organizations')
        .select('id')
        .limit(1)
        .maybeSingle()

      if (!defaultOrg) {
        console.log(`[clerkAuth] Creating default organization...`);
        const { data: newOrg, error: orgError } = await supabase
          .from('organizations')
          .insert({ name: 'Default Organization' })
          .select()
          .single()
        
        if (!orgError && newOrg) {
          defaultOrg = newOrg;
        }
      }

      if (defaultOrg) {
        const userId = randomUUID();
        console.log(`[clerkAuth] Inserting new user ${userId} for Clerk user ${auth.userId}`);
        
        const { data: newUser, error: insertError } = await supabase
          .from('users')
          .insert({
            id: userId,
            clerk_user_id: auth.userId,
            clerk_id: auth.userId,
            email: email,
            full_name: fullName || 'New User', // Ensure non-null if required
            role: 'developer', // Default role for new users
            org_id: defaultOrg.id
          })
          .select()
          .single()

        if (!insertError && newUser) {
          user = newUser;
          console.log(`[clerkAuth] Created new user profile for ${auth.userId} with UUID ${user.id}`);
        } else if (insertError) {
          console.error(`[clerkAuth] Failed to create user profile:`, insertError);
          // Even if insert fails, we might want to know why. 
          // Retry fetching on conflict
          if (insertError.code === '23505') { // Unique violation
             const { data: retryUser } = await supabase
              .from('users')
              .select('*')
              .eq('clerk_user_id', auth.userId)
              .maybeSingle();
             if (retryUser) user = retryUser;
          }
        }
      }
    }

    // 6. Resolve role and orgId
    if (user) {
      // Trust the database role as the primary source of truth for permissions
      // Clerk roles are only used as a fallback or for initial setup
      if (user.role) {
        // Normalize role string: lowercase and replace spaces/hyphens with underscores
        const normalized = user.role.toLowerCase().replace(/[\s-]/g, '_');
        // Map common variants to internal role names
        if (normalized === 'qa') role = 'qa_engineer';
        else role = normalized;
      } else if (role) {
        // Simple mapping for common Clerk roles if user.role is missing
        const clerkRole = role.toLowerCase().replace(/[\s-]/g, '_');
        if (clerkRole === 'org:admin' || clerkRole === 'admin') role = 'admin';
        else if (clerkRole === 'org:member' || clerkRole === 'member') role = 'developer';
        else if (clerkRole === 'qa') role = 'qa_engineer';
        else role = clerkRole;
      }
      
      // ALWAYS use the UUID from the database for orgId
      orgId = user.org_id;
    }

    // 7. Final safety check: if orgId is still null, find ANY organization
    if (!orgId) {
      console.log(`[clerkAuth] orgId still null for ${auth.userId}, attempting final fallback...`);
      const { data: fallbackOrg } = await supabase
        .from('organizations')
        .select('id')
        .limit(1)
        .maybeSingle()
      
      if (fallbackOrg) {
        orgId = fallbackOrg.id;
        // Update user so they have it next time
        await supabase.from('users').update({ org_id: orgId }).eq('clerk_user_id', auth.userId);
      }
    }

    // Map to our local AuthPayload format
    req.auth = {
      userId: user?.id || auth.userId, // Prefer Supabase UUID
      clerkUserId: auth.userId,      // Keep original Clerk ID for sync if needed
      orgId: orgId,
      role: role,
      email: email || user?.email || null,
    } as any;

    console.log('--- Clerk Auth Success ---')
    console.log('User:', req.auth?.userId, `(${fullName})`)
    console.log('Org:', req.auth?.orgId)
    console.log('Role:', req.auth?.role)

    next()
  } catch (err: any) {
    console.error('--- Clerk Auth Middleware Error ---')
    console.error('Error:', err.message)
    res.status(401).json({ error: 'Authentication failed', details: err.message })
  }
}
