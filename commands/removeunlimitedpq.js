// commands/removeunlimitedpq.js
const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const Donation = require('../models/Donation');
const SteamLink = require('../models/SteamLink');
const {
    removeFromPriorityQueue,
    isActiveTimedPriorityQueue
} = require('../services/priorityQueue');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('removeunlimitedpq')
        .setDescription('Admins: Remove unlimited Priority Queue from a staff member/user.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addUserOption(option =>
            option.setName('player')
                .setDescription('The Discord user to remove unlimited PQ from')
                .setRequired(true)
        ),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const targetUser = interaction.options.getUser('player');
        const now = new Date();
        const donation = await Donation.findOne({ discordId: targetUser.id });

        if (!donation || !donation.unlimitedPriorityQueue) {
            return interaction.editReply(`ℹ️ ${targetUser.tag} does not currently have **unlimited Priority Queue** in the database.`);
        }

        donation.unlimitedPriorityQueue = false;
        donation.history.push({
            amount: 0,
            at: now,
            addedBy: interaction.user.id,
            note: 'Manual unlimited PQ removal via /removeunlimitedpq'
        });

        const hasActiveTimedPQ = isActiveTimedPriorityQueue(donation, now);

        if (!hasActiveTimedPQ && donation.pqExpiryAt) {
            // Prevent the daily expiry sweep from sending a duplicate expiry notification after this manual removal.
            donation.pqExpiryNotified = true;
        }

        await donation.save();

        const link = await SteamLink.findOne({ discordId: targetUser.id }).lean();
        let reply = `✅ Removed **unlimited Priority Queue** from ${targetUser.tag}.`;

        if (hasActiveTimedPQ) {
            const expiryDate = new Date(donation.pqExpiryAt);
            reply += `\nℹ️ They still have normal timed PQ until **${expiryDate.toDateString()}**, so they were left in the CF Tools Priority Queue list.`;
        } else if (link) {
            await removeFromPriorityQueue(link.steamId64);
            reply += `\n✅ They do not have active timed PQ, so SteamID \`${link.steamId64}\` was removed from the CF Tools Priority Queue list.`;
        } else {
            reply += `\n⚠️ No SteamID is linked for this user, so there was no CF Tools Priority Queue entry to remove.`;
        }

        await interaction.editReply(reply);
    }
};
