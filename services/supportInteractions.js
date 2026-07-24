const SupportOrder = require('../models/SupportOrder');
const {
  confirmSupportOrder,
  markSupportOrderNeedsCorrection,
} = require('./supportOrders');
const {
  buildCompletedSupportMessage,
  buildNeedsCorrectionMessage,
} = require('./supportMessages');

function parseSupportCustomId(customId) {
  const [action, orderId] = String(customId || '').split(':');
  if (!['support_confirm', 'support_problem'].includes(action) || !orderId) {
    return null;
  }
  return { action, orderId };
}

async function replyInteractionError(interaction, error) {
  const message = `❌ ${error.message || 'Unable to process this support confirmation.'}`;
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({ content: message });
  }
  return interaction.reply({ content: message, ephemeral: true });
}

async function handleSupportButton(interaction) {
  const parsed = parseSupportCustomId(interaction.customId);
  if (!parsed) return false;

  const order = await SupportOrder.findOne({ orderId: parsed.orderId }).lean();
  if (!order) {
    await interaction.reply({ content: '❌ This support order could not be found.', ephemeral: true });
    return true;
  }

  if (interaction.user.id !== order.discordId) {
    await interaction.reply({
      content: '❌ Only the player named in this support record can use these buttons.',
      ephemeral: true,
    });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    if (parsed.action === 'support_problem') {
      const correctedOrder = await markSupportOrderNeedsCorrection({
        orderId: parsed.orderId,
        playerDiscordId: interaction.user.id,
      });

      await interaction.message.edit(buildNeedsCorrectionMessage(correctedOrder));
      await interaction.editReply({
        content: '✅ No benefits were granted. Staff have been asked to check the details and create a corrected record.',
      });
      return true;
    }

    const completedOrder = await confirmSupportOrder({
      orderId: parsed.orderId,
      playerDiscordId: interaction.user.id,
      guild: interaction.guild,
    });

    await interaction.message.edit(buildCompletedSupportMessage(completedOrder));
    await interaction.editReply({
      content: completedOrder.status === 'fulfilment_attention_required'
        ? '✅ Your support was recorded. One external action needs staff attention; you do not need to pay again.'
        : '✅ Your support has been confirmed and added to your account.',
    });
    return true;
  } catch (error) {
    console.error(`❌ Support interaction failed for ${parsed.orderId}:`, error);

    if (error.code === 'ORDER_STALE') {
      const staleOrder = await SupportOrder.findOne({ orderId: parsed.orderId });
      if (staleOrder) {
        await interaction.message.edit(buildNeedsCorrectionMessage(staleOrder)).catch(() => null);
      }
    }

    await replyInteractionError(interaction, error);
    return true;
  }
}

module.exports = {
  handleSupportButton,
};
