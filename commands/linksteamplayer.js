// commands/linksteamplayer.js
const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
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
        .setName('linksteamplayer')
        .setDescription('Admins: Link a SteamID to a user manually.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addUserOption(option =>
            option.setName('player')
                .setDescription('The Discord user to link')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('steamid')
                .setDescription('SteamID64 to link')
                .setRequired(true)
        ),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                ephemeral: true
            });
        }

        const targetUser = interaction.options.getUser('player');
        const steamId = interaction.options.getString('steamid').trim();

        if (!/^\d{17}$/.test(steamId)) {
            return interaction.reply({
                content: '❌ That does not look like a valid SteamID64 (expected 17 digits).',
                ephemeral: true
            });
        }

        // Upsert Steam link
        let link = await SteamLink.findOne({ discordId: targetUser.id });
        if (!link) {
            link = new SteamLink({ discordId: targetUser.id, steamId64: steamId });
        } else {
            link.steamId64 = steamId;
        }
        await link.save();

        // If they already have active PQ, ensure they are in CF Tools PQ
        const donation = await Donation.findOne({ discordId: targetUser.id });

        let pqActivatedNow = false;
        if (donation && donation.pqExpiryAt) {
            const now = new Date();
            const expiry = new Date(donation.pqExpiryAt);
            if (expiry > now) {
                await addToPriorityQueue(steamId);
                pqActivatedNow = true;
            }
        }

        let reply = `✅ Linked SteamID \`${steamId}\` to ${targetUser.tag}.`;

        if (pqActivatedNow) {
            reply += `\n✅ They already had an active **priority queue** window, so this SteamID has been added to the CF Tools priority queue.`;
        } else {
            reply += `\nℹ️ If they donate **£20 or more**, they will receive **1 month of priority queue**.`;
        }

        return interaction.reply({
            content: reply,
            ephemeral: true
        });
    }
};
