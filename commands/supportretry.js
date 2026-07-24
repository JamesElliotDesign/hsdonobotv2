const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { retrySupportOrder } = require('../services/supportOrders');
const { buildCompletedSupportMessage } = require('../services/supportMessages');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('supportretry')
    .setDescription('Retry an interrupted support fulfilment action.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption((option) =>
      option
        .setName('order')
        .setDescription('Support Order ID')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const orderId = interaction.options.getString('order').trim().toUpperCase();
      const order = await retrySupportOrder({
        orderId,
        guild: interaction.guild,
        staffDiscordId: interaction.user.id,
      });

      if (order.channelId && order.confirmationMessageId) {
        const channel = await interaction.client.channels.fetch(order.channelId).catch(() => null);
        const message = channel?.isTextBased()
          ? await channel.messages.fetch(order.confirmationMessageId).catch(() => null)
          : null;
        if (message) await message.edit(buildCompletedSupportMessage(order));
      }

      await interaction.editReply({
        content: order.status === 'fulfilled'
          ? `✅ Support order **${orderId}** is now fully fulfilled.`
          : `⚠️ Support order **${orderId}** still requires attention. Check the bot logs and generate a receipt for details.`,
      });
    } catch (error) {
      console.error('❌ Support retry failed:', error);
      await interaction.editReply({ content: `❌ ${error.message || 'Unable to retry this support order.'}` });
    }
  },
};
