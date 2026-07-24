const crypto = require('crypto');
const Donation = require('../models/Donation');
const SupportOrder = require('../models/SupportOrder');
const SupportEvent = require('../models/SupportEvent');
const { createTextPdf } = require('./simplePdf');
const { RANKS } = require('../config/supportProgram');
const {
  formatReceiptMoney,
  priorityQueueReceiptDescription,
} = require('./supportText');

const CARD_LABELS = new Map(RANKS.map((rank) => [rank.cardClassname, rank.cardLabel]));

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableValue(value[key]);
        return result;
      }, {});
  }
  return value instanceof Date ? value.toISOString() : value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function signReceipt(payload) {
  const canonical = stableStringify(payload);
  const secret = process.env.SUPPORT_RECEIPT_SECRET;

  if (secret) {
    return {
      algorithm: 'HMAC-SHA256',
      value: crypto.createHmac('sha256', secret).update(canonical).digest('hex'),
    };
  }

  return {
    algorithm: 'SHA256-CHECKSUM',
    value: crypto.createHash('sha256').update(canonical).digest('hex'),
  };
}

function iso(value) {
  return value ? new Date(value).toISOString() : 'Not recorded';
}


function priorityQueueStatus(pq, when) {
  const unlimited = when === 'before' ? pq?.unlimitedBefore : pq?.unlimitedAfter;
  const expiry = when === 'before' ? pq?.expiryBefore : pq?.expiryAfter;
  if (unlimited) return 'Lifetime access';
  return iso(expiry);
}

function cardLabels(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return 'None';
  return cards
    .map((card) => {
      if (typeof card === 'string') return CARD_LABELS.get(card) || card;
      return card.label || CARD_LABELS.get(card.classname) || card.classname || 'Unknown Rank ID Card';
    })
    .join(', ');
}

function actorLabel(event) {
  return `${event.actorType || 'unknown'}${event.actorDiscordId ? `:${event.actorDiscordId}` : ''}`;
}

function eventSummaryLines(event) {
  const data = event.data || {};
  const header = `${iso(event.occurredAt)} | ${event.eventType} | actor=${actorLabel(event)}`;
  const lines = [header, `Event ID: ${event.eventId || 'Not recorded'}`];

  switch (event.eventType) {
    case 'order_created':
      lines.push(
        `Amount: ${formatReceiptMoney(data.amountPence, data.currency)} | Steam ID64: ${data.steamId64 || 'Not recorded'}`,
        `Expected total: ${formatReceiptMoney(data.previousTotalPence)} -> ${formatReceiptMoney(data.expectedNewTotalPence)}`,
        `Expected tokens: ${data.expectedTokens ?? 0} | Rank ID Cards: ${cardLabels(data.expectedRankCards)}`,
        `Priority Queue: ${priorityQueueReceiptDescription(data.expectedPriorityQueue)}`,
        `Terms version: ${data.termsVersion || 'Not recorded'} | Terms hash: ${data.termsHash || 'Not recorded'}`,
        `Payment reference hash: ${data.paymentReferenceHash || 'Not recorded'}`
      );
      break;
    case 'terms_accepted':
      lines.push(
        `Terms version: ${data.termsVersion || 'Not recorded'} | Terms hash: ${data.termsHash || 'Not recorded'}`,
        `Amount confirmed: ${formatReceiptMoney(data.amountPence)} | Steam ID64: ${data.steamId64 || 'Not recorded'}`,
        `Payment reference hash: ${data.paymentReferenceHash || 'Not recorded'}`
      );
      break;
    case 'support_fulfilled_core':
      lines.push(
        `Lifetime Support Total: ${formatReceiptMoney(data.previousTotalPence)} -> ${formatReceiptMoney(data.newTotalPence)}`,
        `Tokens credited: ${data.tokensCredited ?? 0} | Rank ID Cards: ${cardLabels(data.rankCardsCredited)}`,
        `Priority Queue: ${priorityQueueReceiptDescription(data.priorityQueueBenefit)}`
      );
      break;
    case 'tokens_credited':
      lines.push(
        `Tokens credited: ${data.tokens ?? 0} | Unclaimed balance after: ${data.unclaimedBalanceAfter ?? 'Not recorded'}`
      );
      break;
    case 'rank_cards_credited':
      lines.push(`Rank ID Cards credited: ${cardLabels(data.cards)}`);
      break;
    case 'priority_queue_entitlement_updated':
      lines.push(
        `Outcome: ${priorityQueueReceiptDescription(data)}`,
        `PQ before: ${priorityQueueStatus(data, 'before')} | PQ after: ${priorityQueueStatus(data, 'after')}`
      );
      break;
    case 'discord_role_updated':
      lines.push(
        `Status: ${data.status || 'Not recorded'} | Rank: ${data.rankKey || 'Not recorded'} | Role ID: ${data.roleId || 'Not recorded'}`
      );
      break;
    case 'donation_tokens_claimed':
      lines.push(
        `Tokens claimed: ${data.tokensClaimed ?? data.tokens ?? 'Not recorded'} | Remaining balance: ${data.remainingUnclaimed ?? data.unclaimedBalanceAfter ?? 'Not recorded'}`
      );
      break;
    case 'rank_cards_claimed':
      lines.push(`Rank ID Cards claimed: ${cardLabels(data.cards || data.rankCards)}`);
      break;
    default: {
      const compact = JSON.stringify(data);
      if (compact && compact !== '{}') lines.push(`Data: ${compact}`);
      break;
    }
  }

  lines.push('');
  return lines;
}

async function buildSupportReceipt(orderId) {
  const order = await SupportOrder.findOne({ orderId }).lean();
  if (!order) throw new Error(`Support order ${orderId} was not found.`);

  const claimTypes = ['donation_tokens_claimed', 'rank_cards_claimed'];
  const eventFilter = [{ orderId }];
  if (order.fulfilledAt) {
    eventFilter.push({
      discordId: order.discordId,
      eventType: { $in: claimTypes },
      occurredAt: { $gte: order.fulfilledAt },
    });
  }

  const [events, donation] = await Promise.all([
    SupportEvent.find({ $or: eventFilter }).sort({ occurredAt: 1, createdAt: 1 }).lean(),
    Donation.findOne({ discordId: order.discordId }).lean(),
  ]);

  const generatedAt = new Date();
  const receiptCore = {
    receiptVersion: 1,
    generatedAt: generatedAt.toISOString(),
    order: {
      orderId: order.orderId,
      status: order.status,
      discordId: order.discordId,
      discordUsernameSnapshot: order.discordUsernameSnapshot,
      discordGlobalNameSnapshot: order.discordGlobalNameSnapshot,
      discordDisplayNameSnapshot: order.discordDisplayNameSnapshot,
      steamId64: order.steamId64,
      amountPence: order.amountPence,
      currency: order.currency,
      paymentReference: order.paymentReference,
      paymentReferenceHash: order.paymentReferenceHash,
      createdByStaffId: order.createdByStaffId,
      verifiedByStaffId: order.verifiedByStaffId,
      verifiedAt: order.verifiedAt,
      guildId: order.guildId,
      channelId: order.channelId,
      confirmationMessageId: order.confirmationMessageId,
      previousTotalPence: order.previousTotalPence,
      expectedNewTotalPence: order.expectedNewTotalPence,
      expectedTokens: order.expectedTokens,
      expectedRankCards: order.expectedRankCards,
      expectedPriorityQueue: order.expectedPriorityQueue,
      termsVersion: order.termsVersion,
      termsUrl: order.termsUrl,
      termsHash: order.termsHash,
      termsSnapshotSource: order.termsSnapshotSource,
      termsSnapshot: order.termsSnapshot,
      acceptedAt: order.acceptedAt,
      acceptedByDiscordId: order.acceptedByDiscordId,
      acceptanceText: order.acceptanceText,
      fulfilledAt: order.fulfilledAt,
      fulfilledTotalPence: order.fulfilledTotalPence,
      tokensCredited: order.tokensCredited,
      rankCardsCredited: order.rankCardsCredited,
      priorityQueueBenefit: order.priorityQueueBenefit,
      roleUpdateStatus: order.roleUpdateStatus,
      roleUpdateError: order.roleUpdateError,
      priorityQueueSyncStatus: order.priorityQueueSyncStatus,
      priorityQueueSyncError: order.priorityQueueSyncError,
    },
    currentAccountSnapshot: donation
      ? {
          capturedAt: generatedAt.toISOString(),
          lifetimeSupportTotalPence: Math.round(Number(donation.total || 0) * 100),
          unclaimedDonationTokens: donation.unclaimedDonationTokens || 0,
          claimedDonationTokens: donation.claimedDonationTokens || 0,
          unclaimedRankCards: donation.unclaimedRankCards || [],
          claimedRankCards: donation.claimedRankCards || [],
          pqExpiryAt: donation.pqExpiryAt || null,
          unlimitedPriorityQueue: Boolean(donation.unlimitedPriorityQueue),
        }
      : null,
    timeline: events.map((event) => ({
      eventId: event.eventId,
      orderId: event.orderId || null,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      actorType: event.actorType,
      actorDiscordId: event.actorDiscordId || null,
      data: event.data || {},
    })),
  };

  const signature = signReceipt(receiptCore);
  const receipt = { ...receiptCore, signature };

  const pq = order.priorityQueueBenefit || order.expectedPriorityQueue || {};
  const lines = [
    `Receipt generated: ${generatedAt.toISOString()}`,
    `Order ID: ${order.orderId}`,
    `Order status: ${order.status}`,
    '',
    'PLAYER AND PAYMENT',
    `Discord ID: ${order.discordId}`,
    `Discord username at order time: ${order.discordUsernameSnapshot || 'Not recorded'}`,
    `Discord global name at order time: ${order.discordGlobalNameSnapshot || 'Not recorded'}`,
    `Discord display name at order time: ${order.discordDisplayNameSnapshot || 'Not recorded'}`,
    `Steam ID64: ${order.steamId64}`,
    `Amount: ${formatReceiptMoney(order.amountPence, order.currency)}`,
    `Payment reference: ${order.paymentReference}`,
    `Payment reference SHA-256: ${order.paymentReferenceHash}`,
    `Payment verified/entered by Discord ID: ${order.verifiedByStaffId}`,
    `Payment verified/entered at: ${iso(order.verifiedAt)}`,
    '',
    'PLAYER CONFIRMATION',
    `Accepted by Discord ID: ${order.acceptedByDiscordId || 'Not recorded'}`,
    `Accepted at: ${iso(order.acceptedAt)}`,
    `Acceptance: ${order.acceptanceText || 'Not recorded'}`,
    `Terms version: ${order.termsVersion}`,
    `Terms URL: ${order.termsUrl}`,
    `Terms snapshot SHA-256: ${order.termsHash}`,
    `Terms snapshot source: ${order.termsSnapshotSource}`,
    '',
    'FULFILMENT',
    `Previous Lifetime Support Total: ${formatReceiptMoney(order.previousTotalPence)}`,
    `Lifetime Support Total after fulfilment: ${formatReceiptMoney(order.fulfilledTotalPence ?? order.expectedNewTotalPence)}`,
    `Hacksaw Tokens credited: ${order.tokensCredited ?? order.expectedTokens ?? 0}`,
    `Rank ID Cards credited: ${cardLabels(order.rankCardsCredited)}`,
    `Priority Queue outcome: ${priorityQueueReceiptDescription(pq)}`,
    `Priority Queue status before: ${priorityQueueStatus(pq, 'before')}`,
    `Priority Queue status after: ${priorityQueueStatus(pq, 'after')}`,
    `CF Tools PQ sync: ${order.priorityQueueSyncStatus || 'Not recorded'}`,
    `Discord role update: ${order.roleUpdateStatus || 'Not recorded'}`,
    `Fulfilled at: ${iso(order.fulfilledAt)}`,
    '',
    'CURRENT ACCOUNT SNAPSHOT',
    donation ? `Snapshot captured: ${generatedAt.toISOString()}` : 'No current Donation record found.',
    donation ? `Lifetime Support Total: ${formatReceiptMoney(Math.round(Number(donation.total || 0) * 100))}` : '',
    donation ? `Unclaimed Hacksaw Tokens: ${donation.unclaimedDonationTokens || 0}` : '',
    donation ? `Claimed Hacksaw Tokens: ${donation.claimedDonationTokens || 0}` : '',
    donation ? `Unclaimed Rank ID Cards: ${cardLabels(donation.unclaimedRankCards)}` : '',
    donation ? `Claimed Rank ID Cards: ${cardLabels(donation.claimedRankCards)}` : '',
    donation ? `Current Priority Queue status: ${donation.unlimitedPriorityQueue ? 'Lifetime access' : iso(donation.pqExpiryAt)}` : '',
    '',
    'AUDIT TIMELINE',
    ...events.flatMap(eventSummaryLines),
    'RECEIPT INTEGRITY',
    `Receipt signature algorithm: ${signature.algorithm}`,
    `Receipt signature: ${signature.value}`,
    '',
    'The signature covers the machine-readable JSON receipt data supplied with this PDF.',
    "Account-level claim events may include rewards claimed from the player's cumulative balance after this order was fulfilled.",
  ].filter((line) => line !== undefined && line !== null);

  return {
    receipt,
    pdf: createTextPdf(lines, { title: 'Hacksaw Support Evidence Receipt' }),
    json: Buffer.from(JSON.stringify(receipt, null, 2), 'utf8'),
  };
}

module.exports = {
  buildSupportReceipt,
  stableStringify,
  signReceipt,
  formatReceiptMoney,
  priorityQueueDescription: priorityQueueReceiptDescription,
};
