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
      if (snap.data && snap.data.pe_leads) {
        let leads = snap.data.pe_leads;
        let wasString = typeof leads === 'string';
        if (wasString) {
          try { leads = JSON.parse(leads); } catch (e) { leads = []; }
        }
        
        if (Array.isArray(leads)) {
          console.log(`Processing ${snap.email}, starting with ${leads.length} leads.`);
          
          const uniqueLeads = [];
          const seen = new Set();
          
          for (let l of leads) {
            // Identifier is phone, or email if phone is missing, or name if both missing
            const identifier = l.phone || l.email || l.name;
            if (!identifier) continue;
            
            if (!seen.has(identifier)) {
              seen.add(identifier);
              uniqueLeads.push(l);
            }
          }
          
          console.log(`Finished ${snap.email}, kept ${uniqueLeads.length} leads. Removed ${leads.length - uniqueLeads.length} duplicates.`);
          
          snap.data.pe_leads = wasString ? JSON.stringify(uniqueLeads) : uniqueLeads;
          snap.markModified('data');
          await snap.save();
        }
      }
    }
    
    console.log('Deduplication complete.');
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}

run();
