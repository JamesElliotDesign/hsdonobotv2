// services/claims.js
const Vote = require('../models/Vote');
const Donation = require('../models/Donation');
const SteamLink = require('../models/SteamLink');
const { spawnItemOnPlayer } = require('./cftoolsGameLabs');
const { claimVotesBySteamId } = require('./topGames');

// Classnames you provided
const DONATION_TOKEN_CLASS = 'HackSaw_Dono_Coin';
const VOTE_TOKEN_CLASS = 'Hacksaw_Reward_Coin';

/**
 * Payout all unclaimed vote rewards (Reward Tokens) for a given SteamID64.
 *  - Uses Vote docs in Mongo (rewardTokens, claimed:false)
 *  - Spawns TraderPlus_Coin
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
 * In-game !claimvote handler:
 *  1) Calls Top-Games claim API using steamId64 as playername (your vote name)
 *  2) If a new vote is claimed (claimedCode === 1), creates a Vote doc (rewardTokens=10)
 *  3) Calls payOutVoteRewards to pay out all unclaimed vote tokens for this SteamID
 *
 * This makes it so players only need to type !claimvote in-game.
 */
async function handleIngameClaimVote(steamId64) {
  let newVoteTokens = 0;
  let claimedCode = null;

  try {
    const { claimedCode: code, raw } = await claimVotesBySteamId(steamId64);
    claimedCode = code;

    if (claimedCode === 1) {
      // New vote successfully claimed from Top-Games right now → 10 Reward Tokens
      const voteDoc = new Vote({
        provider: 'top-games',
        providerVoteId: null,
        steamId64,
        discordId: null, // not known from in-game flow
        playerName: null,
        votedAt: new Date(),
        rewardTokens: 10,
        claimed: false,
        rawResponse: raw,
      });

      await voteDoc.save();
      newVoteTokens = voteDoc.rewardTokens;
      console.log(
        `[VOTE] Registered new vote for ${steamId64}, +${newVoteTokens} Reward Tokens`
      );
    } else if (claimedCode === 0) {
      console.log(
        `[VOTE] No new unclaimed vote found on Top-Games for ${steamId64}`
      );
    } else if (claimedCode === 2) {
      console.log(
        `[VOTE] Top-Games reports vote already claimed previously for ${steamId64}`
      );
    } else {
      console.log(
        `[VOTE] Unknown claimedCode from Top-Games for ${steamId64}:`,
        claimedCode
      );
    }
  } catch (err) {
    console.error(
      '❌ Error talking to Top-Games for in-game !claimvote:',
      err.response?.data || err
    );
    // Even if Top-Games call fails, we can still pay out any locally-banked votes
  }

  // After registering any new vote, pay out ALL unclaimed vote rewards for this SteamID
  const payout = await payOutVoteRewards(steamId64);

  return {
    claimedCode,
    newVoteTokens,
    tokensPaid: payout.tokensPaid,
    votesUpdated: payout.votesUpdated,
  };
}

/**
 * Payout donation rewards (Hacksaw Tokens) for a given SteamID64.
 *  - Uses SteamLink to map steamId64 -> discordId
 *  - Uses Donation.unclaimedDonationTokens to know how many tokens to spawn
 *  - 10 tokens per £1 were banked in /donate
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
  handleIngameClaimVote,
  payOutDonationRewards,
};
