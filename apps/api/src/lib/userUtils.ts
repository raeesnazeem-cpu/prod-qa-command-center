import { supabase } from './supabase';

/**
 * Helper to get Supabase user UUID from Clerk ID.
 * Handles cases where the ID might already be a Supabase UUID.
 */
export async function getSupabaseUserId(clerkIdOrUuid: string): Promise<string> {
  if (!clerkIdOrUuid) throw new Error('clerkIdOrUuid is required');
  
  // If it's already a UUID, return it
  if (clerkIdOrUuid.length === 36 && clerkIdOrUuid.includes('-')) {
    return clerkIdOrUuid;
  }

  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('clerk_user_id', clerkIdOrUuid)
    .maybeSingle();
  
  if (error || !data) {
    throw new Error(`User not synced: ${clerkIdOrUuid}`);
  }
  return data.id;
}
