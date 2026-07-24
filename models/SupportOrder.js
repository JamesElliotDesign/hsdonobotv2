const mongoose = require('mongoose');

const RankCardSchema = new mongoose.Schema(
  {
    classname: { type: String, required: true },
    label: { type: String, required: true },
    thresholdPence: { type: Number, required: true },
  },
  { _id: false }
);

const PriorityQueueBenefitSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ['none', 'thirty_days', 'one_year', 'lifetime', 'already_unlimited'],
      default: 'none',
    },
    daysAdded: { type: Number, default: 0 },
    expiryBefore: { type: Date },
    expiryAfter: { type: Date },
    unlimitedBefore: { type: Boolean, default: false },
    unlimitedAfter: { type: Boolean, default: false },
  },
  { _id: false }
);

const SupportOrderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      required: true,
      enum: [
        'pending_player_confirmation',
        'finalising',
        'fulfilled',
        'fulfilment_attention_required',
        'needs_correction',
        'cancelled',
        'refunded',
        'disputed',
      ],
      default: 'pending_player_confirmation',
      index: true,
    },

    discordId: { type: String, required: true, index: true },
    discordUsernameSnapshot: { type: String, required: true },
    discordGlobalNameSnapshot: { type: String },
    discordDisplayNameSnapshot: { type: String },
    steamId64: { type: String, required: true, index: true },

    amountPence: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, default: 'GBP' },
    paymentReference: { type: String, required: true },
    paymentReferenceNormalized: { type: String, required: true, index: true },
    paymentReferenceHash: { type: String, required: true, index: true },

    createdByStaffId: { type: String, required: true },
    verifiedByStaffId: { type: String, required: true },
    verifiedAt: { type: Date, required: true },

    guildId: { type: String, required: true },
    channelId: { type: String, required: true },
    confirmationMessageId: { type: String },

    previousTotalPence: { type: Number, required: true, min: 0 },
    expectedNewTotalPence: { type: Number, required: true, min: 0 },
    expectedRankKey: { type: String },
    expectedRankLabel: { type: String },
    expectedTokens: { type: Number, required: true, min: 0 },
    expectedRankCards: { type: [RankCardSchema], default: [] },
    expectedPriorityQueue: { type: PriorityQueueBenefitSchema, default: () => ({}) },

    termsVersion: { type: String, required: true },
    termsUrl: { type: String, required: true },
    termsHash: { type: String, required: true },
    termsSnapshot: { type: String, required: true },
    termsSnapshotSource: { type: String, enum: ['website', 'fallback'], required: true },

    acceptedAt: { type: Date },
    acceptedByDiscordId: { type: String },
    acceptanceText: { type: String },

    fulfilledAt: { type: Date },
    fulfilledTotalPence: { type: Number, min: 0 },
    tokensCredited: { type: Number, min: 0 },
    rankCardsCredited: { type: [RankCardSchema], default: [] },
    priorityQueueBenefit: { type: PriorityQueueBenefitSchema, default: () => ({}) },

    roleUpdateStatus: {
      type: String,
      enum: ['not_required', 'pending', 'succeeded', 'failed'],
      default: 'pending',
    },
    roleUpdateError: { type: String },
    priorityQueueSyncStatus: {
      type: String,
      enum: ['not_required', 'pending', 'succeeded', 'failed'],
      default: 'pending',
    },
    priorityQueueSyncError: { type: String },

    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

SupportOrderSchema.index({ discordId: 1, createdAt: -1 });
SupportOrderSchema.index({ paymentReferenceHash: 1, status: 1 });

module.exports = mongoose.model('SupportOrder', SupportOrderSchema);
