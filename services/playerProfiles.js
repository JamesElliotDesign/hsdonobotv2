const PlayerProfile = require('../models/PlayerProfile');
const SupportOrder = require('../models/SupportOrder');

const { normalizePlayerName, escapeRegExp, uniqueNames } = require('../utils/playerNames');

const MAX_ALIASES = 30;

async function snapshotPlayerIdentity({ user, member, discordId, source = 'unknown' }) {
  const id = String(discordId || user?.id || member?.id || '').trim();
  if (!/^\d{15,22}$/.test(id)) return null;

  const username = user?.username || member?.user?.username || null;
  const globalName = user?.globalName || member?.user?.globalName || null;
  const displayName = member?.displayName || null;
  const tag = user?.tag || member?.user?.tag || null;
  const names = uniqueNames([username, globalName, displayName, tag]);
  const now = new Date();

  let profile = await PlayerProfile.findOne({ discordId: id });
  if (!profile) profile = new PlayerProfile({ discordId: id });

  const merged = uniqueNames([
    ...names.map((item) => item.value),
    ...(profile.aliases || []),
  ]).slice(0, MAX_ALIASES);

  profile.usernameSnapshot = username || profile.usernameSnapshot;
  profile.globalNameSnapshot = globalName || profile.globalNameSnapshot;
  profile.displayNameSnapshot = displayName || profile.displayNameSnapshot;
  profile.aliases = merged.map((item) => item.value);
  profile.aliasesNormalized = merged.map((item) => item.normalized);
  profile.lastSeenAt = now;
  profile.lastSource = source;
  await profile.save();
  return profile;
}

async function snapshotOrderIdentity(order, source = 'support_order') {
  if (!order?.discordId) return null;

  const username = order.discordUsernameSnapshot || null;
  const globalName = order.discordGlobalNameSnapshot || null;
  const displayName = order.discordDisplayNameSnapshot || null;
  const names = uniqueNames([username, globalName, displayName]);
  const now = order.createdAt ? new Date(order.createdAt) : new Date();

  let profile = await PlayerProfile.findOne({ discordId: order.discordId });
  if (!profile) profile = new PlayerProfile({ discordId: order.discordId });

  const merged = uniqueNames([
    ...names.map((item) => item.value),
    ...(profile.aliases || []),
  ]).slice(0, MAX_ALIASES);

  profile.usernameSnapshot = username || profile.usernameSnapshot;
  profile.globalNameSnapshot = globalName || profile.globalNameSnapshot;
  profile.displayNameSnapshot = displayName || profile.displayNameSnapshot;
  profile.aliases = merged.map((item) => item.value);
  profile.aliasesNormalized = merged.map((item) => item.normalized);
  profile.lastSeenAt = profile.lastSeenAt && profile.lastSeenAt > now ? profile.lastSeenAt : now;
  profile.lastSource = source;
  await profile.save();
  return profile;
}

async function backfillProfilesFromSupportOrders() {
  const orders = await SupportOrder.aggregate([
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$discordId',
        discordId: { $first: '$discordId' },
        discordUsernameSnapshot: { $first: '$discordUsernameSnapshot' },
        discordGlobalNameSnapshot: { $first: '$discordGlobalNameSnapshot' },
        discordDisplayNameSnapshot: { $first: '$discordDisplayNameSnapshot' },
        createdAt: { $first: '$createdAt' },
      },
    },
  ]);

  for (const order of orders) {
    await snapshotOrderIdentity(order, 'support_order_backfill');
  }

  return orders.length;
}

function profileDisplayName(profile) {
  return (
    profile?.displayNameSnapshot ||
    profile?.globalNameSnapshot ||
    profile?.usernameSnapshot ||
    profile?.aliases?.[0] ||
    null
  );
}

function matchScore(profile, queryNormalized) {
  const aliases = profile.aliasesNormalized || [];
  if (aliases.includes(queryNormalized)) return 100;
  if (aliases.some((name) => name.startsWith(queryNormalized))) return 70;
  if (aliases.some((name) => name.includes(queryNormalized))) return 40;
  return 0;
}

async function findPlayerCandidatesByName(name, guild) {
  const queryNormalized = normalizePlayerName(name);
  if (queryNormalized.length < 2) {
    throw new Error('Enter at least two characters of the player name.');
  }

  const regex = new RegExp(escapeRegExp(queryNormalized), 'i');
  const candidateMap = new Map();

  const profiles = await PlayerProfile.find({ aliasesNormalized: regex }).limit(50).lean();
  for (const profile of profiles) candidateMap.set(profile.discordId, profile);

  const legacyOrders = await SupportOrder.find({
    $or: [
      { discordUsernameSnapshot: regex },
      { discordGlobalNameSnapshot: regex },
      { discordDisplayNameSnapshot: regex },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  for (const order of legacyOrders) {
    if (!candidateMap.has(order.discordId)) {
      const synthetic = {
        discordId: order.discordId,
        usernameSnapshot: order.discordUsernameSnapshot,
        globalNameSnapshot: order.discordGlobalNameSnapshot,
        displayNameSnapshot: order.discordDisplayNameSnapshot,
        aliases: uniqueNames([
          order.discordUsernameSnapshot,
          order.discordGlobalNameSnapshot,
          order.discordDisplayNameSnapshot,
        ]).map((item) => item.value),
        aliasesNormalized: uniqueNames([
          order.discordUsernameSnapshot,
          order.discordGlobalNameSnapshot,
          order.discordDisplayNameSnapshot,
        ]).map((item) => item.normalized),
        lastSeenAt: order.createdAt,
      };
      candidateMap.set(order.discordId, synthetic);
      await snapshotOrderIdentity(order, 'playerinfo_legacy_order').catch(() => null);
    }
  }

  if (guild) {
    try {
      const members = await guild.members.search({ query: String(name).trim(), limit: 25 });
      for (const member of members.values()) {
        const profile = await snapshotPlayerIdentity({
          user: member.user,
          member,
          source: 'playerinfo_guild_search',
        });
        if (profile) candidateMap.set(profile.discordId, profile.toObject ? profile.toObject() : profile);
      }
    } catch (error) {
      console.warn('⚠️ Guild member name search was unavailable:', error.message);
    }
  }

  return [...candidateMap.values()]
    .map((profile) => ({
      ...profile,
      score: matchScore(profile, queryNormalized),
      displayName: profileDisplayName(profile) || 'Unknown name',
    }))
    .filter((profile) => profile.score > 0)
    .sort((a, b) => b.score - a.score || new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0));
}

module.exports = {
  normalizePlayerName,
  snapshotPlayerIdentity,
  snapshotOrderIdentity,
  backfillProfilesFromSupportOrders,
  findPlayerCandidatesByName,
  profileDisplayName,
};
