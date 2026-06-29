// commands/linksteam.js
const { SlashCommandBuilder } = require('discord.js');
const SteamLink = require('../models/SteamLink');
const Donation = require('../models/Donation');
const { addToPriorityQueue, isActiveTimedPriorityQueue } = require('../services/priorityQueue');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('linksteam')
        .setDescription('Link your Steam account for priority queue access.')
        .addStringOption(option =>
            option
                .setName('steamid')
                .setDescription('Your SteamID64')
                .setRequired(true)
        ),

    async execute(interaction) {
        const discordId = interaction.user.id;
        const steamId = interaction.options.getString('steamid').trim();

        if (!/^\d{17}$/.test(steamId)) {
            return interaction.reply({
                content: '❌ That does not look like a valid SteamID64 (expected 17 digits).',
                ephemeral: true
            });
        }

        // Upsert Steam link
        let link = await SteamLink.findOne({ discordId });
        if (!link) {
            link = new SteamLink({ discordId, steamId64: steamId });
        } else {
            link.steamId64 = steamId;
        }
        await link.save();

        // If they already have active or unlimited PQ in donations, ensure they are in CF Tools PQ
        const donation = await Donation.findOne({ discordId });

        let pqActivatedNow = false;
        let unlimitedPQ = false;

        if (donation) {
            unlimitedPQ = Boolean(donation.unlimitedPriorityQueue);

            if (unlimitedPQ || isActiveTimedPriorityQueue(donation)) {
                await addToPriorityQueue(steamId);
                pqActivatedNow = true;
            }
        }

        let reply = `✅ SteamID \`${steamId}\` has been successfully linked to your Discord account.`;

        if (pqActivatedNow && unlimitedPQ) {
            reply += `\n✅ You already had **unlimited Priority Queue**, so your SteamID has been added to the CF Tools priority queue.`;
        } else if (pqActivatedNow) {
            reply += `\n✅ You already had an active **Priority Queue** window, so your SteamID has been added to the CF Tools priority queue.`;
        } else {
            reply += `\nℹ️ If you donate **£15 or more**, you will receive **1 month of Priority Queue**.`;
        }

        await interaction.reply({ content: reply, ephemeral: true });
    }
};
