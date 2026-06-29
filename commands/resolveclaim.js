// commands/resolveclaim.js
const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { resolveProcessingClaims } = require('../services/claimRecovery');

function formatDate(value) {
  if (!value) return 'unknown time';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'unknown time';
  return d.toISOString();
}

function formatResult(result) {
  const pieces = [`**${result.category}**: ${result.message}`];

  if (result.claimId) {
    pieces.push(`claim id: \`${result.claimId}\``);
  }

  if (result.claimIds && result.claimIds.length) {
    pieces.push(`claim ids: ${result.claimIds.map((id) => `\`${id}\``).join(', ')}`);
  }

  if (result.startedAt) {
    pieces.push(`started: ${formatDate(result.startedAt)}`);
  }

  if (result.cardClassnames && result.cardClassnames.length) {
    pieces.push(`cards: ${result.cardClassnames.map((c) => `\`${c}\``).join(', ')}`);
  }

  return pieces.join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resolveclaim')
    .setDescription('Admin tool to inspect, release, or finalize stuck processing claims.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption(option =>
      option
        .setName('action')
        .setDescription('What to do with the processing claim.')
        .setRequired(true)
        .addChoices(
          { name: 'Status only', value: 'status' },
          { name: 'Release back to unclaimed', value: 'release' },
          { name: 'Finalize as paid', value: 'finalize' },
        )
    )
    .addStringOption(option =>
      option
        .setName('category')
        .setDescription('Which claim category to resolve.')
        .setRequired(true)
        .addChoices(
          { name: 'Donation tokens', value: 'donation' },
          { name: 'Vote reward tokens', value: 'vote' },
          { name: 'Rank cards', value: 'rank' },
          { name: 'All categories', value: 'all' },
        )
    )
    .addStringOption(option =>
      option
        .setName('steamid64')
        .setDescription('SteamID64 of the player. Required if no Discord user is supplied.')
        .setRequired(false)
    )
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Discord user linked to the player. Required if no SteamID64 is supplied.')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({
        content: '❌ You do not have permission to use this command.',
        ephemeral: true,
      });
    }

    const action = interaction.options.getString('action');
    const category = interaction.options.getString('category');
    const steamId64 = interaction.options.getString('steamid64');
    const user = interaction.options.getUser('user');

    if (!steamId64 && !user) {
      return interaction.reply({
        content: '❌ Supply either `steamid64` or `user`.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await resolveProcessingClaims({
        steamId64,
        discordId: user ? user.id : null,
        category,
        action,
      });

      if (!result.steamId64) {
        return interaction.editReply(`❌ ${result.message}`);
      }

      const actionLabel = action === 'status'
        ? 'Status'
        : action === 'release'
          ? 'Released'
          : 'Finalized';

      const body = result.results.map(formatResult).join('\n\n');

      return interaction.editReply(
        `✅ **${actionLabel} claim processing check for SteamID64 ${result.steamId64}**\n\n${body}`
      );
    } catch (err) {
      console.error('❌ Error resolving processing claim:', err);
      return interaction.editReply('❌ An unexpected error occurred while resolving the claim. Check the bot logs.');
    }
  },
};
