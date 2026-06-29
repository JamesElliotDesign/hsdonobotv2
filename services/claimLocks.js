// services/claimLocks.js
const crypto = require('crypto');
const ClaimLock = require('../models/ClaimLock');

function newOwnerId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return crypto.randomBytes(16).toString('hex');
}

async function acquireClaimLock(key, ttlMs) {
  const ownerId = newOwnerId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  try {
    await ClaimLock.create({ _id: key, ownerId, expiresAt });
    return { key, ownerId };
  } catch (err) {
    if (err && err.code !== 11000) {
      throw err;
    }
  }

  // If a previous process crashed, allow this claim to take over once the lock
  // is stale. The _id match keeps this atomic for the specific player/action.
  const stolen = await ClaimLock.findOneAndUpdate(
    { _id: key, expiresAt: { $lte: now } },
    { $set: { ownerId, expiresAt } },
    { new: true }
  );

  if (stolen && stolen.ownerId === ownerId) {
    return { key, ownerId };
  }

  return null;
}

async function releaseClaimLock(lock) {
  if (!lock) return;

  await ClaimLock.deleteOne({ _id: lock.key, ownerId: lock.ownerId });
}

module.exports = {
  acquireClaimLock,
  releaseClaimLock,
};
