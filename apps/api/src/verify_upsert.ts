import 'dotenv/config';
import { supabase } from './lib/supabase';

async function verifyUpsert() {
  // 1. Get an org_id
  const { data: orgs, error: orgError } = await supabase
    .from('organizations')
    .select('id')
    .limit(1);

  if (orgError || !orgs || orgs.length === 0) {
    console.error('Could not find an organization to test with');
    return;
  }
  const orgId = orgs[0].id;
  const sourceId = '00000000-0000-0000-0000-000000000001';

  console.log('Testing upsert with orgId:', orgId);

  // 2. Perform upsert
  const { data, error } = await supabase
    .from('embeddings')
    .upsert({
      org_id: orgId,
      source_type: 'finding',
      source_id: sourceId,
      content: 'Test content for upsert verification',
      embedding: new Array(768).fill(0), // Dummy embedding
      updated_at: new Date().toISOString()
    }, { onConflict: 'source_type,source_id' })
    .select();

  if (error) {
    console.error('Upsert failed:', error.message);
  } else {
    console.log('Upsert succeeded!');
    console.log('Upserted record:', data);

    // 3. Test update (trigger check)
    console.log('Testing update for trigger...');
    const originalUpdatedAt = data?.[0].updated_at;
    
    // Wait a bit to ensure timestamp changes
    await new Promise(resolve => setTimeout(resolve, 1100));

    const { data: updatedData, error: updateError } = await supabase
      .from('embeddings')
      .update({ content: 'Updated content' })
      .eq('source_id', sourceId)
      .select();

    if (updateError) {
      console.error('Update failed:', updateError.message);
    } else {
      console.log('Update succeeded!');
      const newUpdatedAt = updatedData?.[0].updated_at;
      console.log('Original updated_at:', originalUpdatedAt);
      console.log('New updated_at:', newUpdatedAt);
      if (newUpdatedAt !== originalUpdatedAt) {
        console.log('Trigger works! updated_at was changed.');
      } else {
        console.warn('Trigger might not be working: updated_at stayed the same.');
      }
    }
  }
}

verifyUpsert();
