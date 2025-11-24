// commands/pqexpiry.js
const { SlashCommandBuilder } = require('discord.js');
const Donation = require('../models/Donation');

function daysBetween(date1, date2) {
    const diff = date2.getTime() - date1.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pqexpiry')
        .setDescription('Check your priority queue expiry date.'),

    async execute(interaction) {
        const discordId = interaction.user.id;

        const donation = await Donation.findOne({ discordId });

        if (!donation || !donation.pqExpiryAt) {
            return interaction.reply({
                content: '❌ You do not currently have **Priority Queue** access.',
                ephemeral: true
            });
        }

        const now = new Date();
        const expiryDate = new Date(donation.pqExpiryAt);
        const daysLeft = daysBetween(now, expiryDate);

        if (now >= expiryDate) {
            return interaction.reply({
                content: '❌ Your **Priority Queue** access has **expired**.',
                ephemeral: true
            });
        }

        return interaction.reply({
            content: `✅ Your **Priority Queue** access expires on **${expiryDate.toDateString()}** (${daysLeft} days left).`,
            ephemeral: true
        });
    }
};
