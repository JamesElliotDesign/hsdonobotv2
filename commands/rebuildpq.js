// commands/rebuildpq.js
const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const Donation = require('../models/Donation');
const SteamLink = require('../models/SteamLink');
const { addToPriorityQueue } = require('../services/priorityQueue');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rebuildpq')
        .setDescription('Rebuild the CF Tools priority queue from Mongo donation data.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const now = new Date();

        const activeDonations = await Donation.find({
            $or: [
                { unlimitedPriorityQueue: true },
                { pqExpiryAt: { $gt: now } }
            ]
        }).lean();

        if (!activeDonations.length) {
            return interaction.editReply('ℹ️ No users currently have active or unlimited Priority Queue access in the database.');
        }

        let added = 0;
        const failed = [];
        let missingSteam = 0;
        let unlimitedCount = 0;
        let timedCount = 0;

        for (const donation of activeDonations) {
            if (donation.unlimitedPriorityQueue) {
                unlimitedCount++;
            } else {
                timedCount++;
            }

            const link = await SteamLink.findOne({ discordId: donation.discordId }).lean();

            if (!link) {
                missingSteam++;
                continue;
            }

            const steamId = link.steamId64;

            const error = await addToPriorityQueue(steamId);
            if (error) {
                failed.push({ steamId, error: error.message || String(error) });
            } else {
                added++;
            }
        }

        let result = `✅ Rebuild complete. Added **${added}** users to the priority queue.`;
        result += `\nℹ️ Source records: **${timedCount}** timed PQ, **${unlimitedCount}** unlimited PQ.`;

        if (missingSteam > 0) {
            result += `\nℹ️ Skipped **${missingSteam}** users with PQ access but no linked SteamID.`;
        }

        if (failed.length > 0) {
            result += `\n⚠️ Failed to add **${failed.length}** users:\n`;
            result += failed.map(f => `- ${f.steamId}: ${f.error}`).join('\n');
        }

        await interaction.editReply(result);
    }
};
