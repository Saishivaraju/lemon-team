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
  const snap = await DataSnapshot.findOne({ email: 'saishivaraju.m2002@gmail.com' });
  if (!snap) {
    console.log("No snapshot found");
    process.exit(0);
  }
  
  console.log("=========================================");
  console.log("Campaign Status:", snap.data.pe_campaign_status);
  console.log("Campaign Stats:", typeof snap.data.pe_campaign_stats === 'string' ? JSON.parse(snap.data.pe_campaign_stats) : snap.data.pe_campaign_stats);
  console.log("Campaign Queue:", typeof snap.data.pe_campaign_queue === 'string' ? JSON.parse(snap.data.pe_campaign_queue) : snap.data.pe_campaign_queue);
  console.log("Campaign Attempts:", typeof snap.data.pe_campaign_attempts === 'string' ? JSON.parse(snap.data.pe_campaign_attempts) : snap.data.pe_campaign_attempts);
  console.log("=========================================");
  
  process.exit(0);
}
run();
