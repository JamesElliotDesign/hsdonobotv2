const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const Donation = require('../models/Donation');
const { RANKS, poundsToPence, getDiscordRoleForTotal, formatGBP } = require('../config/supportProgram');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('removedono')
        .setDescription('Admins: Remove an amount from a player’s Lifetime Support Total.')
        .addUserOption(option =>
            option.setName('player')
                .setDescription('The player to adjust')
                .setRequired(true)
        )
        .addNumberOption(option =>
            option.setName('amount')
                .setDescription('Amount to remove in GBP')
                .setMinValue(0.01)
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                ephemeral: true
            });
        }

        const user = interaction.options.getUser('player');
        const amountToRemove = interaction.options.getNumber('amount');
        const amountPence = poundsToPence(amountToRemove);

        if (amountPence <= 0) {
            return interaction.reply({
                content: '❌ Amount to remove must be greater than 0.',
                ephemeral: true
            });
        }

        const donation = await Donation.findOne({ discordId: user.id });

        if (!donation || donation.total <= 0) {
            return interaction.reply({
                content: `❌ ${user.username} does not have any recorded support.`,
                ephemeral: true
            });
        }

        const currentPence = poundsToPence(donation.total);
        const newPence = Math.max(0, currentPence - amountPence);
        const actualRemovedPence = currentPence - newPence;

        donation.total = newPence / 100;
        donation.history.push({
            amount: -(actualRemovedPence / 100),
            at: new Date(),
            addedBy: interaction.user.id,
            note: 'Manual Lifetime Support Total adjustment via /removedono',
            entryType: 'manual_adjustment'
        });

        await donation.save();

        const guildMember = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (guildMember) {
            const desiredRole = getDiscordRoleForTotal(newPence);
            const knownRoleIds = RANKS.map(rank => rank.roleId).filter(Boolean);
            const rolesToRemove = guildMember.roles.cache.filter(
                role => knownRoleIds.includes(role.id) && (!desiredRole || role.id !== desiredRole.roleId)
            );

            if (rolesToRemove.size > 0) await guildMember.roles.remove(rolesToRemove);
            if (desiredRole && !guildMember.roles.cache.has(desiredRole.roleId)) {
                await guildMember.roles.add(desiredRole.roleId);
            }
        }

        await interaction.reply({
            content: `✅ Removed **${formatGBP(actualRemovedPence)}** from ${user.username}. Their new Lifetime Support Total is **${formatGBP(newPence)}**.`,
            ephemeral: true
        });
    }
};
