// commands/checkdono.js
const { SlashCommandBuilder } = require('discord.js');
const Donation = require('../models/Donation');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('checkdono')
        .setDescription('Check a player’s total donation.')
        .addUserOption(option =>
            option
                .setName('player')
                .setDescription('The player to check')
                .setRequired(true)
        ),

    async execute(interaction) {
        const user = interaction.options.getUser('player');

        const record = await Donation.findOne({ discordId: user.id }).lean();

        if (!record || !record.total) {
            return interaction.reply({
                content: `${user.username} has not donated anything yet.`,
                ephemeral: true
            });
        }

        return interaction.reply({
            content: `💰 ${user.username} has donated a total of **£${record.total}**.`,
            ephemeral: true
        });
    }
};
