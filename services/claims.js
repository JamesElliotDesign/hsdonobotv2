// services/claims.js
const Vote = require('../models/Vote');
const Donation = require('../models/Donation');
const SteamLink = require('../models/SteamLink');
const { spawnItemOnPlayer } = require('./cftoolsGameLabs');

// Classnames
const DONATION_TOKEN_CLASS = 'HackSaw_Dono_Coin';      // Hacksaw Tokens
const VOTE_TOKEN_CLASS = 'Hacksaw_Reward_Coin';        // from your logs

/**
 * Payout all unclaimed vote rewards (Reward Tokens) for a given SteamID64.
 *  - Uses Vote docs in Mongo (rewardTokens, claimed:false)
 *  - Spawns Hacksaw_Reward_Coin
 */
async function payOutVoteRewards(steamId64) {
  const unclaimedVotes = await Vote.find({
    steamId64,
    claimed: false,
  });

  if (!unclaimedVotes.length) {
    return { tokensPaid: 0, votesUpdated: 0 };
  }

  const totalRewardTokens = unclaimedVotes.reduce(
    (sum, v) => sum + (v.rewardTokens || 0),
    0
  );

  if (totalRewardTokens <= 0) {
    return { tokensPaid: 0, votesUpdated: 0 };
  }

  console.log(
    `[CLAIM] Spawning ${totalRewardTokens}x ${VOTE_TOKEN_CLASS} on ${steamId64}`
  );

  try {
    await spawnItemOnPlayer(steamId64, VOTE_TOKEN_CLASS, totalRewardTokens, true);
  } catch (err) {
    console.error('❌ Failed to spawn vote tokens:', err.response?.data || err);
    throw err;
  }

  const voteIds = unclaimedVotes.map((v) => v._id);
  const now = new Date();

  await Vote.updateMany(
    { _id: { $in: voteIds } },
    {
      $set: {
        claimed: true,
        claimedAt: now,
        claimSource: 'in-game',
      },
    }
  );

  return {
    tokensPaid: totalRewardTokens,
    votesUpdated: voteIds.length,
  };
}

/**
 * Payout donation rewards (Hacksaw Tokens) for a given SteamID64.
 */
async function payOutDonationRewards(steamId64) {
  const link = await SteamLink.findOne({ steamId64 }).lean();
  if (!link) {
    return { tokensPaid: 0, reason: 'no_steam_link' };
  }

  const donation = await Donation.findOne({ discordId: link.discordId });
  if (!donation) {
    return { tokensPaid: 0, reason: 'no_donation_record' };
  }

  const unclaimed = donation.unclaimedDonationTokens || 0;
  if (unclaimed <= 0) {
    return { tokensPaid: 0, reason: 'no_unclaimed_tokens' };
  }

  console.log(
    `[CLAIM] Spawning ${unclaimed}x ${DONATION_TOKEN_CLASS} on ${steamId64}`
  );

  try {
    await spawnItemOnPlayer(steamId64, DONATION_TOKEN_CLASS, unclaimed, true);
  } catch (err) {
    console.error('❌ Failed to spawn donation tokens:', err.response?.data || err);
    throw err;
  }

  donation.claimedDonationTokens =
    (donation.claimedDonationTokens || 0) + unclaimed;
  donation.unclaimedDonationTokens = 0;

  await donation.save();

  return {
    tokensPaid: unclaimed,
    reason: 'ok',
  };
}

module.exports = {
  payOutVoteRewards,
  payOutDonationRewards,
};
