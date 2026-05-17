const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { saveLeadToSupabase, saveVisitToSupabase } = require('../services/supabase');

async function testSupabase() {
  console.log('🧪 Testing Supabase Connection and Operations...');
  console.log('SUPABASE_URL:', process.env.SUPABASE_URL);
  console.log('SUPABASE_ANON_KEY:', process.env.SUPABASE_ANON_KEY ? 'Present (starts with ' + process.env.SUPABASE_ANON_KEY.substring(0, 5) + ')' : 'Missing');

  const testLead = {
    name: 'Test Lead Persistence',
    email: 'test-persistence@example.com',
    phone: '+15555555555',
    property_interest: 'Test Villa',
    notes: 'Testing database persistence from agent agent calling workflow.',
    source: 'AI Call Test',
    status: 'New',
    budget: '$2,000,000',
    bhk_preference: '4BHK',
    pre_approval_status: 'yes',
    qualification_score: 95
  };

  console.log('\n1. Testing saveLeadToSupabase...');
  const leadRes = await saveLeadToSupabase(testLead);
  console.log('Lead Save Result:', leadRes);

  if (leadRes.success) {
    const savedLead = leadRes.data;
    console.log('✅ Lead saved successfully in Supabase!');

    console.log('\n2. Testing saveVisitToSupabase with saved lead ID...');
    const testVisit = {
      property_name: 'Test Villa',
      client_name: savedLead.name,
      client_email: savedLead.email,
      client_phone: savedLead.phone,
      visit_date: '2026-06-01',
      visit_time: '14:30:00',
      status: 'confirmed',
      notes: 'Test booking visit linked to lead.',
      qualification_id: savedLead.id
    };

    const visitRes = await saveVisitToSupabase(testVisit);
    console.log('Visit Save Result:', visitRes);
    if (visitRes.success) {
      console.log('✅ Visit saved successfully in Supabase!');
    } else {
      console.log('❌ Visit save FAILED.');
    }
  } else {
    console.log('❌ Lead save FAILED, skipping visit test.');
  }
}

testSupabase().catch(err => {
  console.error('❌ Critical Test Error:', err);
});
