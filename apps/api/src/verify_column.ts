import 'dotenv/config';
import { supabase } from './lib/supabase';

async function verifyColumn() {
  const { data, error } = await supabase
    .from('embeddings')
    .select('updated_at')
    .limit(1);

  if (error) {
    console.error('Column updated_at does NOT exist or error:', error.message);
  } else {
    console.log('Column updated_at exists!');
    console.log('Sample data:', data);
  }
}

verifyColumn();
