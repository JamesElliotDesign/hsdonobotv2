const crypto = require('crypto');
const Donation = require('../models/Donation');
const SupportOrder = require('../models/SupportOrder');
const SupportEvent = require('../models/SupportEvent');
const { createTextPdf } = require('./simplePdf');
const { formatGBP } = require('../config/supportProgram');

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

function stringifyData(data) {
  if (!data || Object.keys(data).length === 0) return '';
  return JSON.stringify(data);
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

  const cardLabels = (order.rankCardsCredited || []).map((card) => card.label).join(', ') || 'None';
  const pq = order.priorityQueueBenefit || {};
  const lines = [
    `Receipt generated: ${generatedAt.toISOString()}`,
    `Order ID: ${order.orderId}`,
    `Order status: ${order.status}`,
    '',
    'PLAYER AND PAYMENT',
    `Discord ID: ${order.discordId}`,
    `Discord username at order time: ${order.discordUsernameSnapshot}`,
    `Discord global name at order time: ${order.discordGlobalNameSnapshot || 'Not recorded'}`,
    `Discord display name at order time: ${order.discordDisplayNameSnapshot || 'Not recorded'}`,
    `Steam ID64: ${order.steamId64}`,
    `Amount: ${formatGBP(order.amountPence)} ${order.currency}`,
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
    `Previous Lifetime Support Total: ${formatGBP(order.previousTotalPence)}`,
    `Lifetime Support Total after fulfilment: ${formatGBP(order.fulfilledTotalPence ?? order.expectedNewTotalPence)}`,
    `Hacksaw Tokens credited: ${order.tokensCredited ?? order.expectedTokens ?? 0}`,
    `Rank ID Cards credited: ${cardLabels}`,
    `Priority Queue benefit: ${pq.kind || 'none'}`,
    `PQ expiry before: ${iso(pq.expiryBefore)}`,
    `PQ expiry after: ${pq.unlimitedAfter ? 'Lifetime' : iso(pq.expiryAfter)}`,
    `CF Tools PQ sync: ${order.priorityQueueSyncStatus}`,
    `Discord role update: ${order.roleUpdateStatus}`,
    `Fulfilled at: ${iso(order.fulfilledAt)}`,
    '',
    'CURRENT ACCOUNT SNAPSHOT',
    donation ? `Lifetime Support Total: ${formatGBP(Math.round(Number(donation.total || 0) * 100))}` : 'No current Donation record found.',
    donation ? `Unclaimed Hacksaw Tokens: ${donation.unclaimedDonationTokens || 0}` : '',
    donation ? `Claimed Hacksaw Tokens: ${donation.claimedDonationTokens || 0}` : '',
    donation ? `Unclaimed Rank ID Cards: ${(donation.unclaimedRankCards || []).join(', ') || 'None'}` : '',
    donation ? `Claimed Rank ID Cards: ${(donation.claimedRankCards || []).join(', ') || 'None'}` : '',
    donation ? `Current PQ expiry: ${donation.unlimitedPriorityQueue ? 'Lifetime' : iso(donation.pqExpiryAt)}` : '',
    '',
    'AUDIT TIMELINE',
    ...events.flatMap((event) => [
      `${iso(event.occurredAt)} | ${event.eventType} | actor=${event.actorType}${event.actorDiscordId ? `:${event.actorDiscordId}` : ''}`,
      stringifyData(event.data) ? `  ${stringifyData(event.data)}` : '',
    ]).filter(Boolean),
    '',
    `Receipt signature algorithm: ${signature.algorithm}`,
    `Receipt signature: ${signature.value}`,
    '',
    'This receipt was generated from Hacksaw bot records. Account-level claim events may include rewards claimed from the player’s cumulative balance after this order was fulfilled.',
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
};
