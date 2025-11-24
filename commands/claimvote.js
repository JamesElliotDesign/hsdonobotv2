// commands/claimvote.js
const { SlashCommandBuilder } = require('discord.js');
const { claimVotesBySteamId } = require('../services/topGames');
const Vote = require('../models/Vote');
const SteamLink = require('../models/SteamLink');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('claimvote')
        .setDescription('Claim your vote reward from Top-Games.net using your linked SteamID'),

    async execute(interaction) {
        const discordId = interaction.user.id;

        await interaction.deferReply({ ephemeral: true });

        // 1) Require SteamID link
        const steamLink = await SteamLink.findOne({ discordId }).lean();
        if (!steamLink) {
            return interaction.editReply(
                '❌ You do not have a SteamID linked.\n' +
                'Use **/linksteam <steamid64>** first, and make sure you vote on Top-Games using that SteamID.'
            );
        }

        const steamId64 = steamLink.steamId64;

        try {
            // 2) Ask Top-Games if there’s an unclaimed vote for this SteamID
            const { claimedCode, raw } = await claimVotesBySteamId(steamId64);

            if (claimedCode === 0 || claimedCode === null) {
                return interaction.editReply(
                    `❌ No unclaimed votes found on Top-Games for your SteamID \`${steamId64}\`.\n` +
                    `Make sure you voted for the correct server **using this SteamID as your username**.`
                );
            }

            if (claimedCode === 2) {
                return interaction.editReply(
                    `ℹ️ Top-Games reports that your latest vote for SteamID \`${steamId64}\` was already claimed.\n` +
                    `If you believe this is wrong, please contact staff.`
                );
            }

            if (claimedCode === 1) {
                // 3) New claim → record one vote = 1 Reward Token (configurable later)
                const voteDoc = new Vote({
                    provider: 'top-games',
                    providerVoteId: null,
                    steamId64,
                    discordId,
                    playerName: null, // we’re using steam ID, username is optional
                    votedAt: new Date(),
                    rewardTokens: 10,
                    claimed: false, // not yet turned into in-game Reward_Tokens
                    rawResponse: raw
                });

                await voteDoc.save();

                // 4) How many unclaimed Reward_Tokens does this SteamID have now?
                const unclaimedVotes = await Vote.find({
                    steamId64,
                    claimed: false
                }).lean();

                const totalUnclaimedTokens = unclaimedVotes.reduce(
                    (sum, v) => sum + (v.rewardTokens || 0),
                    0
                );

                return interaction.editReply(
                    `✅ Successfully claimed your vote from Top-Games for SteamID \`${steamId64}\`.\n` +
                    `🎟️ You have been credited with **1 Reward Token**.\n` +
                    `You now have **${totalUnclaimedTokens}** unclaimed Reward Tokens tied to this SteamID.`
                );
            }

            return interaction.editReply(
                `⚠️ Received an unknown response from Top-Games (claimedCode = ${claimedCode}). Please contact staff.`
            );
        } catch (err) {
            console.error('Error in /claimvote:', err);
            return interaction.editReply(
                '❌ An error occurred while talking to Top-Games. Please try again later or contact staff.'
            );
        }
    }
};
