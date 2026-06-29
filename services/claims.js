// services/claims.js
const crypto = require('crypto');
const Vote = require('../models/Vote');
const Donation = require('../models/Donation');
const SteamLink = require('../models/SteamLink');
const { spawnItemOnPlayer } = require('./cftoolsGameLabs');
const { acquireClaimLock, releaseClaimLock } = require('./claimLocks');

// Classnames
const DONATION_TOKEN_CLASS = 'HackSaw_Dono_Coin';      // Hacksaw Tokens
const VOTE_TOKEN_CLASS = 'Hacksaw_Reward_Coin';        // Reward Tokens

// Short-lived command lock. This blocks rapid duplicate Enter presses while the
// first claim is in flight. The permanent anti-dupe guard is the processing
// state stored on Donation/Vote before CFTools is called.
const CLAIM_LOCK_MS = 5 * 60 * 1000;

// Rank ID Card classnames (credited based on total donations)
const RANK_CARD_LABELS = {
  HS_RANKIDAMETHYST: 'Amethyst Rank ID Card',
  HS_RANKIDJADE: 'Jade Rank ID Card',
  HS_RANKIDAMBER: 'Amber Rank ID Card',
  HS_RANKIDRUBY: 'Ruby Rank ID Card',
  HS_RANKIDIOLITE: 'Iolite Rank ID Card',
  HS_RANKIDTURQUOISE: 'Turquoise Rank ID Card',
  HS_RANKIDAQUAMARINE: 'Aquamarine Rank ID Card',
  HS_RANKIDDIAMOND: 'Diamond Rank ID Card',
};

function newClaimId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return crypto.randomBytes(16).toString('hex');
}

function getLockWindow() {
  const now = new Date();
  const lockUntil = new Date(now.getTime() + CLAIM_LOCK_MS);
  return { now, lockUntil };
}

function voteIsUnclaimedFilter(now) {
  return {
    claimed: false,
    $and: [
      {
        $or: [
          { claimStatus: 'unclaimed' },
          { claimStatus: { $exists: false } },
          { claimStatus: null },
        ],
      },
      {
        // If a previous bot version left a txn id behind, treat it as pending
        // review rather than automatically making it claimable again.
        $or: [
          { claimTxnId: { $exists: false } },
          { claimTxnId: null },
        ],
      },
      {
        $or: [
          { claimLockUntil: { $exists: false } },
          { claimLockUntil: null },
          { claimLockUntil: { $lte: now } },
        ],
      },
    ],
  };
}

function voteIsProcessingFilter() {
  return {
    claimed: false,
    $or: [
      { claimStatus: 'processing' },
      {
        $and: [
          { claimTxnId: { $exists: true, $ne: null } },
          {
            $or: [
              { claimStatus: { $exists: false } },
              { claimStatus: null },
              { claimStatus: 'unclaimed' },
            ],
          },
        ],
      },
    ],
  };
}

async function hasVoteProcessingClaim(steamId64) {
  const count = await Vote.countDocuments({
    steamId64,
    ...voteIsProcessingFilter(),
  });

  return count > 0;
}

async function findDonationBySteamId(steamId64) {
  const link = await SteamLink.findOne({ steamId64 }).lean();
  if (!link) return { link: null, donation: null };

  const donation = await Donation.findOne({ discordId: link.discordId });
  return { link, donation };
}

function hasDonationProcessingClaim(donation) {
  return Boolean(donation && (donation.donationClaimProcessingTokens || 0) > 0);
}

function hasRankProcessingClaim(donation) {
  return Boolean(
    donation &&
    Array.isArray(donation.rankClaimProcessingCards) &&
    donation.rankClaimProcessingCards.length > 0
  );
}

/**
 * Payout all unclaimed vote rewards (Reward Tokens) for a given SteamID64.
 *
 * Hardened anti-dupe flow:
 * - Acquires a MongoDB-backed per-SteamID token command lock.
 * - Moves every eligible Vote row to claimStatus=processing BEFORE CFTools is called.
 * - If CFTools returns 204, finalizes the rows as claimed.
 * - If CFTools errors or the bot crashes mid-claim, rows stay processing and cannot
 *   be claimed again until staff resolves them with /resolveclaim.
 */
async function payOutVoteRewards(steamId64) {
  const lock = await acquireClaimLock(`token:${steamId64}`, CLAIM_LOCK_MS);
  if (!lock) {
    return { tokensPaid: 0, votesUpdated: 0, reason: 'claim_in_progress' };
  }

  try {
    if (await hasVoteProcessingClaim(steamId64)) {
      return { tokensPaid: 0, votesUpdated: 0, reason: 'claim_pending_review' };
    }

    const claimId = newClaimId();
    const { now, lockUntil } = getLockWindow();

    const reserveResult = await Vote.updateMany(
      {
        steamId64,
        ...voteIsUnclaimedFilter(now),
      },
      {
        $set: {
          claimStatus: 'processing',
          claimTxnId: claimId,
          claimProcessingStartedAt: now,
          claimLockUntil: lockUntil,
        },
      }
    );

    const reservedCount = reserveResult.modifiedCount || reserveResult.nModified || 0;

    if (reservedCount === 0) {
      return { tokensPaid: 0, votesUpdated: 0, reason: 'no_unclaimed_tokens' };
    }

    const reservedVotes = await Vote.find({
      steamId64,
      claimed: false,
      claimStatus: 'processing',
      claimTxnId: claimId,
    });

    const totalRewardTokens = reservedVotes.reduce(
      (sum, v) => sum + (v.rewardTokens || 0),
      0
    );

    if (totalRewardTokens <= 0) {
      await Vote.updateMany(
        { steamId64, claimed: false, claimStatus: 'processing', claimTxnId: claimId },
        {
          $set: {
            claimed: true,
            claimStatus: 'claimed',
            claimedAt: new Date(),
            claimSource: 'in-game',
          },
          $unset: {
            claimTxnId: '',
            claimLockUntil: '',
            claimProcessingStartedAt: '',
          },
        }
      );

      return { tokensPaid: 0, votesUpdated: reservedVotes.length, reason: 'no_unclaimed_tokens' };
    }

    console.log(`[CLAIM] Spawning ${totalRewardTokens}x ${VOTE_TOKEN_CLASS} on ${steamId64} (claim ${claimId})`);

    try {
      await spawnItemOnPlayer(steamId64, VOTE_TOKEN_CLASS, totalRewardTokens, true);
    } catch (err) {
      console.error('❌ Failed to spawn vote tokens. Claim left in processing for staff review:', err.response?.data || err);

      await Vote.updateMany(
        { steamId64, claimed: false, claimStatus: 'processing', claimTxnId: claimId },
        {
          $unset: {
            claimLockUntil: '',
          },
        }
      );

      err.claimLeftProcessing = true;
      throw err;
    }

    const voteIds = reservedVotes.map((v) => v._id);
    const claimedAt = new Date();

    await Vote.updateMany(
      { _id: { $in: voteIds }, claimed: false, claimStatus: 'processing', claimTxnId: claimId },
      {
        $set: {
          claimed: true,
          claimStatus: 'claimed',
          claimedAt,
          claimSource: 'in-game',
        },
        $unset: {
          claimTxnId: '',
          claimLockUntil: '',
          claimProcessingStartedAt: '',
        },
      }
    );

    return {
      tokensPaid: totalRewardTokens,
      votesUpdated: voteIds.length,
      reason: 'ok',
    };
  } finally {
    await releaseClaimLock(lock);
  }
}

/**
 * Payout donation rewards (Hacksaw Tokens) for a given SteamID64.
 *
 * Hardened anti-dupe flow:
 * - Acquires a MongoDB-backed per-SteamID token command lock.
 * - Moves the user's current unclaimed token balance into a processing/spent
 *   field BEFORE CFTools is called.
 * - New donations that arrive while the claim is processing stay unclaimed for
 *   a later claim.
 * - If CFTools errors or the bot crashes mid-claim, the processing amount cannot
 *   be claimed again until staff resolves it with /resolveclaim.
 */
async function payOutDonationRewards(steamId64) {
  const link = await SteamLink.findOne({ steamId64 }).lean();
  if (!link) {
    return { tokensPaid: 0, reason: 'no_steam_link' };
  }

  const lock = await acquireClaimLock(`token:${steamId64}`, CLAIM_LOCK_MS);
  if (!lock) {
    return { tokensPaid: 0, reason: 'claim_in_progress' };
  }

  try {
    const existingDonation = await Donation.findOne({ discordId: link.discordId });
    if (!existingDonation) {
      return { tokensPaid: 0, reason: 'no_donation_record' };
    }

    if (hasDonationProcessingClaim(existingDonation)) {
      return { tokensPaid: 0, reason: 'claim_pending_review' };
    }

    const claimId = newClaimId();
    const { now, lockUntil } = getLockWindow();

    const donation = await Donation.findOneAndUpdate(
      {
        discordId: link.discordId,
        unclaimedDonationTokens: { $gt: 0 },
        $or: [
          { donationClaimLockUntil: { $exists: false } },
          { donationClaimLockUntil: null },
          { donationClaimLockUntil: { $lte: now } },
        ],
        $and: [
          {
            $or: [
              { donationClaimProcessingTokens: { $exists: false } },
              { donationClaimProcessingTokens: 0 },
              { donationClaimProcessingTokens: null },
            ],
          },
        ],
      },
      {
        $set: {
          donationClaimLockId: claimId,
          donationClaimLockUntil: lockUntil,
        },
      },
      {
        new: true,
      }
    );

    if (!donation) {
      return { tokensPaid: 0, reason: 'no_unclaimed_tokens' };
    }

    const reservedAmount = donation.unclaimedDonationTokens || 0;
    if (reservedAmount <= 0) {
      await Donation.updateOne(
        { _id: donation._id, donationClaimLockId: claimId },
        { $unset: { donationClaimLockId: '', donationClaimLockUntil: '' } }
      );

      return { tokensPaid: 0, reason: 'no_unclaimed_tokens' };
    }

    // This is the key hardening step: remove the tokens from the claimable
    // balance before CFTools is called. If the process crashes after CFTools
    // accepts the spawn, these tokens are not visible as unclaimed on restart.
    const processingResult = await Donation.updateOne(
      {
        _id: donation._id,
        donationClaimLockId: claimId,
        unclaimedDonationTokens: { $gte: reservedAmount },
      },
      {
        $inc: {
          unclaimedDonationTokens: -reservedAmount,
        },
        $set: {
          donationClaimProcessingId: claimId,
          donationClaimProcessingTokens: reservedAmount,
          donationClaimProcessingStartedAt: now,
        },
      }
    );

    if ((processingResult.modifiedCount || processingResult.nModified || 0) === 0) {
      await Donation.updateOne(
        { _id: donation._id, donationClaimLockId: claimId },
        { $unset: { donationClaimLockId: '', donationClaimLockUntil: '' } }
      );

      return { tokensPaid: 0, reason: 'claim_in_progress' };
    }

    console.log(`[CLAIM] Spawning ${reservedAmount}x ${DONATION_TOKEN_CLASS} on ${steamId64} (claim ${claimId})`);

    try {
      await spawnItemOnPlayer(steamId64, DONATION_TOKEN_CLASS, reservedAmount, true);
    } catch (err) {
      console.error('❌ Failed to spawn donation tokens. Claim left in processing for staff review:', err.response?.data || err);

      await Donation.updateOne(
        { _id: donation._id, donationClaimProcessingId: claimId },
        {
          $unset: {
            donationClaimLockId: '',
            donationClaimLockUntil: '',
          },
        }
      );

      err.claimLeftProcessing = true;
      throw err;
    }

    const finalizeResult = await Donation.updateOne(
      {
        _id: donation._id,
        donationClaimProcessingId: claimId,
        donationClaimProcessingTokens: reservedAmount,
      },
      {
        $inc: {
          claimedDonationTokens: reservedAmount,
        },
        $set: {
          donationClaimProcessingTokens: 0,
        },
        $unset: {
          donationClaimLockId: '',
          donationClaimLockUntil: '',
          donationClaimProcessingId: '',
          donationClaimProcessingStartedAt: '',
        },
      }
    );

    if ((finalizeResult.modifiedCount || finalizeResult.nModified || 0) === 0) {
      console.error(
        `[CLAIM] Donation claim ${claimId} spawned ${reservedAmount} tokens for ${steamId64}, but DB finalization did not modify a record. Staff should review /resolveclaim.`
      );
      return { tokensPaid: reservedAmount, reason: 'finalize_pending_review' };
    }

    return {
      tokensPaid: reservedAmount,
      reason: 'ok',
    };
  } finally {
    await releaseClaimLock(lock);
  }
}

/**
 * Payout any unclaimed Rank ID Cards for a given SteamID64.
 *
 * Rank cards are also moved into a processing state before CFTools is called.
 * This prevents rapid duplicate rank-card claims and makes crash recovery an
 * explicit staff decision instead of an automatic retry.
 */
async function payOutRankCards(steamId64) {
  const { link, donation: existingDonation } = await findDonationBySteamId(steamId64);
  if (!link) {
    return { cardsPaid: 0, reason: 'no_steam_link', paid: [], labels: [] };
  }

  const lock = await acquireClaimLock(`rank:${steamId64}`, CLAIM_LOCK_MS);
  if (!lock) {
    return { cardsPaid: 0, reason: 'claim_in_progress', paid: [], labels: [] };
  }

  try {
    if (!existingDonation) {
      return { cardsPaid: 0, reason: 'no_donation_record', paid: [], labels: [] };
    }

    if (hasRankProcessingClaim(existingDonation)) {
      return { cardsPaid: 0, reason: 'claim_pending_review', paid: [], labels: [] };
    }

    const claimId = newClaimId();
    const { now, lockUntil } = getLockWindow();

    const donation = await Donation.findOneAndUpdate(
      {
        discordId: link.discordId,
        unclaimedRankCards: { $exists: true, $ne: [] },
        $or: [
          { rankClaimLockUntil: { $exists: false } },
          { rankClaimLockUntil: null },
          { rankClaimLockUntil: { $lte: now } },
        ],
        $and: [
          {
            $or: [
              { rankClaimProcessingCards: { $exists: false } },
              { rankClaimProcessingCards: { $size: 0 } },
            ],
          },
        ],
      },
      {
        $set: {
          rankClaimLockId: claimId,
          rankClaimLockUntil: lockUntil,
        },
      },
      {
        new: true,
      }
    );

    if (!donation) {
      return { cardsPaid: 0, reason: 'no_unclaimed_cards', paid: [], labels: [] };
    }

    const unclaimed = Array.isArray(donation.unclaimedRankCards)
      ? [...donation.unclaimedRankCards]
      : [];

    if (!unclaimed.length) {
      await Donation.updateOne(
        { _id: donation._id, rankClaimLockId: claimId },
        { $unset: { rankClaimLockId: '', rankClaimLockUntil: '' } }
      );

      return { cardsPaid: 0, reason: 'no_unclaimed_cards', paid: [], labels: [] };
    }

    // Move cards out of the claimable array before spawning.
    const processingResult = await Donation.updateOne(
      { _id: donation._id, rankClaimLockId: claimId },
      {
        $pull: {
          unclaimedRankCards: { $in: unclaimed },
        },
        $set: {
          rankClaimProcessingId: claimId,
          rankClaimProcessingCards: unclaimed,
          rankClaimProcessingStartedAt: now,
        },
      }
    );

    if ((processingResult.modifiedCount || processingResult.nModified || 0) === 0) {
      await Donation.updateOne(
        { _id: donation._id, rankClaimLockId: claimId },
        { $unset: { rankClaimLockId: '', rankClaimLockUntil: '' } }
      );

      return { cardsPaid: 0, reason: 'claim_in_progress', paid: [], labels: [] };
    }

    const paid = [];

    try {
      for (const classname of unclaimed) {
        console.log(`[CLAIM] Spawning 1x ${classname} on ${steamId64} (claim ${claimId})`);
        await spawnItemOnPlayer(steamId64, classname, 1, false);
        paid.push(classname);
      }
    } catch (err) {
      console.error('❌ Failed to spawn rank card(s). Claim left in processing for staff review:', err.response?.data || err);

      await Donation.updateOne(
        { _id: donation._id, rankClaimProcessingId: claimId },
        {
          $unset: {
            rankClaimLockId: '',
            rankClaimLockUntil: '',
          },
        }
      );

      err.claimLeftProcessing = true;
      throw err;
    }

    const finalizeResult = await Donation.updateOne(
      { _id: donation._id, rankClaimProcessingId: claimId },
      {
        $addToSet: {
          claimedRankCards: { $each: paid },
        },
        $set: {
          rankClaimProcessingCards: [],
        },
        $unset: {
          rankClaimLockId: '',
          rankClaimLockUntil: '',
          rankClaimProcessingId: '',
          rankClaimProcessingStartedAt: '',
        },
      }
    );

    if ((finalizeResult.modifiedCount || finalizeResult.nModified || 0) === 0) {
      console.error(
        `[CLAIM] Rank claim ${claimId} spawned cards for ${steamId64}, but DB finalization did not modify a record. Staff should review /resolveclaim.`
      );
      return {
        cardsPaid: paid.length,
        reason: 'finalize_pending_review',
        paid,
        labels: paid.map((cn) => RANK_CARD_LABELS[cn] || cn),
      };
    }

    return {
      cardsPaid: paid.length,
      reason: 'ok',
      paid,
      labels: paid.map((cn) => RANK_CARD_LABELS[cn] || cn),
    };
  } finally {
    await releaseClaimLock(lock);
  }
}

module.exports = {
  payOutVoteRewards,
  payOutDonationRewards,
  payOutRankCards,
  CLAIM_LOCK_MS,
};
