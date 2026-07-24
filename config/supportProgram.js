const SUPPORT_TERMS_URL = process.env.SUPPORT_TERMS_URL || 'https://hacksawdayz.vercel.app/support-terms.html';
const SUPPORT_TERMS_VERSION = process.env.SUPPORT_TERMS_VERSION || '2026-07-24';
const CLAIM_CHANNEL_URL = process.env.CLAIM_CHANNEL_URL || 'https://discord.com/channels/1217816664268083220/1442660928171806853';

const CURRENCY = 'GBP';
const TOKENS_PER_POUND = 100;
const MONTHLY_PQ_MINIMUM_PENCE = 2000;
const MONTHLY_PQ_DAYS = 30;

// Existing role IDs are retained as defaults. Environment variables allow a
// role to be changed without editing source. The current Hacksaw Diamond role
// ID is retained as the default and can still be overridden with an environment variable.
const RANKS = [
  {
    key: 'AMETHYST',
    label: 'Amethyst',
    thresholdPence: 2000,
    roleId: process.env.SUPPORT_ROLE_AMETHYST_ID || '1227025687316005015',
    cardClassname: 'HS_RANKIDAMETHYST',
    cardLabel: 'Amethyst Rank ID Card',
  },
  {
    key: 'JADE',
    label: 'Jade',
    thresholdPence: 5000,
    roleId: process.env.SUPPORT_ROLE_JADE_ID || '1345834598969643221',
    cardClassname: 'HS_RANKIDJADE',
    cardLabel: 'Jade Rank ID Card',
  },
  {
    key: 'AMBER',
    label: 'Amber',
    thresholdPence: 10000,
    roleId: process.env.SUPPORT_ROLE_AMBER_ID || '1345836451362766880',
    cardClassname: 'HS_RANKIDAMBER',
    cardLabel: 'Amber Rank ID Card',
  },
  {
    key: 'RUBY',
    label: 'Ruby',
    thresholdPence: 15000,
    roleId: process.env.SUPPORT_ROLE_RUBY_ID || '1345838625757204640',
    cardClassname: 'HS_RANKIDRUBY',
    cardLabel: 'Ruby Rank ID Card',
  },
  {
    key: 'IOLITE',
    label: 'Iolite',
    thresholdPence: 25000,
    roleId: process.env.SUPPORT_ROLE_IOLITE_ID || '1345839616095289345',
    cardClassname: 'HS_RANKIDIOLITE',
    cardLabel: 'Iolite Rank ID Card',
  },
  {
    key: 'TURQUOISE',
    label: 'Turquoise',
    thresholdPence: 50000,
    roleId: process.env.SUPPORT_ROLE_TURQUOISE_ID || '1345840100491395092',
    cardClassname: 'HS_RANKIDTURQUOISE',
    cardLabel: 'Turquoise Rank ID Card',
  },
  {
    key: 'AQUAMARINE',
    label: 'Aquamarine',
    thresholdPence: 100000,
    roleId: process.env.SUPPORT_ROLE_AQUAMARINE_ID || '1345839570041835591',
    cardClassname: 'HS_RANKIDAQUAMARINE',
    cardLabel: 'Aquamarine Rank ID Card',
  },
  {
    key: 'DIAMOND',
    label: 'Diamond',
    thresholdPence: 200000,
    roleId: process.env.SUPPORT_ROLE_DIAMOND_ID || '1359232541965422662',
    cardClassname: 'HS_RANKIDDIAMOND',
    cardLabel: 'Diamond Rank ID Card',
  },
];

function poundsToPence(value) {
  return Math.round(Number(value || 0) * 100);
}

function penceToPounds(value) {
  return Number((Number(value || 0) / 100).toFixed(2));
}

function formatGBP(valuePence) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: CURRENCY,
    minimumFractionDigits: 2,
  }).format(Number(valuePence || 0) / 100);
}

function tokensForAmountPence(amountPence) {
  return Math.floor((Number(amountPence || 0) * TOKENS_PER_POUND) / 100);
}

function getCurrentRank(totalPence) {
  const total = Number(totalPence || 0);
  return [...RANKS].reverse().find((rank) => total >= rank.thresholdPence) || null;
}

function getDiscordRoleForTotal(totalPence) {
  const total = Number(totalPence || 0);
  return [...RANKS].reverse().find((rank) => rank.roleId && total >= rank.thresholdPence) || null;
}

function getCrossedRanks(previousTotalPence, newTotalPence) {
  return RANKS.filter(
    (rank) => previousTotalPence < rank.thresholdPence && newTotalPence >= rank.thresholdPence
  );
}

function getCardsToCredit(donation, newTotalPence) {
  const unclaimed = new Set(donation?.unclaimedRankCards || []);
  const claimed = new Set(donation?.claimedRankCards || []);

  return RANKS.filter(
    (rank) =>
      newTotalPence >= rank.thresholdPence &&
      !unclaimed.has(rank.cardClassname) &&
      !claimed.has(rank.cardClassname)
  );
}

module.exports = {
  SUPPORT_TERMS_URL,
  SUPPORT_TERMS_VERSION,
  CLAIM_CHANNEL_URL,
  CURRENCY,
  TOKENS_PER_POUND,
  MONTHLY_PQ_MINIMUM_PENCE,
  MONTHLY_PQ_DAYS,
  RANKS,
  poundsToPence,
  penceToPounds,
  formatGBP,
  tokensForAmountPence,
  getCurrentRank,
  getDiscordRoleForTotal,
  getCrossedRanks,
  getCardsToCredit,
};
