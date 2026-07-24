const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const {
  CLAIM_CHANNEL_URL,
  SUPPORT_TERMS_URL,
  formatGBP,
} = require('../config/supportProgram');

function discordTimestamp(date, style = 'F') {
  if (!date) return 'Not applicable';
  return `<t:${Math.floor(new Date(date).getTime() / 1000)}:${style}>`;
}

function safeInlineCode(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/`/g, 'ˋ');
}

function describePriorityQueue(pq) {
  switch (pq?.kind) {
    case 'thirty_days':
      return '30 days of Priority Queue';
    case 'one_year':
      return 'Priority Queue extended to at least 1 year';
    case 'lifetime':
      return 'Lifetime Priority Queue';
    case 'already_unlimited':
      return null;
    default:
      return null;
  }
}

function rankCardText(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return 'None unlocked';
  return cards.map((card) => card.label).join('\n');
}

function buildPendingSupportMessage(order) {
  const benefits = [
    `**${Number(order.expectedTokens || 0).toLocaleString('en-GB')}** Hacksaw Tokens`,
    `**${formatGBP(order.amountPence)}** added to your Lifetime Support Total`,
  ];

  const pqText = describePriorityQueue(order.expectedPriorityQueue);
  if (pqText) benefits.splice(1, 0, `**${pqText}**`);

  const embed = new EmbedBuilder()
    .setTitle('Confirm your support')
    .setDescription(
      `Please review the details below.\n\n` +
      `**Amount:** ${formatGBP(order.amountPence)}\n` +
      `**Payment reference:** \`${safeInlineCode(order.paymentReference)}\`\n` +
      `**Steam ID:** \`${order.steamId64}\``
    )
    .addFields(
      {
        name: 'You will receive',
        value: benefits.map((item) => `• ${item}`).join('\n'),
      },
      {
        name: 'Supporter progress',
        value:
          `**Previous total:** ${formatGBP(order.previousTotalPence)}\n` +
          `**New total:** ${formatGBP(order.expectedNewTotalPence)}\n` +
          `**Supporter rank:** ${order.expectedRankLabel || 'No rank yet'}\n` +
          `**New Rank ID Card${order.expectedRankCards.length === 1 ? '' : 's'}:** ${rankCardText(order.expectedRankCards)}`,
      }
    )
    .setFooter({ text: `Order ${order.orderId}` });

  embed.addFields({
    name: 'Confirmation',
    value: `By confirming, you confirm that these details are correct and agree to the current [Hacksaw Support Terms](${SUPPORT_TERMS_URL}).`,
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`support_confirm:${order.orderId}`)
      .setLabel('Confirm')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`support_problem:${order.orderId}`)
      .setLabel('Something is wrong')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    content: `<@${order.discordId}>`,
    embeds: [embed],
    components: [row],
    allowedMentions: { users: [order.discordId] },
  };
}

function buildCompletedSupportMessage(order) {
  const added = [
    `**${Number(order.tokensCredited || 0).toLocaleString('en-GB')}** Hacksaw Tokens`,
    `**${formatGBP(order.amountPence)}** added to your Lifetime Support Total`,
  ];

  const pqText = describePriorityQueue(order.priorityQueueBenefit);
  if (pqText) added.splice(1, 0, `**${pqText}**`);

  const attention = order.status === 'fulfilment_attention_required';
  const embed = new EmbedBuilder()
    .setTitle(attention ? 'Support confirmed — staff action required' : 'Support confirmed')
    .setDescription(
      `Thank you for supporting Hacksaw.\n\n` +
      `**Order:** \`${order.orderId}\`\n` +
      `**Amount:** ${formatGBP(order.amountPence)}\n` +
      `**Payment reference:** \`${safeInlineCode(order.paymentReference)}\``
    )
    .addFields(
      {
        name: 'Added to your account',
        value: added.map((item) => `• ${item}`).join('\n'),
      },
      {
        name: 'Updated account',
        value:
          `**Lifetime Support Total:** ${formatGBP(order.fulfilledTotalPence)}\n` +
          `**Supporter rank:** ${order.expectedRankLabel || 'No rank yet'}\n` +
          `**Priority Queue expiry:** ${
            order.priorityQueueBenefit?.unlimitedAfter
              ? 'Lifetime access'
              : discordTimestamp(order.priorityQueueBenefit?.expiryAfter)
          }\n` +
          `**New Rank ID Card${order.rankCardsCredited.length === 1 ? '' : 's'}:** ${rankCardText(order.rankCardsCredited)}`,
      },
      {
        name: 'Claiming rewards',
        value: `Claim available Hacksaw Tokens and Rank ID Cards in [Claiming Votes and Donos](${CLAIM_CHANNEL_URL}).`,
      },
      {
        name: 'Record',
        value:
          `**Terms accepted:** Version \`${order.termsVersion}\`\n` +
          `**Confirmed:** ${discordTimestamp(order.acceptedAt)}\n` +
          `Keep the Order ID if you need help with this support purchase.`,
      }
    );

  if (attention) {
    const problems = [];
    if (order.priorityQueueSyncStatus === 'failed') problems.push('Priority Queue sync');
    if (order.roleUpdateStatus === 'failed') problems.push('Discord role update');
    embed.addFields({
      name: 'Staff note',
      value: `${problems.join(' and ') || 'An external fulfilment action'} needs attention. The support record and core benefits were saved; do not process the payment again.`,
    });
  }

  return {
    content: `<@${order.discordId}>`,
    embeds: [embed],
    components: [],
    allowedMentions: { users: [order.discordId] },
  };
}

function buildNeedsCorrectionMessage(order) {
  const embed = new EmbedBuilder()
    .setTitle('Support confirmation needs correction')
    .setDescription(
      `<@${order.discordId}> reported that something in this support record is incorrect.\n\n` +
      `No benefits were granted. Staff should check the payment and create a corrected \`/donate\` record.`
    )
    .setFooter({ text: `Order ${order.orderId}` });

  return {
    content: `<@${order.discordId}>`,
    embeds: [embed],
    components: [],
    allowedMentions: { users: [order.discordId] },
  };
}

module.exports = {
  discordTimestamp,
  describePriorityQueue,
  safeInlineCode,
  buildPendingSupportMessage,
  buildCompletedSupportMessage,
  buildNeedsCorrectionMessage,
};
