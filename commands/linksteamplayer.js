// commands/linksteamplayer.js
const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const SteamLink = require('../models/SteamLink');
const Donation = require('../models/Donation');
const { addToPriorityQueue, isActiveTimedPriorityQueue } = require('../services/priorityQueue');
const { snapshotPlayerIdentity } = require('../services/playerProfiles');

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

        await snapshotPlayerIdentity({
            user: targetUser,
            member: interaction.options.getMember('player'),
            source: 'linksteamplayer',
        }).catch((error) => console.warn('⚠️ Could not update player name snapshot:', error.message));

        // If they already have active or unlimited PQ, ensure they are in CF Tools PQ
        const donation = await Donation.findOne({ discordId: targetUser.id });

        let pqActivatedNow = false;
        let unlimitedPQ = false;

        if (donation) {
            unlimitedPQ = Boolean(donation.unlimitedPriorityQueue);

            if (unlimitedPQ || isActiveTimedPriorityQueue(donation)) {
                await addToPriorityQueue(steamId);
                pqActivatedNow = true;
            }
        }

        let reply = `✅ Linked SteamID \`${steamId}\` to ${targetUser.tag}.`;

        if (pqActivatedNow && unlimitedPQ) {
            reply += `\n✅ They already had **unlimited Priority Queue**, so this SteamID has been added to the CF Tools priority queue.`;
        } else if (pqActivatedNow) {
            reply += `\n✅ They already had an active **Priority Queue** window, so this SteamID has been added to the CF Tools priority queue.`;
        } else {
            reply += `\nℹ️ If they make a support purchase of **£20 or more**, they will receive **1 month of Priority Queue**.`;
        }

        return interaction.reply({
            content: reply,
            ephemeral: true
        });
    }
};
