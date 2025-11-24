// commands/donate.js
const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const { execFile } = require('child_process');
const Donation = require('../models/Donation');
const SteamLink = require('../models/SteamLink');

const ADD_PQ_SCRIPT = path.join(__dirname, '..', 'add-to-priority-queue.js');

// Donation roles thresholds (by total donated)
const roles = [
    { id: "1345839570041835591", amount: 1000 },
    { id: "1345840100491395092", amount: 500 },
    { id: "1345839616095289345", amount: 250 },
    { id: "1345838625757204640", amount: 150 },
    { id: "1345836451362766880", amount: 100 },
    { id: "1345834598969643221", amount: 50 },
    { id: "1227025687316005015", amount: 15 }
];

function getRoleForDonation(totalAmount) {
    return roles.find(role => totalAmount >= role.amount) || null;
}

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

        // 🔐 NEW: require Steam link before processing the donation
        const steamLink = await SteamLink.findOne({ discordId: user.id });
        if (!steamLink) {
            return interaction.reply({
                content:
                    `❌ ${user.username} does not have a SteamID linked yet.\n` +
                    `They must use **/linksteam \<steamid\>** before you can log a donation.`,
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

        // Update donation info
        donation.total += amount;
        donation.lastDonationAt = now;
        donation.history.push({
            amount,
            at: now,
            addedBy: interaction.user.id
        });

        let pqGranted = false;
        let pqExtended = false;

        // PQ logic: each donation >= 15 grants a month of PQ
        if (amount >= 15) {
            const nowMs = now.getTime();
            const currentExpiry = donation.pqExpiryAt ? new Date(donation.pqExpiryAt) : null;
            const hasActivePQ = currentExpiry && currentExpiry.getTime() > nowMs;

            const baseDate = hasActivePQ ? currentExpiry : now;
            const newExpiry = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 days

            pqGranted = !hasActivePQ;
            pqExtended = hasActivePQ;

            donation.pqExpiryAt = newExpiry;
            donation.pqExpiryNotified = false; // reset so they can be notified for the new expiry

            // Only call ADD PQ script when newly granting PQ (not just extending)
            if (pqGranted) {
                await addToPriorityQueue(steamLink.steamId64);
            }
        }

        // 💰 Donation token logic: 10 Hacksaw Tokens per £1 donated
        const tokensToCredit = Math.floor(amount * 10);
        donation.unclaimedDonationTokens = (donation.unclaimedDonationTokens || 0) + tokensToCredit;

        // Save donation changes
        await donation.save();

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


        if (pqGranted) {
            replyMsg += `\n✅ A one-month **priority queue** has been **granted**.`;
        } else if (pqExtended) {
            replyMsg += `\n✅ Their **priority queue** has been **extended by one month**.`;
        } else if (amount >= 15) {
            // This case means: they donated >= 15 but for some reason PQ didn't change (e.g. logic change later)
            replyMsg += `\nℹ️ This donation qualifies for **priority queue**, but no change was applied (already handled).`;
        }

        await interaction.reply({ content: replyMsg });
    }
};
