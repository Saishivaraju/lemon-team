const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { createClient } = require('@supabase/supabase-js');
const { listCalls } = require('../services/vapi');

// --- MongoDB Model Setup ---
const DataSnapshotSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  data: { type: Object, default: {} }
}, { timestamps: true });

const DataSnapshot = mongoose.models.DataSnapshot || mongoose.model('DataSnapshot', DataSnapshotSchema);

const AGENT_EMAIL = process.env.AGENT_EMAIL || 'saishivaraju.m2002@gmail.com';

async function syncPreviousCalls() {
  console.log('🔄 Starting Historical Vapi Calls Synchronization...');
  
  // 1. Verify Vapi Configuration
  if (!process.env.VAPI_API_KEY) {
    console.error('❌ VAPI_API_KEY is missing in environment variables.');
    process.exit(1);
  }

  // 2. Connect to MongoDB
  console.log('⏳ Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  console.log('✅ MongoDB Connected.');

  // 3. Connect to Supabase
  console.log('⏳ Connecting to Supabase...');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  console.log('✅ Supabase Client Initialized.');

  // 4. Fetch Previous Vapi Calls
  console.log('⏳ Fetching historical call logs from Vapi...');
  const calls = await listCalls(50);
  console.log(`✅ Retrieved ${calls.length} historical calls from Vapi.`);

  if (calls.length === 0) {
    console.log('ℹ️ No call history found on Vapi. Exiting.');
    await mongoose.connection.close();
    return;
  }

  // 5. Load current MongoDB DataSnapshot
  let snapshot = await DataSnapshot.findOne({ email: AGENT_EMAIL });
  if (!snapshot) {
    snapshot = new DataSnapshot({ email: AGENT_EMAIL, data: {} });
  }
  if (!snapshot.data) snapshot.data = {};
  
  let pe_calls = snapshot.data.pe_calls || [];
  if (typeof pe_calls === 'string') {
    try { pe_calls = JSON.parse(pe_calls); } catch (e) { pe_calls = []; }
  }
  
  let pe_leads = snapshot.data.pe_leads || [];
  if (typeof pe_leads === 'string') {
    try { pe_leads = JSON.parse(pe_leads); } catch (e) { pe_leads = []; }
  }

  let syncCount = 0;
  let newLeadsCount = 0;

  for (const call of calls) {
    const callId = call.id;
    const phone = call.customer?.number || call.phone || null;
    if (!phone) continue;

    console.log(`\n🔍 Processing call ${callId} for ${phone}...`);

    // Check if call log is already in MongoDB Snapshot to prevent duplicates
    const isCallInMongo = pe_calls.some(c => c.id === callId);
    
    // Extract metadata
    const metadata = call.metadata || {};
    const leadId = metadata.leadId || null;
    const transcript = call.transcript || '';
    const recordingUrl = call.recordingUrl || null;
    const duration = call.durationSeconds || call.duration || 0;
    const createdAt = call.createdAt || new Date().toISOString();
    const endedReason = call.endedReason || 'unknown';
    const isFailed = ['customer-busy', 'customer-did-not-answer', 'voicemail', 'customer-did-not-pick-up', 'phone-number-not-found', 'network-error'].includes(endedReason);

    // Extract structured data if present
    const analysis = call.analysis || {};
    const structuredData = analysis.structuredData || {};

    const extractedLead = {
      name: call.customer?.name || metadata.name || 'Vapi Client',
      phone: phone,
      email: metadata.email || call.customer?.email || structuredData.email || structuredData.client_email || '',
      budget: structuredData.budget || metadata.budget || 'Flexible',
      bhk_preference: structuredData.bhk_preference || structuredData.bhkPreference || structuredData.bhk || 'N/A',
      pre_approval_status: structuredData.pre_approval_status || structuredData.preApprovalStatus || structuredData.preApproval || 'N/A',
      property_interest: structuredData.property_interest || structuredData.propertyInterest || metadata.interest || 'General Inquiry',
      notes: analysis.summary || transcript.substring(0, 500) || 'Synced from Vapi history.',
      qualification_score: parseInt(structuredData.qualification_score || structuredData.score || (structuredData.pre_approval_status === 'yes' ? 90 : 70)) || 70
    };

    // Calculate outcomes and scores
    const urgencyScore = extractedLead.qualification_score ? Math.min(10, Math.max(1, Math.round(extractedLead.qualification_score / 10))) : 5;
    let callOutcome = 'Prospective';
    if (duration < 10 || isFailed) {
      callOutcome = 'No Answer';
    } else if (transcript.toLowerCase().includes('bookvisit') || transcript.toLowerCase().includes('visit booked') || transcript.toLowerCase().includes('confirmed')) {
      callOutcome = 'Confirmed';
    }

    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    // A. Sync to Supabase Call Logs if not present
    try {
      const { data: existingLogs } = await sb.from('call_logs').select('id').eq('phone', phone).eq('duration_sec', Math.round(duration)).limit(1);
      if (!existingLogs || existingLogs.length === 0) {
        console.log(`💾 Saving call log to Supabase call_logs...`);
        await sb.from('call_logs').insert([{
          lead_id: leadId,
          agent_id: metadata.agentId || null,
          team_id: metadata.teamId || AGENT_EMAIL,
          phone,
          status: duration > 10 ? 'answered' : 'no_answer',
          duration_sec: Math.round(duration),
          transcript,
          recording_url: recordingUrl,
          called_at: createdAt
        }]);
      }
    } catch (e) {
      console.error(`Error saving to Supabase call_logs:`, e.message);
    }

    // B. Sync Lead to Supabase and pe_leads
    let finalLeadId = leadId;
    let existingLead = null;
    
    try {
      if (finalLeadId) {
        let { data } = await sb.from('team_leads').select('*').eq('id', finalLeadId).single();
        if (data) {
          existingLead = { table: 'team_leads', data };
        } else {
          let { data: lData } = await sb.from('leads').select('*').eq('id', finalLeadId).single();
          if (lData) existingLead = { table: 'leads', data: lData };
        }
      }
      
      if (!existingLead && phone) {
        let { data } = await sb.from('team_leads').select('*').eq('phone', phone).single();
        if (data) {
          existingLead = { table: 'team_leads', data };
          finalLeadId = data.id;
        } else {
          let { data: lData } = await sb.from('leads').select('*').eq('phone', phone).single();
          if (lData) {
            existingLead = { table: 'leads', data: lData };
            finalLeadId = lData.id;
          }
        }
      }

      if (existingLead) {
        console.log(`📝 Updating existing lead ${finalLeadId} in Supabase...`);
        const updates = {
          budget: extractedLead.budget,
          bhk_preference: extractedLead.bhk_preference,
          pre_approval_status: extractedLead.pre_approval_status,
          property_interest: extractedLead.property_interest,
          qualification_score: extractedLead.qualification_score,
          notes: (existingLead.data.notes || '') + `\n[Historical call summary]: ${extractedLead.notes}`
        };

        if (existingLead.table === 'team_leads') {
          await sb.from('team_leads').update({
            ...updates,
            stage: 'contacted',
            updated_at: new Date().toISOString()
          }).eq('id', finalLeadId);
        } else {
          await sb.from('leads').update({
            ...updates,
            status: 'Contacted'
          }).eq('id', finalLeadId);
        }

        // Sync to MongoDB pe_leads if not present
        const alreadyInMongoLeads = pe_leads.some(l => l.id == finalLeadId || l.phone == phone);
        if (!alreadyInMongoLeads) {
          pe_leads.unshift({
            id: finalLeadId,
            name: existingLead.data.name,
            phone: existingLead.data.phone,
            email: existingLead.data.email,
            property_interest: extractedLead.property_interest,
            budget: extractedLead.budget,
            bhk_preference: extractedLead.bhk_preference,
            pre_approval_status: extractedLead.pre_approval_status,
            qualification_score: extractedLead.qualification_score,
            source: existingLead.data.source || 'Vapi History',
            status: 'Contacted',
            pipeline_stage: 'Contacted',
            notes: updates.notes,
            created_at: createdAt
          });
          newLeadsCount++;
        }
      } else {
        // Create new historical lead in Supabase
        console.log(`➕ Creating new historical lead in Supabase...`);
        
        const newLeadRecord = {
          name: extractedLead.name,
          phone: phone,
          email: extractedLead.email,
          property_interest: extractedLead.property_interest,
          budget: extractedLead.budget,
          bhk_preference: extractedLead.bhk_preference,
          pre_approval_status: extractedLead.pre_approval_status,
          qualification_score: extractedLead.qualification_score,
          source: 'AI Historical Call',
          status: 'Contacted',
          notes: `[AI Historical Call Summary]: ${extractedLead.notes}`
        };

        let savedSbLead = null;
        try {
          const { data } = await sb.from('leads').insert([newLeadRecord]).select().single();
          if (data) savedSbLead = data;
        } catch (e) {}

        let savedTeamLead = null;
        try {
          const newTeamLeadRecord = {
            team_id: AGENT_EMAIL,
            name: newLeadRecord.name,
            phone: newLeadRecord.phone,
            email: newLeadRecord.email,
            property_interest: newLeadRecord.property_interest,
            budget: newLeadRecord.budget,
            source: newLeadRecord.source,
            stage: 'contacted',
            notes: newLeadRecord.notes
          };
          const { data } = await sb.from('team_leads').insert([newTeamLeadRecord]).select().single();
          if (data) savedTeamLead = data;
        } catch (e) {}

        finalLeadId = savedTeamLead?.id || savedSbLead?.id || ('lead_' + Date.now());

        // Sync to MongoDB pe_leads
        pe_leads.unshift({
          id: finalLeadId,
          name: newLeadRecord.name,
          phone: newLeadRecord.phone,
          email: newLeadRecord.email,
          property_interest: newLeadRecord.property_interest,
          budget: newLeadRecord.budget,
          bhk_preference: newLeadRecord.bhk_preference,
          pre_approval_status: newLeadRecord.pre_approval_status,
          qualification_score: newLeadRecord.qualification_score,
          source: newLeadRecord.source,
          status: 'Contacted',
          pipeline_stage: 'Contacted',
          notes: newLeadRecord.notes,
          created_at: createdAt
        });
        newLeadsCount++;
      }
    } catch (dbErr) {
      console.error(`Database operations failed for lead:`, dbErr.message);
    }

    // C. Sync to MongoDB Snapshot pe_calls
    if (!isCallInMongo) {
      console.log(`🔄 Adding call ${callId} to MongoDB pe_calls...`);

      // Format transcript
      const messages = call.messages || [];
      let formattedTranscript = [];
      if (messages.length > 0) {
        formattedTranscript = messages.map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.message || m.content || ''
        }));
      } else if (transcript.length > 0) {
        formattedTranscript = transcript.split('\n').map(line => {
          const parts = line.split(':');
          if (parts.length >= 2) {
            const role = parts[0].trim().toLowerCase().includes('assistant') ? 'assistant' : 'user';
            const content = parts.slice(1).join(':').trim();
            return { role, content };
          }
          return { role: 'user', content: line.trim() };
        }).filter(t => t.content);
      }

      pe_calls.unshift({
        id: callId,
        lead_name: extractedLead.name,
        urgency: urgencyScore,
        outcome: callOutcome,
        duration: durationStr,
        transcript: formattedTranscript,
        created_at: createdAt
      });
      
      syncCount++;
    } else {
      console.log(`ℹ️ Call ${callId} already present in MongoDB. Skipping.`);
    }
  }

  // 6. Save MongoDB snapshot modifications
  if (syncCount > 0 || newLeadsCount > 0) {
    console.log(`\n💾 Saving modified DataSnapshot with ${syncCount} new call logs and ${newLeadsCount} new leads...`);
    snapshot.data.pe_calls = pe_calls;
    snapshot.data.pe_leads = pe_leads;
    snapshot.markModified('data');
    await snapshot.save();
    console.log('✅ MongoDB DataSnapshot successfully updated.');
  } else {
    console.log('\nℹ️ No new call logs or leads to save to MongoDB.');
  }

  console.log(`\n✨ Synchronisation Complete!`);
  console.log(`- Synced Call Logs: ${syncCount}`);
  console.log(`- Synced / Created Leads: ${newLeadsCount}`);

  await mongoose.connection.close();
  console.log('🔌 Connection to MongoDB closed cleanly.');
}

syncPreviousCalls().catch(err => {
  console.error('❌ Sync script failed:', err);
  mongoose.connection.close();
});
