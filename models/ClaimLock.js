// models/ClaimLock.js
const mongoose = require('mongoose');

const ClaimLockSchema = new mongoose.Schema(
  {
    // Use _id as the unique lock key, e.g. token:7656119...
    _id: { type: String, required: true },
    ownerId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// MongoDB removes expired locks eventually. The claim code also checks expiresAt
// directly, so it does not rely on the TTL cleanup being immediate.
ClaimLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('ClaimLock', ClaimLockSchema);
