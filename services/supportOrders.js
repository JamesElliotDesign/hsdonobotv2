const crypto = require('crypto');
const mongoose = require('mongoose');
const Donation = require('../models/Donation');
const SteamLink = require('../models/SteamLink');
const SupportOrder = require('../models/SupportOrder');
const { recordSupportEvent, safeRecordSupportEvent } = require('./supportAudit');
const { captureTermsSnapshot, sha256 } = require('./termsSnapshot');
const { snapshotPlayerIdentity } = require('./playerProfiles');
const {
  addToPriorityQueueDetailed,
  isActiveTimedPriorityQueue,
  addYears,
} = require('./priorityQueue');
const {
  CURRENCY,
  MONTHLY_PQ_DAYS,
  MONTHLY_PQ_MINIMUM_PENCE,
  RANKS,
  poundsToPence,
  penceToPounds,
  tokensForAmountPence,
  getCurrentRank,
  getDiscordRoleForTotal,
  getCrossedRanks,
  getCardsToCredit,
} = require('../config/supportProgram');

const ORDER_EXPIRY_HOURS = Number(process.env.SUPPORT_ORDER_EXPIRY_HOURS || 72);
const ACCEPTANCE_TEXT = 'I confirm that the displayed support details are correct and agree to the current Hacksaw Support Terms.';

function createOrderId() {
  const year = new Date().getUTCFullYear();
  return `HS-${year}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function normalizePaymentReference(reference) {
  return String(reference || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function referenceHash(normalizedReference) {
  return sha256(normalizedReference);
}

function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * 24 * 60 * 60 * 1000);
}

function calculatePriorityQueueBenefit(donation, previousTotalPence, newTotalPence, amountPence, now = new Date()) {
  const unlimitedBefore = Boolean(donation?.unlimitedPriorityQueue);
  const expiryBefore = donation?.pqExpiryAt ? new Date(donation.pqExpiryAt) : null;
  const crossedRanks = getCrossedRanks(previousTotalPence, newTotalPence);
  const crossedAquamarineOrDiamond = crossedRanks.some(
    (rank) => rank.key === 'AQUAMARINE' || rank.key === 'DIAMOND'
  );
  const crossedTurquoise = crossedRanks.some((rank) => rank.key === 'TURQUOISE');

  if (unlimitedBefore) {
    return {
      kind: 'already_unlimited',
      daysAdded: 0,
      expiryBefore,
      expiryAfter: expiryBefore,
      unlimitedBefore: true,
      unlimitedAfter: true,
    };
  }

  if (crossedAquamarineOrDiamond) {
    return {
      kind: 'lifetime',
      daysAdded: 0,
      expiryBefore,
      expiryAfter: expiryBefore,
      unlimitedBefore: false,
      unlimitedAfter: true,
    };
  }

  if (crossedTurquoise) {
    const oneYearExpiry = addYears(now, 1);
    const expiryAfter = !expiryBefore || expiryBefore.getTime() < oneYearExpiry.getTime()
      ? oneYearExpiry
      : expiryBefore;

    const daysAdded = Math.max(
      0,
      Math.round((expiryAfter.getTime() - (expiryBefore || now).getTime()) / (24 * 60 * 60 * 1000))
    );
    return {
      kind: 'one_year',
      daysAdded,
      expiryBefore,
      expiryAfter,
      unlimitedBefore: false,
      unlimitedAfter: false,
    };
  }

  if (amountPence >= MONTHLY_PQ_MINIMUM_PENCE) {
    const base = isActiveTimedPriorityQueue(donation, now) ? expiryBefore : now;
    return {
      kind: 'thirty_days',
      daysAdded: MONTHLY_PQ_DAYS,
      expiryBefore,
      expiryAfter: addDays(base, MONTHLY_PQ_DAYS),
      unlimitedBefore: false,
      unlimitedAfter: false,
    };
  }

  return {
    kind: 'none',
    daysAdded: 0,
    expiryBefore,
    expiryAfter: expiryBefore,
    unlimitedBefore: false,
    unlimitedAfter: false,
  };
}

function calculateBenefits(donation, amountPence, now = new Date()) {
  const previousTotalPence = poundsToPence(donation?.total || 0);
  const newTotalPence = previousTotalPence + amountPence;
  const rank = getCurrentRank(newTotalPence);
  const cards = getCardsToCredit(donation, newTotalPence).map((rankConfig) => ({
    classname: rankConfig.cardClassname,
    label: rankConfig.cardLabel,
    thresholdPence: rankConfig.thresholdPence,
  }));

  return {
    previousTotalPence,
    newTotalPence,
    rank,
    tokens: tokensForAmountPence(amountPence),
    cards,
    priorityQueue: calculatePriorityQueueBenefit(
      donation,
      previousTotalPence,
      newTotalPence,
      amountPence,
      now
    ),
  };
}

async function createPendingSupportOrder({ guildId, channelId, staffUser, playerUser, playerMember, amount, paymentReference }) {
  const amountPence = poundsToPence(amount);
  if (!Number.isFinite(amountPence) || amountPence <= 0) {
    throw new Error('Support amount must be greater than zero.');
  }

  if (Math.abs(Number(amount) * 100 - amountPence) > 0.0001) {
    throw new Error('Support amount may contain no more than two decimal places.');
  }

  const normalizedReference = normalizePaymentReference(paymentReference);
  if (normalizedReference.length < 3) {
    throw new Error('Payment reference must contain at least three characters.');
  }

  const steamLink = await SteamLink.findOne({ discordId: playerUser.id }).lean();
  if (!steamLink) {
    throw new Error(`${playerUser.username} does not have a linked SteamID64.`);
  }

  const refHash = referenceHash(normalizedReference);
  const existingReference = await SupportOrder.findOne({
    paymentReferenceHash: refHash,
    status: { $nin: ['cancelled', 'needs_correction'] },
  }).lean();

  if (existingReference) {
    throw new Error(`That payment reference is already recorded against order ${existingReference.orderId}.`);
  }

  const donation = await Donation.findOne({ discordId: playerUser.id }).lean();
  const now = new Date();
  const benefits = calculateBenefits(donation, amountPence, now);
  const terms = await captureTermsSnapshot();
  const orderId = createOrderId();
  const expiresAt = new Date(now.getTime() + ORDER_EXPIRY_HOURS * 60 * 60 * 1000);

  const order = await SupportOrder.create({
    orderId,
    status: 'pending_player_confirmation',
    discordId: playerUser.id,
    discordUsernameSnapshot: playerUser.tag || playerUser.username,
    discordGlobalNameSnapshot: playerUser.globalName || undefined,
    discordDisplayNameSnapshot: playerMember?.displayName || undefined,
    steamId64: steamLink.steamId64,
    amountPence,
    currency: CURRENCY,
    paymentReference: String(paymentReference).trim(),
    paymentReferenceNormalized: normalizedReference,
    paymentReferenceHash: refHash,
    createdByStaffId: staffUser.id,
    verifiedByStaffId: staffUser.id,
    verifiedAt: now,
    guildId,
    channelId,
    previousTotalPence: benefits.previousTotalPence,
    expectedNewTotalPence: benefits.newTotalPence,
    expectedRankKey: benefits.rank?.key || undefined,
    expectedRankLabel: benefits.rank?.label || undefined,
    expectedTokens: benefits.tokens,
    expectedRankCards: benefits.cards,
    expectedPriorityQueue: benefits.priorityQueue,
    termsVersion: terms.version,
    termsUrl: terms.url,
    termsHash: terms.hash,
    termsSnapshot: terms.snapshot,
    termsSnapshotSource: terms.source,
    expiresAt,
  });

  await snapshotPlayerIdentity({
    user: playerUser,
    member: playerMember,
    source: 'support_order_created',
  }).catch((error) => console.warn('⚠️ Could not update player name snapshot:', error.message));

  await recordSupportEvent({
    orderId,
    discordId: playerUser.id,
    eventType: 'order_created',
    actorType: 'staff',
    actorDiscordId: staffUser.id,
    occurredAt: now,
    data: {
      amountPence,
      currency: CURRENCY,
      paymentReferenceHash: refHash,
      steamId64: steamLink.steamId64,
      previousTotalPence: benefits.previousTotalPence,
      expectedNewTotalPence: benefits.newTotalPence,
      expectedTokens: benefits.tokens,
      expectedRankCards: benefits.cards,
      expectedPriorityQueue: benefits.priorityQueue,
      termsVersion: terms.version,
      termsHash: terms.hash,
      termsSnapshotSource: terms.source,
    },
  });

  return order;
}


async function cancelSupportOrderAfterPostFailure({ orderId, staffDiscordId, error }) {
  const order = await SupportOrder.findOneAndUpdate(
    { orderId, status: 'pending_player_confirmation' },
    { $set: { status: 'cancelled' } },
    { new: true }
  );

  if (order) {
    await safeRecordSupportEvent({
      orderId,
      discordId: order.discordId,
      eventType: 'confirmation_message_post_failed',
      actorType: 'system',
      actorDiscordId: staffDiscordId,
      data: {
        channelId: order.channelId,
        errorCode: error?.code || error?.rawError?.code || undefined,
        errorMessage: error?.message || String(error || 'Unknown Discord error'),
      },
    });
  }

  return order;
}

async function setConfirmationMessage(orderId, messageId) {
  await SupportOrder.updateOne({ orderId }, { $set: { confirmationMessageId: messageId } });
}

function transactionUnsupported(error) {
  const message = String(error?.message || '');
  return (
    message.includes('Transaction numbers are only allowed') ||
    message.includes('does not support retryable writes') ||
    message.includes('replica set')
  );
}

async function runWithOptionalTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } catch (error) {
    if (!transactionUnsupported(error)) throw error;

    console.warn('⚠️ MongoDB transactions are unavailable. Falling back to idempotent single-document updates.');
    return work(null);
  } finally {
    await session.endSession();
  }
}

function sessionOptions(session) {
  return session ? { session } : {};
}

async function applyCoreFulfilment(orderId) {
  const result = await runWithOptionalTransaction(async (session) => {
    const options = sessionOptions(session);
    const order = await SupportOrder.findOne({ orderId, status: 'finalising' }, null, options);
    if (!order) {
      throw new Error('Support order is not ready for fulfilment.');
    }

    let donation = await Donation.findOne({ discordId: order.discordId }, null, options);
    if (!donation) {
      donation = new Donation({
        discordId: order.discordId,
        total: 0,
        history: [],
      });
    }

    // Idempotency guard for a rare process interruption in non-transaction mode.
    const alreadyApplied = (donation.history || []).some((entry) => entry.orderId === orderId);
    if (alreadyApplied) {
      const totalPence = poundsToPence(donation.total);
      const expectedPq = order.expectedPriorityQueue || { kind: 'none' };
      const shouldSyncPriorityQueue = ['thirty_days', 'one_year', 'lifetime'].includes(expectedPq.kind);
      await SupportOrder.updateOne(
        { orderId },
        {
          $set: {
            status: 'fulfilled',
            fulfilledAt: order.fulfilledAt || new Date(),
            fulfilledTotalPence: totalPence,
            tokensCredited: order.tokensCredited ?? order.expectedTokens,
            rankCardsCredited: order.rankCardsCredited?.length
              ? order.rankCardsCredited
              : order.expectedRankCards,
            priorityQueueBenefit: order.priorityQueueBenefit?.kind
              ? order.priorityQueueBenefit
              : expectedPq,
            roleUpdateStatus: 'pending',
            priorityQueueSyncStatus: shouldSyncPriorityQueue ? 'pending' : 'not_required',
          },
        },
        options
      );
      return {
        order: await SupportOrder.findOne({ orderId }, null, options),
        donation,
        shouldSyncPriorityQueue,
      };
    }

    const currentTotalPence = poundsToPence(donation.total || 0);
    if (currentTotalPence !== order.previousTotalPence) {
      await SupportOrder.updateOne(
        { orderId },
        { $set: { status: 'needs_correction' } },
        options
      );
      await recordSupportEvent(
        {
          orderId,
          discordId: order.discordId,
          eventType: 'order_became_stale',
          actorType: 'system',
          data: {
            expectedPreviousTotalPence: order.previousTotalPence,
            actualPreviousTotalPence: currentTotalPence,
          },
        },
        options
      );
      return {
        stale: true,
        expectedPreviousTotalPence: order.previousTotalPence,
        actualPreviousTotalPence: currentTotalPence,
      };
    }

    const now = new Date();
    const benefits = calculateBenefits(donation, order.amountPence, now);

    donation.total = penceToPounds(benefits.newTotalPence);
    donation.lastDonationAt = now;
    donation.history.push({
      amount: penceToPounds(order.amountPence),
      at: now,
      addedBy: order.createdByStaffId,
      note: 'Confirmed support purchase',
      orderId,
      paymentReference: order.paymentReference,
      termsVersion: order.termsVersion,
      entryType: 'support_purchase',
    });

    donation.unclaimedDonationTokens =
      (donation.unclaimedDonationTokens || 0) + benefits.tokens;

    const existingUnclaimedCards = new Set(donation.unclaimedRankCards || []);
    for (const card of benefits.cards) {
      if (!existingUnclaimedCards.has(card.classname)) {
        donation.unclaimedRankCards.push(card.classname);
        existingUnclaimedCards.add(card.classname);
      }
    }

    if (benefits.priorityQueue.unlimitedAfter) {
      donation.unlimitedPriorityQueue = true;
      donation.pqExpiryNotified = false;
    } else if (benefits.priorityQueue.expiryAfter) {
      donation.pqExpiryAt = benefits.priorityQueue.expiryAfter;
      donation.pqExpiryNotified = false;
    }

    await donation.save(options);

    const pqRequiresSync = ['thirty_days', 'one_year', 'lifetime'].includes(
      benefits.priorityQueue.kind
    );
    const fulfilledAt = new Date();

    await SupportOrder.updateOne(
      { orderId, status: 'finalising' },
      {
        $set: {
          status: 'fulfilled',
          fulfilledAt,
          fulfilledTotalPence: benefits.newTotalPence,
          tokensCredited: benefits.tokens,
          rankCardsCredited: benefits.cards,
          priorityQueueBenefit: benefits.priorityQueue,
          roleUpdateStatus: 'pending',
          priorityQueueSyncStatus: pqRequiresSync ? 'pending' : 'not_required',
        },
      },
      options
    );

    await recordSupportEvent(
      {
        orderId,
        discordId: order.discordId,
        eventType: 'support_fulfilled_core',
        actorType: 'system',
        occurredAt: fulfilledAt,
        data: {
          amountPence: order.amountPence,
          previousTotalPence: benefits.previousTotalPence,
          newTotalPence: benefits.newTotalPence,
          tokensCredited: benefits.tokens,
          rankCardsCredited: benefits.cards,
          priorityQueueBenefit: benefits.priorityQueue,
        },
      },
      options
    );

    if (benefits.tokens > 0) {
      await recordSupportEvent(
        {
          orderId,
          discordId: order.discordId,
          eventType: 'tokens_credited',
          actorType: 'system',
          occurredAt: fulfilledAt,
          data: {
            tokens: benefits.tokens,
            unclaimedBalanceAfter: donation.unclaimedDonationTokens,
          },
        },
        options
      );
    }

    if (benefits.cards.length > 0) {
      await recordSupportEvent(
        {
          orderId,
          discordId: order.discordId,
          eventType: 'rank_cards_credited',
          actorType: 'system',
          occurredAt: fulfilledAt,
          data: { cards: benefits.cards },
        },
        options
      );
    }

    if (benefits.priorityQueue.kind !== 'none') {
      await recordSupportEvent(
        {
          orderId,
          discordId: order.discordId,
          eventType: 'priority_queue_entitlement_updated',
          actorType: 'system',
          occurredAt: fulfilledAt,
          data: benefits.priorityQueue,
        },
        options
      );
    }

    return {
      order: await SupportOrder.findOne({ orderId }, null, options),
      donation,
      shouldSyncPriorityQueue: pqRequiresSync,
    };
  });

  if (result?.stale) {
    const staleError = new Error('The player’s support total changed before confirmation. Staff must create a new order.');
    staleError.code = 'ORDER_STALE';
    throw staleError;
  }

  return result;
}

async function updateDiscordRole(guild, discordId, totalPence) {
  const member = await guild.members.fetch(discordId).catch(() => null);
  if (!member) {
    return { status: 'failed', error: 'Discord member could not be fetched.' };
  }

  const desiredRole = getDiscordRoleForTotal(totalPence);
  const knownRoleIds = RANKS.map((rank) => rank.roleId).filter(Boolean);

  try {
    const rolesToRemove = member.roles.cache.filter(
      (role) => knownRoleIds.includes(role.id) && (!desiredRole || role.id !== desiredRole.roleId)
    );

    if (rolesToRemove.size > 0) {
      await member.roles.remove(rolesToRemove);
    }

    if (desiredRole && !member.roles.cache.has(desiredRole.roleId)) {
      await member.roles.add(desiredRole.roleId);
    }

    return {
      status: desiredRole ? 'succeeded' : 'not_required',
      roleId: desiredRole?.roleId || null,
      rankKey: desiredRole?.key || null,
    };
  } catch (error) {
    return { status: 'failed', error: error.message };
  }
}

async function completeExternalFulfilment(order, guild, shouldSyncPriorityQueue) {
  const roleResult = await updateDiscordRole(guild, order.discordId, order.fulfilledTotalPence);

  let pqResult = { status: 'not_required', outcome: 'not_required' };
  if (shouldSyncPriorityQueue) {
    const syncResult = await addToPriorityQueueDetailed(order.steamId64);

    if (syncResult.status === 'failed') {
      pqResult = {
        status: 'failed',
        outcome: 'failed',
        error: syncResult.error?.message || syncResult.output || 'Unknown CF Tools Priority Queue error.',
      };
    } else {
      pqResult = {
        status: 'succeeded',
        outcome: syncResult.status === 'already_present' ? 'already_present' : 'added',
      };
    }
  }

  const attentionRequired = roleResult.status === 'failed' || pqResult.status === 'failed';
  const finalStatus = attentionRequired ? 'fulfilment_attention_required' : 'fulfilled';

  await SupportOrder.updateOne(
    { orderId: order.orderId },
    {
      $set: {
        status: finalStatus,
        roleUpdateStatus: roleResult.status,
        roleUpdateError: roleResult.error || undefined,
        priorityQueueSyncStatus: pqResult.status,
        priorityQueueSyncOutcome: pqResult.outcome || undefined,
        priorityQueueSyncError: pqResult.error || undefined,
      },
    }
  );

  await safeRecordSupportEvent({
    orderId: order.orderId,
    discordId: order.discordId,
    eventType: roleResult.status === 'failed' ? 'discord_role_update_failed' : 'discord_role_updated',
    actorType: 'system',
    data: roleResult,
  });

  if (shouldSyncPriorityQueue) {
    await safeRecordSupportEvent({
      orderId: order.orderId,
      discordId: order.discordId,
      eventType: pqResult.status === 'failed' ? 'cftools_pq_sync_failed' : 'cftools_pq_sync_succeeded',
      actorType: 'cftools',
      data: pqResult,
    });
  }

  return SupportOrder.findOne({ orderId: order.orderId });
}

async function confirmSupportOrder({ orderId, playerDiscordId, guild }) {
  const now = new Date();
  let order = await SupportOrder.findOneAndUpdate(
    {
      orderId,
      discordId: playerDiscordId,
      status: 'pending_player_confirmation',
      expiresAt: { $gt: now },
    },
    {
      $set: {
        status: 'finalising',
        acceptedAt: now,
        acceptedByDiscordId: playerDiscordId,
        acceptanceText: ACCEPTANCE_TEXT,
      },
    },
    { new: true }
  );

  if (!order) {
    const existing = await SupportOrder.findOne({ orderId });
    if (!existing) {
      const error = new Error('This support order no longer exists.');
      error.code = 'ORDER_NOT_FOUND';
      throw error;
    }
    if (existing.discordId !== playerDiscordId) {
      const error = new Error('Only the named player can confirm this support order.');
      error.code = 'WRONG_PLAYER';
      throw error;
    }
    if (existing.expiresAt <= now && existing.status === 'pending_player_confirmation') {
      await SupportOrder.updateOne({ orderId }, { $set: { status: 'cancelled' } });
      const error = new Error('This support confirmation has expired. Staff must create a new order.');
      error.code = 'ORDER_EXPIRED';
      throw error;
    }
    const error = new Error(`This support order is already ${existing.status.replaceAll('_', ' ')}.`);
    error.code = 'ORDER_ALREADY_HANDLED';
    error.order = existing;
    throw error;
  }

  await recordSupportEvent({
    orderId,
    discordId: playerDiscordId,
    eventType: 'terms_accepted',
    actorType: 'player',
    actorDiscordId: playerDiscordId,
    occurredAt: now,
    data: {
      termsVersion: order.termsVersion,
      termsUrl: order.termsUrl,
      termsHash: order.termsHash,
      acceptanceText: ACCEPTANCE_TEXT,
      paymentReferenceHash: order.paymentReferenceHash,
      amountPence: order.amountPence,
      steamId64: order.steamId64,
    },
  });

  const coreResult = await applyCoreFulfilment(orderId);
  order = await completeExternalFulfilment(
    coreResult.order,
    guild,
    coreResult.shouldSyncPriorityQueue
  );

  return order;
}

async function markSupportOrderNeedsCorrection({ orderId, playerDiscordId }) {
  const now = new Date();
  const order = await SupportOrder.findOneAndUpdate(
    {
      orderId,
      discordId: playerDiscordId,
      status: 'pending_player_confirmation',
    },
    {
      $set: { status: 'needs_correction' },
    },
    { new: true }
  );

  if (!order) {
    const existing = await SupportOrder.findOne({ orderId });
    if (!existing || existing.discordId !== playerDiscordId) {
      throw new Error('Only the named player can flag this support order.');
    }
    throw new Error(`This support order is already ${existing.status.replaceAll('_', ' ')}.`);
  }

  await recordSupportEvent({
    orderId,
    discordId: playerDiscordId,
    eventType: 'player_reported_incorrect_details',
    actorType: 'player',
    actorDiscordId: playerDiscordId,
    occurredAt: now,
    data: {},
  });

  return order;
}


async function retrySupportOrder({ orderId, guild, staffDiscordId }) {
  let order = await SupportOrder.findOne({ orderId });
  if (!order) throw new Error(`Support order ${orderId} was not found.`);

  await safeRecordSupportEvent({
    orderId,
    discordId: order.discordId,
    eventType: 'staff_retry_requested',
    actorType: 'staff',
    actorDiscordId: staffDiscordId,
    data: { statusBefore: order.status },
  });

  if (order.status === 'finalising') {
    const coreResult = await applyCoreFulfilment(orderId);
    return completeExternalFulfilment(
      coreResult.order,
      guild,
      coreResult.shouldSyncPriorityQueue
    );
  }

  if (order.status === 'fulfilment_attention_required') {
    const shouldRetryPq = order.priorityQueueSyncStatus === 'failed';
    return completeExternalFulfilment(order, guild, shouldRetryPq);
  }

  throw new Error(`Order ${orderId} cannot be retried while it is ${order.status.replaceAll('_', ' ')}.`);
}

module.exports = {
  ACCEPTANCE_TEXT,
  createPendingSupportOrder,
  setConfirmationMessage,
  confirmSupportOrder,
  markSupportOrderNeedsCorrection,
  calculateBenefits,
  normalizePaymentReference,
  retrySupportOrder,
  cancelSupportOrderAfterPostFailure,
};
