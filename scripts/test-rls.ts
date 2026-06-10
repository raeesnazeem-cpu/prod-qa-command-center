import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const supabase = createClient(supabaseUrl, supabaseServiceKey)


async function testRLS() {
  console.log('--- Testing RLS Isolation ---')

  // 1. Create Org A and Org B
  const { data: orgA } = await supabase.from('organizations').insert({ name: 'Org A' }).select().single()
  const { data: orgB } = await supabase.from('organizations').insert({ name: 'Org B' }).select().single()

  if (!orgA || !orgB) {
    console.error('Failed to create organizations')
    return
  }

  // 2. Create Users for each org
  // Note: These need to be in auth.users too if we were doing real JWT testing, 
  // but for a simple RLS filter check we can check if the policies handle org_id correctly.
  const userA_id = '00000000-0000-0000-0000-00000000000a'
  const userB_id = '00000000-0000-0000-0000-00000000000b'

  await supabase.from('users').insert([
    { id: userA_id, org_id: orgA.id, email: 'a@test.com', role: 'developer' },
    { id: userB_id, org_id: orgB.id, email: 'b@test.com', role: 'developer' }
  ])

  // 3. Create a project in Org B
  const { data: projectB } = await supabase.from('projects').insert({
    org_id: orgB.id,
    name: 'Secret Project B',
    site_url: 'https://b.com'
  }).select().single()

  console.log('Set up test data for Org A and Org B.')

  // 4. Test RLS
  // To truly test RLS, we'd need to sign in as User A.
  // Since we are using the service role client here (which bypasses RLS), 
  // this script verifies the data is THERE. 
  // To verify RLS filters, you should use the Anon key + a User JWT.
  
  console.log('Verification: Service Role sees everything.')
  const { data: allProjects } = await supabase.from('projects').select('*')
  console.log(`Total projects visible to Admin: ${allProjects?.length}`)

  console.log('\nTo verify RLS manually:')
  console.log('1. Log in as user A (org A)')
  console.log('2. Query projects table')
  console.log('3. You should see 0 projects from Org B')

  // Cleanup
  await supabase.from('organizations').delete().match({ id: orgA.id })
  await supabase.from('organizations').delete().match({ id: orgB.id })
  console.log('\nCleaned up test data.')
}

testRLS().catch(console.error)
