import 'dotenv/config';
import { supabase } from './lib/supabase';

async function testQuery() {
  const { data: users, error } = await supabase
    .from('users')
    .select('id')
    .in('id', []);

  if (error) {
    console.error('Supabase .in([]) error:', error);
  } else {
    console.log('Supabase .in([]) result:', users);
  }
}

testQuery();
