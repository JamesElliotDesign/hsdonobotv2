// commands/addunlimitedpq.js
const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const Donation = require('../models/Donation');
const SteamLink = require('../models/SteamLink');
const { addToPriorityQueue } = require('../services/priorityQueue');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addunlimitedpq')
        .setDescription('Admins: Grant unlimited Priority Queue to a staff member/user.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addUserOption(option =>
            option.setName('player')
                .setDescription('The Discord user to grant unlimited PQ')
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

        let donation = await Donation.findOne({ discordId: targetUser.id });
        if (!donation) {
            donation = new Donation({
                discordId: targetUser.id,
                total: 0,
                history: []
            });
        }

        const alreadyUnlimited = Boolean(donation.unlimitedPriorityQueue);
        donation.unlimitedPriorityQueue = true;
        donation.pqExpiryNotified = false;
        donation.history.push({
            amount: 0,
            at: now,
            addedBy: interaction.user.id,
            note: 'Manual unlimited PQ grant via /addunlimitedpq'
        });

        await donation.save();

        const link = await SteamLink.findOne({ discordId: targetUser.id }).lean();
        if (link) {
            await addToPriorityQueue(link.steamId64);
        }

        let reply = alreadyUnlimited
            ? `ℹ️ ${targetUser.tag} already had **unlimited Priority Queue**. The database flag is still enabled.`
            : `✅ ${targetUser.tag} now has **unlimited Priority Queue**.`;

        if (link) {
            reply += `\n✅ SteamID \`${link.steamId64}\` has been added/ensured in the CF Tools Priority Queue list.`;
        } else {
            reply += `\n⚠️ No SteamID is linked for this user yet. Their unlimited PQ flag is saved, and **/linksteamplayer** or **/linksteam** will add them to CF Tools once linked.`;
        }

        await interaction.editReply(reply);
    }
};
