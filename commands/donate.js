// commands/donate.js
const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const Donation = require('../models/Donation');
const SteamLink = require('../models/SteamLink');
const {
    addToPriorityQueue,
    isActiveTimedPriorityQueue,
    addYears
} = require('../services/priorityQueue');

// Donation roles thresholds (by total donated)
const roles = [
    { id: "1345839570041835591", amount: 1000 },
    { id: "1345840100491395092", amount: 500 },
    { id: "1345839616095289345", amount: 250 },
    { id: "1345838625757204640", amount: 150 },
    { id: "1345836451362766880", amount: 100 },
    { id: "1345834598969643221", amount: 50 },
    { id: "1227025687316005015", amount: 20 }
];

// Rank ID Cards thresholds (by TOTAL donated)
const rankCards = [
    { amount: 2000, classname: "HS_RANKIDDIAMOND", label: "Diamond Rank ID Card" },
    { amount: 1000, classname: "HS_RANKIDAQUAMARINE", label: "Aquamarine Rank ID Card" },
    { amount: 500, classname: "HS_RANKIDTURQUOISE", label: "Turquoise Rank ID Card" },
    { amount: 250, classname: "HS_RANKIDIOLITE", label: "Iolite Rank ID Card" },
    { amount: 150, classname: "HS_RANKIDRUBY", label: "Ruby Rank ID Card" },
    { amount: 100, classname: "HS_RANKIDAMBER", label: "Amber Rank ID Card" },
    { amount: 50, classname: "HS_RANKIDJADE", label: "Jade Rank ID Card" },
    { amount: 20, classname: "HS_RANKIDAMETHYST", label: "Amethyst Rank ID Card" },
];

const RANK_PQ_PERKS = {
    TURQUOISE: { amount: 500, label: 'Turquoise Rank' },
    AQUAMARINE: { amount: 1000, label: 'Aquamarine Rank' },
    DIAMOND: { amount: 2000, label: 'Diamond Rank' }
};

function getRoleForDonation(totalAmount) {
    return roles.find(role => totalAmount >= role.amount) || null;
}

function hasReachedRank(previousTotal, newTotal, rankAmount) {
    return previousTotal < rankAmount && newTotal >= rankAmount;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('donate')
        .setDescription('Track a player’s donation.')
        .addUserOption(option =>
            option.setName('player')
                .setDescription('The player who donated')
                .setRequired(true))
        .addNumberOption(option =>
            option.setName('amount')
                .setDescription('Amount donated (in £)')
                .setRequired(true)),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({
                content: "❌ You don’t have permission to use this command.",
                ephemeral: true
            });
        }

        const user = interaction.options.getUser('player');
        const amount = interaction.options.getNumber('amount');

        if (amount <= 0) {
            return interaction.reply({
                content: "❌ Donation amount must be greater than 0.",
                ephemeral: true
            });
        }

        // Require Steam link before processing the donation so PQ rewards can be applied immediately.
        const steamLink = await SteamLink.findOne({ discordId: user.id });
        if (!steamLink) {
            return interaction.reply({
                content:
                    `❌ ${user.username} does not have a SteamID linked yet.\n` +
                    `They must use **/linksteam <steamid>** before you can log a donation.`,
                ephemeral: true
            });
        }

        const now = new Date();
        let donation = await Donation.findOne({ discordId: user.id });

        if (!donation) {
            donation = new Donation({
                discordId: user.id,
                total: 0,
                history: []
            });
        }

        const previousTotal = donation.total || 0;

        // Update donation info
        donation.total = previousTotal + amount;
        donation.lastDonationAt = now;
        donation.history.push({
            amount,
            at: now,
            addedBy: interaction.user.id
        });

        // Rank ID Cards: credit any newly-earned cards (claimable once)
        const alreadyUnclaimed = new Set(donation.unclaimedRankCards || []);
        const alreadyClaimed = new Set(donation.claimedRankCards || []);

        const newlyCreditedCards = [];

        for (const rc of rankCards) {
            if (donation.total >= rc.amount) {
                const alreadyHasIt = alreadyUnclaimed.has(rc.classname) || alreadyClaimed.has(rc.classname);
                if (!alreadyHasIt) {
                    donation.unclaimedRankCards = donation.unclaimedRankCards || [];
                    donation.unclaimedRankCards.push(rc.classname);
                    newlyCreditedCards.push(rc);
                }
            }
        }

        let pqGranted = false;
        let pqExtended = false;
        let turquoisePQGranted = false;
        let turquoisePQExtended = false;
        let unlimitedPQGrantedByRank = null;
        let shouldEnsureCFToolsPQ = false;

        // PQ logic: each donation >= 15 grants a month of timed PQ unless the user already has unlimited PQ.
        if (amount >= 15 && !donation.unlimitedPriorityQueue) {
            const hasActivePQ = isActiveTimedPriorityQueue(donation, now);
            const currentExpiry = donation.pqExpiryAt ? new Date(donation.pqExpiryAt) : null;
            const baseDate = hasActivePQ ? currentExpiry : now;
            const newExpiry = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 days

            pqGranted = !hasActivePQ;
            pqExtended = hasActivePQ;

            donation.pqExpiryAt = newExpiry;
            donation.pqExpiryNotified = false; // reset so they can be notified for the new expiry

            if (pqGranted) {
                shouldEnsureCFToolsPQ = true;
            }
        }

        // Donation-rank PQ perks.
        // Turquoise grants at least 1 year of timed PQ from the rank-up date.
        if (
            hasReachedRank(previousTotal, donation.total, RANK_PQ_PERKS.TURQUOISE.amount) &&
            !donation.unlimitedPriorityQueue
        ) {
            const oneYearExpiry = addYears(now, 1);
            const currentExpiry = donation.pqExpiryAt ? new Date(donation.pqExpiryAt) : null;
            const hadActivePQ = isActiveTimedPriorityQueue(donation, now);

            if (!currentExpiry || currentExpiry.getTime() < oneYearExpiry.getTime()) {
                donation.pqExpiryAt = oneYearExpiry;
                donation.pqExpiryNotified = false;
                turquoisePQGranted = !hadActivePQ;
                turquoisePQExtended = hadActivePQ;
            }

            shouldEnsureCFToolsPQ = true;
        }

        // Aquamarine and Diamond grant unlimited PQ.
        const reachedAquamarine = hasReachedRank(previousTotal, donation.total, RANK_PQ_PERKS.AQUAMARINE.amount);
        const reachedDiamond = hasReachedRank(previousTotal, donation.total, RANK_PQ_PERKS.DIAMOND.amount);

        if ((reachedAquamarine || reachedDiamond) && !donation.unlimitedPriorityQueue) {
            donation.unlimitedPriorityQueue = true;
            donation.pqExpiryNotified = false;
            unlimitedPQGrantedByRank = reachedDiamond ? RANK_PQ_PERKS.DIAMOND.label : RANK_PQ_PERKS.AQUAMARINE.label;
            shouldEnsureCFToolsPQ = true;
        }

        // Donation token logic: 100 Hacksaw Tokens per £1 donated
        const tokensToCredit = Math.floor(amount * 100);
        donation.unclaimedDonationTokens = (donation.unclaimedDonationTokens || 0) + tokensToCredit;

        // Save donation changes
        await donation.save();

        if (shouldEnsureCFToolsPQ) {
            await addToPriorityQueue(steamLink.steamId64);
        }

        // Role handling based on TOTAL donations
        const roleToGive = getRoleForDonation(donation.total);
        const guildMember = await interaction.guild.members.fetch(user.id).catch(() => null);

        if (guildMember && roleToGive) {
            const roleIds = roles.map(r => r.id);

            // Remove lower donation roles
            const rolesToRemove = guildMember.roles.cache.filter(r => roleIds.includes(r.id) && r.id !== roleToGive.id);

            if (rolesToRemove.size > 0) {
                await guildMember.roles.remove(rolesToRemove);
            }

            if (!guildMember.roles.cache.has(roleToGive.id)) {
                await guildMember.roles.add(roleToGive.id);
            }
        }

        // Build reply message
        let replyMsg =
            `✅ Added **£${amount}** to ${user.username}'s donation record.\n` +
            `They now have **£${donation.total}** in total donations.\n` +
            `💰 This donation credited **${tokensToCredit}** Hacksaw Tokens (unclaimed).`;

        if (newlyCreditedCards.length > 0) {
            const cardList = newlyCreditedCards.map(c => c.label).join(", ");
            replyMsg += `\n🪪 Rank reward credited: **${cardList}** (claim in-game with **/claimrank**).`;
        }

        if (unlimitedPQGrantedByRank) {
            replyMsg += `\n✅ **${unlimitedPQGrantedByRank}** reached: unlimited **Priority Queue** has been granted.`;
        } else if (turquoisePQGranted) {
            replyMsg += `\n✅ **Turquoise Rank** reached: **Priority Queue** has been granted for **1 year**.`;
        } else if (turquoisePQExtended) {
            replyMsg += `\n✅ **Turquoise Rank** reached: **Priority Queue** has been extended to at least **1 year from today**.`;
        } else if (pqGranted) {
            replyMsg += `\n✅ A one-month **Priority Queue** has been **granted**.`;
        } else if (pqExtended) {
            replyMsg += `\n✅ Their **Priority Queue** has been **extended by one month**.`;
        } else if (amount >= 15 && donation.unlimitedPriorityQueue) {
            replyMsg += `\nℹ️ They already have **unlimited Priority Queue**, so no timed PQ extension was needed.`;
        }

        await interaction.reply({ content: replyMsg });
    }
};
