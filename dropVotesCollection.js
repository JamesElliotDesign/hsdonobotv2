// dropVotesCollection.js
require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected');

  await mongoose.connection.db.dropCollection('votes').catch(err => {
    if (err.codeName === 'NamespaceNotFound') {
      console.log('⚠️ Collection votes does not exist, nothing to drop.');
    } else {
      throw err;
    }
  });

  console.log('✅ Dropped votes collection');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
