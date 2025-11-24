// commands/myid.js
const { SlashCommandBuilder } = require('discord.js');
const SteamLink = require('../models/SteamLink');
const Donation = require('../models/Donation');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('myid')
        .setDescription('Check which SteamID is linked to your account and your PQ status.'),

    async execute(interaction) {
        const discordId = interaction.user.id;

        const [link, donation] = await Promise.all([
            SteamLink.findOne({ discordId }),
            Donation.findOne({ discordId })
        ]);

        if (!link) {
            return interaction.reply({
                content: `❌ You don't have a SteamID linked. Use \`/linksteam <steamid>\` to connect your account.`,
                ephemeral: true
            });
        }

        let msg = `🆔 Your linked SteamID is: \`${link.steamId64}\``;

        if (donation && donation.pqExpiryAt) {
            const now = new Date();
            const expiry = new Date(donation.pqExpiryAt);

            if (expiry > now) {
                const msRemaining = expiry.getTime() - now.getTime();
                const days = Math.floor(msRemaining / (1000 * 60 * 60 * 24));
                const hours = Math.floor((msRemaining / (1000 * 60 * 60)) % 24);

                msg += `\n✅ Your **priority queue** is active and expires in **${days}d ${hours}h**.`;
            } else {
                msg += `\n❌ Your **priority queue** access has expired.`;
            }
        } else {
            msg += `\nℹ️ You do not currently have **priority queue** access.`;
        }

        await interaction.reply({
            content: msg,
            ephemeral: true
        });
    }
};
