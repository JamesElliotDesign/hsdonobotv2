// commands/dumpdonos.js
const { SlashCommandBuilder, AttachmentBuilder, PermissionsBitField } = require('discord.js');
const Donation = require('../models/Donation');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dumpdonos')
        .setDescription('Dump all donation records as a .txt attachment'),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({
                content: "❌ You don’t have permission to use this command.",
                ephemeral: true
            });
        }

        const records = await Donation.find().lean();

        if (!records || records.length === 0) {
            return interaction.reply({
                content: 'ℹ️ No donation records found in the database.',
                ephemeral: true
            });
        }

        const dumpText = JSON.stringify(records, null, 2);
        const buffer = Buffer.from(dumpText, 'utf8');

        const attachment = new AttachmentBuilder(buffer, { name: 'donations_dump.txt' });

        await interaction.reply({
            content: '📄 Here is the current dump of all donation records.',
            files: [attachment]
        });
    }
};
