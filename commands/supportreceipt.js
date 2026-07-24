const { SlashCommandBuilder, PermissionsBitField, AttachmentBuilder } = require('discord.js');
const { buildSupportReceipt } = require('../services/supportReceipt');
const { safeRecordSupportEvent } = require('../services/supportAudit');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('supportreceipt')
    .setDescription('Generate an evidence receipt for a support order.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption((option) =>
      option
        .setName('order')
        .setDescription('Order ID; find it with /playerinfo if needed')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({
        content: '❌ You do not have permission to use this command.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const orderId = interaction.options.getString('order').trim().toUpperCase();
      const result = await buildSupportReceipt(orderId);
      const safeName = orderId.replace(/[^A-Z0-9_-]/gi, '_');

      await safeRecordSupportEvent({
        orderId,
        discordId: result.receipt.order.discordId,
        eventType: 'evidence_receipt_generated',
        actorType: 'staff',
        actorDiscordId: interaction.user.id,
        data: {
          generatedAt: result.receipt.generatedAt,
          signature: result.receipt.signature,
        },
      });

      await interaction.editReply({
        content: `✅ Evidence receipt generated for **${orderId}**.`,
        files: [
          new AttachmentBuilder(result.pdf, { name: `${safeName}-evidence-receipt.pdf` }),
          new AttachmentBuilder(result.json, { name: `${safeName}-evidence-receipt.json` }),
        ],
      });
    } catch (error) {
      console.error('❌ Failed to generate support receipt:', error);
      await interaction.editReply({
        content: `❌ ${error.message || 'Unable to generate the support receipt.'}\nUse \`/playerinfo\` to find a player’s Order IDs.`,
      });
    }
  },
};
