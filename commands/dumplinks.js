// commands/dumplinks.js
const { SlashCommandBuilder, AttachmentBuilder, PermissionsBitField } = require('discord.js');
const SteamLink = require('../models/SteamLink');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dumplinks')
        .setDescription('Dump all Steam link records as a .txt attachment'),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({
                content: "❌ You don’t have permission to use this command.",
                ephemeral: true
            });
        }

        const records = await SteamLink.find().lean();

        if (!records || records.length === 0) {
            return interaction.reply({
                content: 'ℹ️ No Steam link records found in the database.',
                ephemeral: true
            });
        }

        const dumpText = JSON.stringify(records, null, 2);
        const buffer = Buffer.from(dumpText, 'utf8');

        const attachment = new AttachmentBuilder(buffer, { name: 'steamlinks_dump.txt' });

        await interaction.reply({
            content: '📄 Here is the current dump of all Steam link records.',
            files: [attachment]
        });
    }
};
