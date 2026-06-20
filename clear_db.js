require('dotenv').config();
const mongoose = require('mongoose');
const { createClient } = require('@supabase/supabase-js');

async function clearDatabases() {
  console.log('🧹 Starting database wipe...');

  // 1. Clear MongoDB (DataSnapshots & Retries)
  if (process.env.MONGODB_URI) {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('✅ Connected to MongoDB');
      
      const collections = await mongoose.connection.db.collections();
      for (let collection of collections) {
        await collection.deleteMany({});
        console.log(`🗑️ Cleared MongoDB collection: ${collection.collectionName}`);
      }
    } catch (e) {
      console.error('❌ MongoDB Error:', e.message);
    }
  }

  // 2. Clear Supabase (Leads, Properties, Notifications, Visits)
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    try {
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
      console.log('✅ Connected to Supabase');

      const tables = ['team_leads', 'team_properties', 'team_notifications', 'team_visits', 'team_round_robin'];
      for (let table of tables) {
        const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all rows
        if (error) {
          console.error(`❌ Failed to clear Supabase table ${table}:`, error.message);
        } else {
          console.log(`🗑️ Cleared Supabase table: ${table}`);
        }
      }
    } catch (e) {
      console.error('❌ Supabase Error:', e.message);
    }
  }

  console.log('✨ All mock/test data has been successfully wiped. System is clean.');
  process.exit(0);
}

clearDatabases();
