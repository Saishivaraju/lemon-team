require('dotenv').config();
const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI;

const DataSnapshotSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  data: { type: Object, default: {} },
  last_sync: { type: Date, default: Date.now }
});

const PeRetrySchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true }
}, { strict: false });

const DataSnapshot = mongoose.models.DataSnapshot || mongoose.model('DataSnapshot', DataSnapshotSchema);
const PeRetry = mongoose.models.PeRetry || mongoose.model('PeRetry', PeRetrySchema, 'peretries');

async function run() {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    console.log('Connected to MongoDB.');

    // Wipe PeRetry collection
    await PeRetry.deleteMany({});
    console.log('Cleared all retry schedules (PeRetry collection).');

    const snapshots = await DataSnapshot.find({});
    for (let snap of snapshots) {
      if (snap.data) {
        snap.data.pe_leads = "[]";
        snap.data.pe_calls = "[]";
        snap.data.pe_bookings = "[]";
        snap.data.pe_notifications = "[]";
        snap.data.pe_campaign_queue = "[]";
        snap.data.pe_campaign_status = "IDLE";
        snap.markModified('data');
        await snap.save();
        console.log(`Wiped leads, calls, visits, and notifications for ${snap.email}`);
      }
    }
    
    console.log('All test data permanently removed from MongoDB.');
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}

run();
