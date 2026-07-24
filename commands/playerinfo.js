const {
  SlashCommandBuilder,
  PermissionsBitField,
  EmbedBuilder,
  AttachmentBuilder,
} = require('discord.js');
const Donation = require('../models/Donation');
const SteamLink = require('../models/SteamLink');
const SupportOrder = require('../models/SupportOrder');
const PlayerProfile = require('../models/PlayerProfile');
const {
  findPlayerCandidatesByName,
  snapshotPlayerIdentity,
  profileDisplayName,
} = require('../services/playerProfiles');
const {
  formatGBP,
  poundsToPence,
  getCurrentRank,
} = require('../config/supportProgram');

function inline(value) {
  return String(value ?? '').replace(/`/g, 'ˋ').replace(/[\r\n]+/g, ' ');
}

function isoDate(value) {
  if (!value) return 'Not recorded';
  return new Date(value).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function statusLabel(value) {
  return String(value || 'unknown').replaceAll('_', ' ');
}

function normalizePaymentReference(reference) {
  return String(reference || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function currentPqText(donation) {
  if (!donation) return 'No support account';
  if (donation.unlimitedPriorityQueue) return 'Lifetime';
  if (!donation.pqExpiryAt) return 'None recorded';
  return isoDate(donation.pqExpiryAt);
}

function orderLine(order) {
  return `${order.orderId} | ${formatGBP(order.amountPence)} | ${statusLabel(order.status)} | ${isoDate(order.createdAt)}`;
}

async function resolveDiscordId(interaction) {
  const selectedUser = interaction.options.getUser('player');
  const name = interaction.options.getString('name')?.trim();
  const discordIdInput = interaction.options.getString('discord_id')?.trim();
  const steamIdInput = interaction.options.getString('steam_id')?.trim();
  const referenceInput = interaction.options.getString('reference')?.trim();
  const provided = [selectedUser, name, discordIdInput, steamIdInput, referenceInput].filter(Boolean);

  if (provided.length !== 1) {
    throw new Error('Use exactly one lookup option: player, name, discord_id, steam_id, or reference.');
  }

  if (selectedUser) {
    const member = interaction.options.getMember('player');
    await snapshotPlayerIdentity({
      user: selectedUser,
      member,
      source: 'playerinfo_user_option',
    }).catch(() => null);
    return { discordId: selectedUser.id, selectedUser };
  }

  if (discordIdInput) {
    if (!/^\d{15,22}$/.test(discordIdInput)) {
      throw new Error('Discord ID must contain only digits.');
    }
    return { discordId: discordIdInput };
  }

  if (steamIdInput) {
    if (!/^\d{17}$/.test(steamIdInput)) {
      throw new Error('Steam ID must be a 17-digit SteamID64.');
    }
    const link = await SteamLink.findOne({ steamId64: steamIdInput }).lean();
    if (!link) throw new Error(`No player record was found for Steam ID ${steamIdInput}.`);
    return { discordId: link.discordId };
  }

  if (referenceInput) {
    const normalizedReference = normalizePaymentReference(referenceInput);
    if (normalizedReference.length < 3) {
      throw new Error('Payment reference must contain at least three characters.');
    }

    const matchingOrders = await SupportOrder.find({
      paymentReferenceNormalized: normalizedReference,
    }).sort({ createdAt: -1 }).lean();

    if (matchingOrders.length === 0) {
      throw new Error(`No support order was found for payment reference ${inline(referenceInput)}.`);
    }

    const discordIds = [...new Set(matchingOrders.map((order) => order.discordId))];
    if (discordIds.length > 1) {
      const matches = matchingOrders.slice(0, 15).map((order) =>
        `• ${order.orderId} — Discord ID \`${order.discordId}\` — ${statusLabel(order.status)}`
      ).join('\n');
      throw new Error(
        `That payment reference is attached to more than one player record. Use a Discord ID or Steam ID to disambiguate.\n\n${matches}`
      );
    }

    return {
      discordId: discordIds[0],
      matchedReference: matchingOrders[0].paymentReference,
      matchedOrders: matchingOrders,
    };
  }

  const candidates = await findPlayerCandidatesByName(name, interaction.guild);
  if (candidates.length === 0) {
    throw new Error(
      'No stored player matched that name. For legacy players who left before this update, use their Discord ID, Steam ID, or a recorded payment reference if available.'
    );
  }

  const exact = candidates.filter((candidate) => candidate.score === 100);
  if (exact.length === 1) return { discordId: exact[0].discordId };
  if (candidates.length === 1) return { discordId: candidates[0].discordId };

  const list = candidates.slice(0, 15).map((candidate) =>
    `• ${candidate.displayName} — Discord ID \`${candidate.discordId}\``
  ).join('\n');

  const error = new Error(
    `More than one player matched **${inline(name)}**. Run the command again using \`discord_id\` or select the player directly.\n\n${list}`
  );
  error.code = 'AMBIGUOUS_PLAYER';
  throw error;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('playerinfo')
    .setDescription('Find a player and support orders by player, name, IDs, or payment reference.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addUserOption((option) =>
      option
        .setName('player')
        .setDescription('Select a player who is currently available in Discord')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('name')
        .setDescription('Stored username or display name, including players who have left')
        .setMinLength(2)
        .setMaxLength(100)
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('discord_id')
        .setDescription('Discord user ID')
        .setMinLength(15)
        .setMaxLength(22)
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('steam_id')
        .setDescription('17-digit SteamID64')
        .setMinLength(17)
        .setMaxLength(17)
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('reference')
        .setDescription('Exact payment reference recorded with /donate')
        .setMinLength(3)
        .setMaxLength(200)
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({
        content: '❌ You do not have permission to use this command.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const { discordId, selectedUser, matchedReference, matchedOrders = [] } = await resolveDiscordId(interaction);

      const [profile, steamLink, donation, orders] = await Promise.all([
        PlayerProfile.findOne({ discordId }).lean(),
        SteamLink.findOne({ discordId }).lean(),
        Donation.findOne({ discordId }).lean(),
        SupportOrder.find({ discordId }).sort({ createdAt: -1 }).lean(),
      ]);

      if (!profile && !steamLink && !donation && orders.length === 0 && !selectedUser) {
        throw new Error(`No Hacksaw records were found for Discord ID ${discordId}.`);
      }

      const guildMember = await interaction.guild.members.fetch(discordId).catch(() => null);
      const discordUser = selectedUser || guildMember?.user || await interaction.client.users.fetch(discordId).catch(() => null);
      if (discordUser || guildMember) {
        await snapshotPlayerIdentity({
          user: discordUser,
          member: guildMember,
          discordId,
          source: 'playerinfo_result',
        }).catch(() => null);
      }

      const refreshedProfile = await PlayerProfile.findOne({ discordId }).lean() || profile;
      const displayName =
        guildMember?.displayName ||
        discordUser?.globalName ||
        discordUser?.username ||
        profileDisplayName(refreshedProfile) ||
        orders[0]?.discordUsernameSnapshot ||
        'Unknown player';

      const totalPence = poundsToPence(donation?.total || 0);
      const rank = getCurrentRank(totalPence);
      const legacyHistory = (donation?.history || []).filter((entry) => !entry.orderId);
      const recentOrders = orders.slice(0, 12);
      const aliases = refreshedProfile?.aliases || [];
      const knownNamesText = (aliases.length ? aliases.slice(0, 10).map(inline).join(', ') : inline(displayName)).slice(0, 850);

      const orderSummary = recentOrders.length
        ? recentOrders.map((order) =>
            `\`${order.orderId}\` — ${formatGBP(order.amountPence)}, ${statusLabel(order.status)}`
          ).join('\n')
        : 'No staged support orders found.';

      const referenceMatchText = matchedOrders.length
        ? `**Reference:** \`${inline(matchedReference)}\`\n` +
          matchedOrders.map((order) =>
            `**Matched order:** \`${order.orderId}\` — ${formatGBP(order.amountPence)}, ${statusLabel(order.status)}`
          ).join('\n')
        : null;

      const embed = new EmbedBuilder()
        .setTitle(`Player information — ${displayName}`)
        .setDescription(
          `**Discord status:** ${guildMember ? 'Currently in the server' : 'Not currently in the server'}\n` +
          `Use an Order ID below with \`/supportreceipt order:<Order ID>\`.`
        )
        .addFields(
          {
            name: 'Identity',
            value:
              `**Discord ID:** \`${discordId}\`\n` +
              `**Steam ID64:** ${steamLink?.steamId64 ? `\`${steamLink.steamId64}\`` : 'Not linked'}\n` +
              `**Known names:** ${knownNamesText}`,
          },
          ...(referenceMatchText ? [{
            name: 'Payment reference match',
            value: referenceMatchText.slice(0, 1024),
          }] : []),
          {
            name: 'Support account',
            value:
              `**Lifetime Support Total:** ${formatGBP(totalPence)}\n` +
              `**Current rank:** ${rank?.label || 'No rank'}\n` +
              `**Unclaimed tokens:** ${Number(donation?.unclaimedDonationTokens || 0).toLocaleString('en-GB')}\n` +
              `**Claimed tokens:** ${Number(donation?.claimedDonationTokens || 0).toLocaleString('en-GB')}\n` +
              `**Unclaimed Rank ID Cards:** ${(donation?.unclaimedRankCards || []).join(', ') || 'None'}\n` +
              `**Claimed Rank ID Cards:** ${(donation?.claimedRankCards || []).join(', ') || 'None'}\n` +
              `**Priority Queue:** ${currentPqText(donation)}`,
          },
          {
            name: `Support orders (${orders.length})`,
            value: orderSummary.slice(0, 1024),
          },
          {
            name: 'Legacy history',
            value:
              legacyHistory.length > 0
                ? `${legacyHistory.length} older support entr${legacyHistory.length === 1 ? 'y has' : 'ies have'} no Order ID because ${legacyHistory.length === 1 ? 'it was' : 'they were'} recorded before the staged workflow.`
                : 'No legacy entries without Order IDs were found.',
          }
        )
        .setFooter({ text: 'The attached text file contains the full lookup and complete order list.' });

      const reportLines = [
        'HACKSAW PLAYER INFORMATION',
        `Generated: ${new Date().toISOString()}`,
        '',
        `Display name: ${displayName}`,
        `Discord ID: ${discordId}`,
        `Discord status: ${guildMember ? 'Currently in the server' : 'Not currently in the server'}`,
        `Steam ID64: ${steamLink?.steamId64 || 'Not linked'}`,
        `Known names: ${aliases.join(' | ') || displayName}`,
        ...(matchedOrders.length ? [
          '',
          'PAYMENT REFERENCE MATCH',
          `Reference: ${matchedReference}`,
          ...matchedOrders.map((order) =>
            `Matched order: ${order.orderId} | ${formatGBP(order.amountPence)} | ${statusLabel(order.status)} | ${isoDate(order.createdAt)}`
          ),
        ] : []),
        '',
        'SUPPORT ACCOUNT',
        `Lifetime Support Total: ${formatGBP(totalPence)}`,
        `Current rank: ${rank?.label || 'No rank'}`,
        `Unclaimed tokens: ${donation?.unclaimedDonationTokens || 0}`,
        `Claimed tokens: ${donation?.claimedDonationTokens || 0}`,
        `Unclaimed Rank ID Cards: ${(donation?.unclaimedRankCards || []).join(', ') || 'None'}`,
        `Claimed Rank ID Cards: ${(donation?.claimedRankCards || []).join(', ') || 'None'}`,
        `Priority Queue: ${currentPqText(donation)}`,
        '',
        `SUPPORT ORDERS (${orders.length})`,
        ...(orders.length ? orders.map(orderLine) : ['No staged support orders found.']),
        '',
        `LEGACY HISTORY WITHOUT ORDER IDS (${legacyHistory.length})`,
        ...(legacyHistory.length
          ? legacyHistory.map((entry) =>
              `${isoDate(entry.at)} | £${Number(entry.amount || 0).toFixed(2)} | addedBy=${entry.addedBy || 'not recorded'} | ${entry.note || 'legacy entry'}`
            )
          : ['None']),
        '',
        'Generate an evidence receipt with:',
        '/supportreceipt order:<Order ID>',
      ];

      const safeId = discordId.replace(/[^0-9]/g, '');
      await interaction.editReply({
        embeds: [embed],
        files: [
          new AttachmentBuilder(Buffer.from(reportLines.join('\n'), 'utf8'), {
            name: `playerinfo-${safeId}.txt`,
          }),
        ],
      });
    } catch (error) {
      console.error('❌ Failed to look up player information:', error);
      await interaction.editReply({
        content: `❌ ${error.message || 'Unable to look up that player.'}`,
      });
    }
  },
};
