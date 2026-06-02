const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI;

const Schema = mongoose.Schema;
const DataSnapshotSchema = new Schema({
  email: { type: String, required: true, unique: true },
  data: { type: Object, default: {} }
}, { timestamps: true });

const DataSnapshot = mongoose.models.DataSnapshot || mongoose.model('DataSnapshot', DataSnapshotSchema);

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to MongoDB!");
  
  const snap = await DataSnapshot.findOne({ email: 'saishivaraju.m2002@gmail.com' });
  if (!snap) {
    console.log("No snapshot found for saishivaraju.m2002@gmail.com");
    process.exit(0);
  }
  
  console.log("Campaign Status:", snap.data.pe_campaign_status);
  console.log("Campaign Stats:", snap.data.pe_campaign_stats);
  console.log("Campaign Queue:", snap.data.pe_campaign_queue);
  console.log("Campaign Attempts:", snap.data.pe_campaign_attempts);
  
  const leads = snap.data.pe_leads || [];
  console.log(`Total Leads in Snapshot: ${leads.length}`);
  const targetLeads = leads.filter(l => l.name === 'sai' || l.name === 'anitha');
  console.log("Target Leads Details:", JSON.stringify(targetLeads, null, 2));
  
  process.exit(0);
}
run().catch(e => {
  console.error(e);
  process.exit(1);
});
