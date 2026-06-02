require('dotenv').config();
const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI || "mongodb+srv://saishivarajum2002:Sai456@cluster0.zoxng.mongodb.net/zorvo_dev?retryWrites=true&w=majority&appName=Cluster0";

const DataSnapshotSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  data: { type: Object, default: {} },
  last_sync: { type: Date, default: Date.now }
});

const DataSnapshot = mongoose.models.DataSnapshot || mongoose.model('DataSnapshot', DataSnapshotSchema);

async function run() {
  try {
    await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('Connected to MongoDB.');

    const snapshots = await DataSnapshot.find({});
    for (let snap of snapshots) {
      if (snap.data) {
        snap.data.pe_leads = "[]";
        snap.data.pe_calls = "[]";
        snap.markModified('data');
        await snap.save();
        console.log(`Wiped leads for ${snap.email}`);
      }
    }
    
    console.log('All leads permanently removed from MongoDB.');
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}

run();
