// commands/myvotes.js
const { SlashCommandBuilder } = require('discord.js');
const SteamLink = require('../models/SteamLink');
const Vote = require('../models/Vote');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('myvotes')
        .setDescription('Check how many Reward Tokens you have from Top-Games votes.'),

    async execute(interaction) {
        const discordId = interaction.user.id;

        await interaction.deferReply({ ephemeral: true });

        // 1) Require a linked SteamID
        const steamLink = await SteamLink.findOne({ discordId }).lean();
        if (!steamLink) {
            return interaction.editReply(
                '❌ You do not have a SteamID linked.\n' +
                'Use **/linksteam <steamid64>** first, and make sure you vote on Top-Games using that SteamID.'
            );
        }

        const steamId64 = steamLink.steamId64;

        // 2) Fetch all votes for this SteamID
        const [unclaimedVotes, claimedVotes] = await Promise.all([
            Vote.find({ steamId64, claimed: false }).lean(),
            Vote.find({ steamId64, claimed: true }).lean()
        ]);

        const unclaimedTokens = unclaimedVotes.reduce(
            (sum, v) => sum + (v.rewardTokens || 0),
            0
        );

        const claimedTokens = claimedVotes.reduce(
            (sum, v) => sum + (v.rewardTokens || 0),
            0
        );

        // 3) Build a nice summary
        let msg = `🆔 Linked SteamID: \`${steamId64}\`\n\n`;

        msg += `🎟️ **Reward Tokens summary**\n`;
        msg += `• Unclaimed Tokens: **${unclaimedTokens}**\n`;
        msg += `• Claimed Tokens: **${claimedTokens}**\n`;

        if (unclaimedVotes.length > 0) {
            const lastVote = unclaimedVotes.sort(
                (a, b) => new Date(b.votedAt) - new Date(a.votedAt)
            )[0];

            msg += `\nLast unclaimed vote recorded at: **${new Date(lastVote.votedAt).toUTCString()}**`;
        } else if (claimedVotes.length > 0) {
            const lastClaim = claimedVotes.sort(
                (a, b) => new Date(b.votedAt) - new Date(a.votedAt)
            )[0];

            msg += `\nLast vote recorded at: **${new Date(lastClaim.votedAt).toUTCString()}**`;
        } else {
            msg += `\nNo votes have been recorded for this SteamID yet.`;
        }

        return interaction.editReply(msg);
    }
};
