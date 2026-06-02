const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;
const AGENT_EMAIL = 'saishivaraju.m2002@gmail.com';

const DataSnapshotSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  data: { type: Object, required: true }
}, { timestamps: true });

const DataSnapshot = mongoose.models.DataSnapshot || mongoose.model('DataSnapshot', DataSnapshotSchema);

const RetrySchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  attempts: { type: Number, default: 0 },
  lead: { type: Object, required: true },
  retryAt: { type: Date, required: true }
}, { timestamps: true });

const PeRetry = mongoose.models.PeRetry || mongoose.model('PeRetry', RetrySchema);

async function reset() {
  console.log('⏳ Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected.');

  console.log('🧹 Clearing all pending retries...');
  await PeRetry.deleteMany({});
  console.log('✅ Retries cleared.');

  console.log('🔄 Resetting campaign snapshot state...');
  const snap = await DataSnapshot.findOne({ email: AGENT_EMAIL });
  if (snap && snap.data) {
    // Restore original campaign queue with the original Lead IDs
    snap.data.pe_campaign_queue = JSON.stringify(['mpv4twojvvrg', 'mpv0b8i6l2mx']);
    snap.data.pe_campaign_status = 'RUNNING';
    snap.data.pe_campaign_attempts = JSON.stringify({});
    snap.data.pe_campaign_stats = JSON.stringify({
      totalLeads: 2,
      callsCompleted: 0,
      bookings: 0,
      followUps: 0,
      noAnswers: 0,
      notInterested: 0
    });
    
    // Normalize status of the leads back to 'New' / no outcome
    let leads = typeof snap.data.pe_leads === 'string' ? JSON.parse(snap.data.pe_leads) : snap.data.pe_leads;
    if (Array.isArray(leads)) {
      leads = leads.map(l => {
        if (l.id === 'mpv4twojvvrg' || l.id === 'mpv0b8i6l2mx') {
          return {
            ...l,
            status: 'New',
            pipeline_stage: 'New',
            call_outcome: null,
            last_call_time: null
          };
        }
        return l;
      });
      snap.data.pe_leads = leads;
    }

    snap.markModified('data');
    await snap.save();
    console.log('✅ Campaign snapshot state restored to RUNNING with two leads.');
  } else {
    console.log('❌ Snapshot not found.');
  }

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB.');
}

reset().catch(console.error);
