// services/claims.js
const Vote = require('../models/Vote');
const Donation = require('../models/Donation');
const SteamLink = require('../models/SteamLink');
const { spawnItemOnPlayer } = require('./cftoolsGameLabs');

// Classnames you provided
const DONATION_TOKEN_CLASS = 'HackSaw_Dono_Coin';
const VOTE_TOKEN_CLASS = 'TraderPlus_Coin';

/**
 * Payout all unclaimed vote rewards (Reward Tokens) for a given SteamID64.
 *  - 1 vote = rewardTokens (currently 10)
 *  - Spawns TraderPlus_Coin
 */
async function payOutVoteRewards(steamId64) {
  // 1) Fetch unclaimed votes for this SteamID
  const unclaimedVotes = await Vote.find({
    steamId64,
    claimed: false,
  });

  if (!unclaimedVotes.length) {
    return { tokensPaid: 0, votesUpdated: 0 };
  }

  // 2) Sum total Reward Tokens owed
  const totalRewardTokens = unclaimedVotes.reduce(
    (sum, v) => sum + (v.rewardTokens || 0),
    0
  );

  if (totalRewardTokens <= 0) {
    return { tokensPaid: 0, votesUpdated: 0 };
  }

  // 3) Spawn Reward Tokens in-game
  await spawnItemOnPlayer(steamId64, VOTE_TOKEN_CLASS, totalRewardTokens, true);

  // 4) Mark votes as claimed
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
 *  - Uses SteamLink to map steamId64 -> discordId
 *  - Uses Donation.unclaimedDonationTokens to know how many tokens to spawn
 *  - 10 tokens per £1 were banked in /donate
 */
async function payOutDonationRewards(steamId64) {
  // 1) Find link -> discordId
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

  // 2) Spawn Hacksaw Tokens in-game
  await spawnItemOnPlayer(steamId64, DONATION_TOKEN_CLASS, unclaimed, true);

  // 3) Move unclaimed -> claimed
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
