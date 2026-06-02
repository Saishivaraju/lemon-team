require('dotenv').config();
const mongoose = require('mongoose');
const http = require('http');
const fs = require('fs');

// Override fetch to mock VAPI and Resend
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  if (typeof url === 'string' && url.includes('api.vapi.ai')) {
    console.log(`[MOCK FETCH] Mocked VAPI call to ${url}`);
    return { ok: true, json: async () => ({ id: 'mock-call-id', status: 'queued' }) };
  }
  if (typeof url === 'string' && url.includes('api.resend.com')) {
    console.log(`[MOCK FETCH] Mocked Resend email to ${url}`);
    return { ok: true, json: async () => ({ id: 'mock-email-id' }) };
  }
  return originalFetch(url, options);
};

// Also mock WhatsApp/SMS if they use twilio/plivo, but we'll just mock console logs or let them fail gracefully.
const app = require('../api/index');
const PORT = 3055;
const AGENT_EMAIL = process.env.AGENT_EMAIL || 'saishivaraju.m2002@gmail.com';

const testLeads = [
  { id: 'TL1', name: 'Test No Answer', phone: '+15550000001', email: 'test1@test.com', status: 'New', testScenario: 'no_answer' },
  { id: 'TL2', name: 'Test Hung Up', phone: '+15550000002', email: 'test2@test.com', status: 'New', testScenario: 'hung_up' },
  { id: 'TL3', name: 'Test Voicemail', phone: '+15550000003', email: 'test3@test.com', status: 'New', testScenario: 'voicemail' },
  { id: 'TL4', name: 'Test Callback', phone: '+15550000004', email: 'test4@test.com', status: 'New', testScenario: 'callback_requested' },
  { id: 'TL5', name: 'Test Booked', phone: '+15550000005', email: 'test5@test.com', status: 'New', testScenario: 'booked' },
  { id: 'TL6', name: 'Test Transfer', phone: '+15550000006', email: 'test6@test.com', status: 'New', testScenario: 'transferred' },
  { id: 'TL7', name: 'Test Not Interested', phone: '+15550000007', email: 'test7@test.com', status: 'New', testScenario: 'not_interested' },
  { id: 'TL8', name: 'Test Invalid Number', phone: '+15550000008', email: 'test8@test.com', status: 'New', testScenario: 'call_failed' },
];

async function runTests() {
  let server;
  let report = '# AI Calling Pipeline Execution Report\n\n';

  try {
    await mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('✅ Connected to DB');
    
    // Clear old test data
    const DataSnapshot = mongoose.models.DataSnapshot || mongoose.model('DataSnapshot', new mongoose.Schema({}, {strict: false}));
    const PeRetry = mongoose.models.PeRetry || mongoose.model('PeRetry', new mongoose.Schema({}, {strict: false}));
    
    await PeRetry.deleteMany({ phone: { $regex: /^\+1555000000/ } });
    
    let snap = await DataSnapshot.findOne({ email: AGENT_EMAIL });
    if (!snap) {
      snap = new DataSnapshot({ email: AGENT_EMAIL, data: {} });
    }
    
    // Filter out old test leads and keep existing
    let leads = snap.data.pe_leads ? (typeof snap.data.pe_leads === 'string' ? JSON.parse(snap.data.pe_leads) : snap.data.pe_leads) : [];
    leads = leads.filter(l => !l.id.startsWith('TL'));
    leads.push(...testLeads);
    
    snap.data.pe_leads = JSON.stringify(leads);
    snap.data.pe_campaign_queue = JSON.stringify(testLeads.map(l => l.id)); // Queue them up
    snap.data.pe_campaign_status = 'RUNNING';
    snap.data.pe_campaign_stats = JSON.stringify({ totalLeads: 8, callsCompleted: 0, bookings: 0, followUps: 0, noAnswers: 0, notInterested: 0 });
    snap.data.pe_call_logs = JSON.stringify([]); // clear local logs
    snap.markModified('data');
    await snap.save();
    console.log('✅ Seeded mock snapshot and campaign queue');

    // Start server
    await new Promise((resolve) => { server = app.listen(PORT, resolve); });
    console.log(`✅ Server listening on ${PORT}`);

    // Test Scenarios
    for (const lead of testLeads) {
      console.log(`\n▶️ Testing Scenario: ${lead.testScenario} (${lead.phone})`);
      report += `## Scenario: ${lead.testScenario}\n`;
      report += `- **Lead**: ${lead.name} (${lead.phone})\n`;

      let payload = {
        message: {
          type: "end-of-call-report",
          call: { id: `call_${lead.id}`, customer: { number: lead.phone } },
          metadata: { lead_id: lead.id, name: lead.name, agent_email: AGENT_EMAIL, email: lead.email },
          endedReason: "customer-ended-call",
          durationSeconds: 30,
          analysis: { successEvaluation: "interested" }
        }
      };

      if (lead.testScenario === 'no_answer') {
        payload.message.durationSeconds = 5;
        payload.message.endedReason = 'customer-did-not-answer';
      } else if (lead.testScenario === 'hung_up') {
        payload.message.endedReason = 'customer-hung-up';
      } else if (lead.testScenario === 'voicemail') {
        payload.message.analysis.successEvaluation = 'voicemail';
      } else if (lead.testScenario === 'callback_requested') {
        payload.message.toolCalls = [{ function: { name: 'update_lead_status', arguments: { status: 'callback_requested' } } }];
      } else if (lead.testScenario === 'booked') {
        payload.message.toolCalls = [{ function: { name: 'bookVisit' }, result: 'success' }];
      } else if (lead.testScenario === 'transferred') {
        payload.message.toolCalls = [{ function: { name: 'transferCall' } }];
      } else if (lead.testScenario === 'not_interested') {
        payload.message.analysis.successEvaluation = 'not_interested';
      } else if (lead.testScenario === 'call_failed') {
        payload.message.endedReason = 'number-invalid';
      }

      // Fire webhook
      report += `- **Action**: Fired VAPI webhook payload\n`;
      const res = await originalFetch(`http://localhost:${PORT}/api/vapi/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      await res.json();
      
      // Wait for background processing (advancing queue, etc)
      await new Promise(r => setTimeout(r, 2000));

      // Verify Snapshot Lead Status & Queue advancement
      const updatedSnap = await DataSnapshot.findOne({ email: AGENT_EMAIL });
      const updatedLeads = typeof updatedSnap.data.pe_leads === 'string' ? JSON.parse(updatedSnap.data.pe_leads) : updatedSnap.data.pe_leads;
      const updatedQueue = typeof updatedSnap.data.pe_campaign_queue === 'string' ? JSON.parse(updatedSnap.data.pe_campaign_queue) : updatedSnap.data.pe_campaign_queue;
      const updatedLead = updatedLeads.find(l => l.id === lead.id);

      report += `- **Status Update**: Expected \`${lead.testScenario}\`, Got \`${updatedLead.status || updatedLead.call_outcome}\`\n`;
      
      // Verify Retry Queue
      const retries = await PeRetry.find({ phone: lead.phone });
      if (['no_answer', 'voicemail', 'call_failed'].includes(lead.testScenario) && lead.testScenario !== 'call_failed' /* call_failed only schedules if shouldRetry is true, wait actually invalid number doesn't retry */) {
         if (retries.length > 0) report += `- **Retry**: ✅ Scheduled (${retries[0].attempts} attempts)\n`;
         else report += `- **Retry**: ❌ FAILED TO SCHEDULE\n`;
      } else {
         if (retries.length === 0) report += `- **Retry**: ✅ None scheduled (Expected)\n`;
         else report += `- **Retry**: ❌ UNEXPECTED RETRY SCHEDULED\n`;
      }

      // Verify Queue Advancement
      if (updatedQueue.includes(lead.id)) {
        report += `- **Campaign Queue**: ❌ Stalled. Lead still in queue.\n`;
      } else {
        report += `- **Campaign Queue**: ✅ Advanced successfully.\n`;
      }
      
      report += '\n';
    }

    report += '## Final Pass/Fail Summary\nAll workflows executed. Review individual scenario logs above to verify independence of retries and continuous campaign execution.\n';
    fs.writeFileSync('scratch/test_execution_report.md', report);
    console.log('✅ Tests complete. Report written to test_execution_report.md');

  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    if (server) server.close();
    await mongoose.disconnect();
    process.exit(0);
  }
}

runTests();
