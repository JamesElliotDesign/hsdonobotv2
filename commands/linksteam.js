// commands/linksteam.js
const { SlashCommandBuilder } = require('discord.js');
const path = require('path');
const { execFile } = require('child_process');
const SteamLink = require('../models/SteamLink');
const Donation = require('../models/Donation');

const ADD_PQ_SCRIPT = path.join(__dirname, '..', 'add-to-priority-queue.js');

function addToPriorityQueue(steamId) {
    return new Promise((resolve) => {
        execFile('node', [ADD_PQ_SCRIPT, steamId], (error, stdout, stderr) => {
            if (error) {
                console.error(`❌ Error running PQ add script for ${steamId}: ${error.message}`);
            } else {
                console.log(`✅ PQ add script completed for ${steamId}`);
                if (stdout) console.log(stdout);
                if (stderr) console.error(stderr);
            }
            resolve();
        });
    });
}

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

        // If they already have active PQ in donations, ensure they are in CF Tools PQ
        const donation = await Donation.findOne({ discordId });

        let pqActivatedNow = false;

        if (donation && donation.pqExpiryAt) {
            const now = new Date();
            const expiry = new Date(donation.pqExpiryAt);
            if (expiry > now) {
                await addToPriorityQueue(steamId);
                pqActivatedNow = true;
            }
        }

        let reply = `✅ SteamID \`${steamId}\` has been successfully linked to your Discord account.`;

        if (pqActivatedNow) {
            reply += `\n✅ You already had an active **priority queue** window, so your SteamID has been added to the CF Tools priority queue.`;
        } else {
            reply += `\nℹ️ If you donate **£15 or more**, you will receive **1 month of priority queue**.`;
        }

        await interaction.reply({ content: reply, ephemeral: true });
    }
};
