// commands/forceremoveexpired.js
const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const pqExpiryCheck = require('../tasks/pqExpiryCheck');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('forceremoveexpired')
        .setDescription('Force-run the priority queue expiry sweep for all expired users.'),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({
                content: "❌ You don’t have permission to use this command.",
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            await pqExpiryCheck(interaction.client);
            await interaction.editReply('✅ Priority queue expiry sweep completed.');
        } catch (err) {
            console.error('❌ Error during forced PQ expiry sweep:', err);
            await interaction.editReply('❌ An error occurred while running the PQ expiry sweep. Check logs for details.');
        }
    }
};
