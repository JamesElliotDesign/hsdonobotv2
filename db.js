// db.js
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

async function connectToDatabase() {
    if (!MONGODB_URI) {
        throw new Error('❌ MONGODB_URI is not set in environment variables.');
    }

    // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
    if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
        return;
    }

    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');
}

module.exports = { connectToDatabase };
