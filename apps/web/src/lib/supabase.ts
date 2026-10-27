import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// The browser only uses Supabase for Realtime (all data goes through the API).
// The AWS build has no Supabase at all, so these are unset there; createClient
// throws on an empty URL, so build an inert client instead of crashing at import.
// Nothing calls it with VITE_REALTIME_ENABLED=false.
if (!supabaseUrl || !supabaseAnonKey) {
  console.info('Supabase not configured; realtime features are off');
}

export const supabase = createClient(
  supabaseUrl || 'http://supabase.invalid',
  supabaseAnonKey || 'unused',
);
