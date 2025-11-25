// dropVoteIndex.js
require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const uri = process.env.MONGODB_URI; // same as in your db.js
  if (!uri) {
    console.error("❌ MONGODB_URI is not set in .env");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');

  const db = mongoose.connection.db;
  const collection = db.collection('votes');

  // List current indexes on the votes collection
  const indexes = await collection.indexes();
  console.log('📋 Current indexes on votes:');
  console.log(indexes);

  // Try dropping the problematic index
  try {
    const result = await collection.dropIndex('provider_1_providerVoteId_1');
    console.log('✅ Dropped index provider_1_providerVoteId_1:', result);
  } catch (err) {
    console.error('❌ Error dropping index (maybe it does not exist):', err.message);
  }

  await mongoose.disconnect();
  console.log('✅ Disconnected');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
