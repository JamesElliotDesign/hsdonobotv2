// services/claimRecovery.js
const Donation = require('../models/Donation');
const Vote = require('../models/Vote');
const SteamLink = require('../models/SteamLink');

function processingVoteFilter() {
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

async function resolveSteamId({ steamId64, discordId }) {
  if (steamId64) {
    return steamId64.trim();
  }

  if (!discordId) {
    return null;
  }

  const link = await SteamLink.findOne({ discordId }).lean();
  return link ? link.steamId64 : null;
}

async function resolveDonationTokens(steamId64, action) {
  const link = await SteamLink.findOne({ steamId64 }).lean();
  if (!link) {
    return { category: 'donation', found: false, tokens: 0, message: 'No Steam link was found.' };
  }

  const donation = await Donation.findOne({ discordId: link.discordId });
  if (!donation) {
    return { category: 'donation', found: false, tokens: 0, message: 'No donation record was found.' };
  }

  const tokens = donation.donationClaimProcessingTokens || 0;
  const claimId = donation.donationClaimProcessingId || null;
  const startedAt = donation.donationClaimProcessingStartedAt || null;

  if (tokens <= 0) {
    return { category: 'donation', found: true, tokens: 0, claimId, startedAt, message: 'No donation-token claim is currently processing.' };
  }

  if (action === 'status') {
    return { category: 'donation', found: true, tokens, claimId, startedAt, message: `${tokens} donation tokens are pending review.` };
  }

  const update = {
    $set: {
      donationClaimProcessingTokens: 0,
    },
    $unset: {
      donationClaimLockId: '',
      donationClaimLockUntil: '',
      donationClaimProcessingId: '',
      donationClaimProcessingStartedAt: '',
    },
  };

  if (action === 'release') {
    update.$inc = { unclaimedDonationTokens: tokens };
  } else if (action === 'finalize') {
    update.$inc = { claimedDonationTokens: tokens };
  } else {
    throw new Error(`Unknown resolve action: ${action}`);
  }

  await Donation.updateOne(
    { _id: donation._id, donationClaimProcessingTokens: tokens },
    update
  );

  return {
    category: 'donation',
    found: true,
    tokens,
    claimId,
    startedAt,
    message: action === 'release'
      ? `${tokens} donation tokens were returned to the unclaimed balance.`
      : `${tokens} donation tokens were finalized as paid.`,
  };
}

async function resolveVoteTokens(steamId64, action) {
  const query = { steamId64, ...processingVoteFilter() };
  const votes = await Vote.find(query).lean();
  const tokens = votes.reduce((sum, vote) => sum + (vote.rewardTokens || 0), 0);
  const voteIds = votes.map((vote) => vote._id);
  const claimIds = [...new Set(votes.map((vote) => vote.claimTxnId).filter(Boolean))];
  const startedAt = votes
    .map((vote) => vote.claimProcessingStartedAt || vote.claimLockUntil || vote.updatedAt)
    .filter(Boolean)
    .sort((a, b) => new Date(a) - new Date(b))[0] || null;

  if (!votes.length) {
    return { category: 'vote', found: true, tokens: 0, votes: 0, claimIds, startedAt, message: 'No vote-token claim is currently processing.' };
  }

  if (action === 'status') {
    return { category: 'vote', found: true, tokens, votes: votes.length, claimIds, startedAt, message: `${tokens} vote reward tokens from ${votes.length} vote record(s) are pending review.` };
  }

  if (action === 'release') {
    await Vote.updateMany(
      { _id: { $in: voteIds } },
      {
        $set: {
          claimed: false,
          claimStatus: 'unclaimed',
        },
        $unset: {
          claimTxnId: '',
          claimLockUntil: '',
          claimProcessingStartedAt: '',
          claimedAt: '',
          claimSource: '',
        },
      }
    );
  } else if (action === 'finalize') {
    await Vote.updateMany(
      { _id: { $in: voteIds } },
      {
        $set: {
          claimed: true,
          claimStatus: 'claimed',
          claimedAt: new Date(),
          claimSource: 'admin',
        },
        $unset: {
          claimTxnId: '',
          claimLockUntil: '',
          claimProcessingStartedAt: '',
        },
      }
    );
  } else {
    throw new Error(`Unknown resolve action: ${action}`);
  }

  return {
    category: 'vote',
    found: true,
    tokens,
    votes: votes.length,
    claimIds,
    startedAt,
    message: action === 'release'
      ? `${tokens} vote reward tokens from ${votes.length} vote record(s) were returned to unclaimed.`
      : `${tokens} vote reward tokens from ${votes.length} vote record(s) were finalized as paid.`,
  };
}

async function resolveRankCards(steamId64, action) {
  const link = await SteamLink.findOne({ steamId64 }).lean();
  if (!link) {
    return { category: 'rank', found: false, cards: 0, cardClassnames: [], message: 'No Steam link was found.' };
  }

  const donation = await Donation.findOne({ discordId: link.discordId });
  if (!donation) {
    return { category: 'rank', found: false, cards: 0, cardClassnames: [], message: 'No donation record was found.' };
  }

  const cards = Array.isArray(donation.rankClaimProcessingCards)
    ? donation.rankClaimProcessingCards
    : [];
  const claimId = donation.rankClaimProcessingId || null;
  const startedAt = donation.rankClaimProcessingStartedAt || null;

  if (!cards.length) {
    return { category: 'rank', found: true, cards: 0, cardClassnames: [], claimId, startedAt, message: 'No rank-card claim is currently processing.' };
  }

  if (action === 'status') {
    return { category: 'rank', found: true, cards: cards.length, cardClassnames: cards, claimId, startedAt, message: `${cards.length} rank card(s) are pending review.` };
  }

  const update = {
    $set: {
      rankClaimProcessingCards: [],
    },
    $unset: {
      rankClaimLockId: '',
      rankClaimLockUntil: '',
      rankClaimProcessingId: '',
      rankClaimProcessingStartedAt: '',
    },
  };

  if (action === 'release') {
    update.$addToSet = { unclaimedRankCards: { $each: cards } };
  } else if (action === 'finalize') {
    update.$addToSet = { claimedRankCards: { $each: cards } };
  } else {
    throw new Error(`Unknown resolve action: ${action}`);
  }

  await Donation.updateOne(
    { _id: donation._id, rankClaimProcessingCards: { $ne: [] } },
    update
  );

  return {
    category: 'rank',
    found: true,
    cards: cards.length,
    cardClassnames: cards,
    claimId,
    startedAt,
    message: action === 'release'
      ? `${cards.length} rank card(s) were returned to unclaimed.`
      : `${cards.length} rank card(s) were finalized as paid.`,
  };
}

async function resolveProcessingClaims({ steamId64, discordId, category, action }) {
  const resolvedSteamId = await resolveSteamId({ steamId64, discordId });
  if (!resolvedSteamId) {
    return {
      steamId64: null,
      results: [],
      message: 'No SteamID64 was supplied and no Steam link was found for that Discord user.',
    };
  }

  const categories = category === 'all'
    ? ['donation', 'vote', 'rank']
    : [category];

  const results = [];

  for (const currentCategory of categories) {
    if (currentCategory === 'donation') {
      results.push(await resolveDonationTokens(resolvedSteamId, action));
    } else if (currentCategory === 'vote') {
      results.push(await resolveVoteTokens(resolvedSteamId, action));
    } else if (currentCategory === 'rank') {
      results.push(await resolveRankCards(resolvedSteamId, action));
    }
  }

  return {
    steamId64: resolvedSteamId,
    results,
    message: null,
  };
}

module.exports = {
  resolveProcessingClaims,
};
