require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const { connectDB } = require('../api/index'); // ensure you can connect, or just connect directly

const MONGODB_URI = process.env.MONGODB_URI;

const DataSnapshotSchema = new mongoose.Schema({
  email: String,
  data: Object
}, { timestamps: true });

const DataSnapshot = mongoose.models.DataSnapshot || mongoose.model('DataSnapshot', DataSnapshotSchema);

async function runAudit() {
  if (!MONGODB_URI) {
    console.error("❌ MONGODB_URI missing");
    process.exit(1);
  }

  console.log("🔍 Connecting to DB for Health Audit...");
  await mongoose.connect(MONGODB_URI);
  console.log("✅ Connected. Fetching Snapshots...");

  const snapshots = await DataSnapshot.find({});
  
  console.log(`\n==============================================`);
  console.log(`📊 ZORVO AI SYSTEM HEALTH AUDIT`);
  console.log(`==============================================`);

  let totalLeads = 0;
  let totalCalls = 0;
  let stuckQueues = 0;

  for (const snap of snapshots) {
    const data = snap.data || {};
    
    // Parse strings if necessary
    const leads = typeof data.pe_leads === 'string' ? JSON.parse(data.pe_leads || '[]') : (data.pe_leads || []);
    const calls = typeof data.pe_calls === 'string' ? JSON.parse(data.pe_calls || '[]') : (data.pe_calls || []);
    const queue = typeof data.pe_campaign_queue === 'string' ? JSON.parse(data.pe_campaign_queue || '[]') : (data.pe_campaign_queue || []);
    const status = data.pe_campaign_status || 'IDLE';

    totalLeads += leads.length;
    totalCalls += calls.length;

    console.log(`\n👤 Agent: ${snap.email}`);
    console.log(`   - Leads: ${leads.length}`);
    console.log(`   - Call Logs: ${calls.length}`);
    console.log(`   - Campaign Status: [${status}]`);
    console.log(`   - Queue Size: ${queue.length}`);

    if (status === 'RUNNING' && queue.length === 0) {
      console.log(`   ⚠️ WARNING: Campaign is RUNNING but queue is EMPTY.`);
      stuckQueues++;
    }

    if (status === 'IDLE' && queue.length > 0) {
      console.log(`   ⚠️ WARNING: Campaign is IDLE but queue has ${queue.length} pending leads.`);
      stuckQueues++;
    }

    const failedCalls = calls.filter(c => c.status === 'failed' || c.status === 'error');
    if (failedCalls.length > 0) {
      console.log(`   ❌ ERROR: Found ${failedCalls.length} failed calls in logs.`);
    }
  }

  console.log(`\n==============================================`);
  console.log(`📈 AUDIT SUMMARY:`);
  console.log(`   - Total Agents: ${snapshots.length}`);
  console.log(`   - Total Leads: ${totalLeads}`);
  console.log(`   - Total Calls Logged: ${totalCalls}`);
  console.log(`   - Stuck Queues Detected: ${stuckQueues}`);
  console.log(`==============================================`);

  process.exit(0);
}

runAudit();
