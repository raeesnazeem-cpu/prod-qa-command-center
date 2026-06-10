const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');
const crypto = require('crypto');

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET;

if (!supabaseUrl || !supabaseServiceKey || !ENCRYPTION_SECRET) {
  console.error('Missing Supabase or Encryption credentials in apps/worker/.env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY = crypto.scryptSync(ENCRYPTION_SECRET, 'qacc-salt', 32);

function decrypt(encryptedText) {
  const [ivBase64, authTagBase64, encrypted] = encryptedText.split(':');
  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function main() {
  const projectId = '5f03b951-9379-44d8-a2fd-3e577504975a';
  const { data: projectSettings } = await supabase
    .from('project_settings')
    .select('*')
    .eq('project_id', projectId)
    .single();

  const { basecamp_token_encrypted, basecamp_account_id } = projectSettings;
  const token = decrypt(basecamp_token_encrypted);

  const headers = {
    'Authorization': `Bearer ${token}`,
    'User-Agent': 'QACC (raees.nazeem@growth99.com)',
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  const accountId = basecamp_account_id;
  const bucketId = '47276246'; // COCO Beauty Bar project
  const messageId = '9890477171'; // 01. Project Order Details

  const msgUrl = `https://3.basecampapi.com/${accountId}/buckets/${bucketId}/messages/${messageId}.json`;
  
  try {
    const response = await axios.get(msgUrl, { headers });
    console.log(`Title: ${response.data.title || response.data.subject}`);
    console.log(`Content HTML:\n`, response.data.content);

    const cleanText = response.data.content.replace(/<[^>]*>/g, ' ');
    console.log(`Cleaned Text:\n`, cleanText);

    // Test if regex works
    const match = cleanText.match(/Growth99\s+Plan:\s*([^\n\r]+)/i);
    if (match) {
      console.log(`\n>>> Extracted Plan Value:`, match[1].trim());
    } else {
      console.log('\n>>> Regex failed! Splitting:');
      const idx = cleanText.toLowerCase().indexOf('growth99 plan:');
      if (idx !== -1) {
        const sub = cleanText.substring(idx + 'growth99 plan:'.length).trim();
        console.log('Fallback extracted Plan:', sub.split(/\r?\n/)[0].trim());
      }
    }
  } catch (err) {
    console.error('API Error message:', err.message);
  }
}

main().catch(err => console.error(err));
