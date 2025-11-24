// commands/checkpq.js
const { SlashCommandBuilder } = require('discord.js');
const Donation = require('../models/Donation');
const SteamLink = require('../models/SteamLink');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('checkpq')
        .setDescription('Check your priority queue status and time left'),

    async execute(interaction) {
        const discordId = interaction.user.id;

        const [donation, link] = await Promise.all([
            Donation.findOne({ discordId }),
            SteamLink.findOne({ discordId })
        ]);

        if (!link) {
            return interaction.reply({
                content: '❌ You do not have a SteamID linked. Use **/linksteam** first.',
                ephemeral: true
            });
        }

        const steamId = link.steamId64;

        if (!donation || !donation.pqExpiryAt) {
            return interaction.reply({
                content: `❌ You do not currently have priority queue access linked to **${steamId}**.`,
                ephemeral: true
            });
        }

        const now = new Date();
        const expiryDate = new Date(donation.pqExpiryAt);

        if (expiryDate <= now) {
            return interaction.reply({
                content: `❌ Your priority queue access linked to **${steamId}** has **expired**.`,
                ephemeral: true
            });
        }

        // Time left calculation
        const msRemaining = expiryDate.getTime() - now.getTime();
        const days = Math.floor(msRemaining / (1000 * 60 * 60 * 24));
        const hours = Math.floor((msRemaining / (1000 * 60 * 60)) % 24);
        const minutes = Math.floor((msRemaining / (1000 * 60)) % 60);

        return interaction.reply({
            content: `✅ You have **priority queue** access linked to **${steamId}**.\nTime left: **${days}d ${hours}h ${minutes}m**.`,
            ephemeral: true
        });
    }
};
