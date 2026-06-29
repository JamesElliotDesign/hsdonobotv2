// models/Vote.js
const mongoose = require('mongoose');

const VoteSchema = new mongoose.Schema(
    {
        provider: {
            type: String,
            required: true,
            default: 'top-games',
            index: true
        },

        // Top-Games doesn’t give us a stable ID right now;
        // keep the field for future, but NO unique index.
        providerVoteId: {
            type: String,
            index: true,
            sparse: true
        },

        steamId64: {
            type: String,
            required: false,
            index: true
        },

        discordId: {
            type: String,
            required: false,
            index: true
        },

        playerName: {
            type: String,
            required: false
        },

        votedAt: {
            type: Date,
            required: true,
            default: Date.now
        },

        // 1 vote = 10 Reward Tokens in your design
        rewardTokens: {
            type: Number,
            required: true,
            default: 10,
            min: 0
        },

        claimed: {
            type: Boolean,
            required: true,
            default: false,
            index: true
        },

        // New hardened claim state:
        // - unclaimed: eligible to be claimed
        // - processing: removed from claimable balance before CFTools is called
        // - claimed: CFTools returned success and the reward is finalized
        claimStatus: {
            type: String,
            enum: ['unclaimed', 'processing', 'claimed'],
            required: true,
            default: 'unclaimed',
            index: true
        },

        claimedAt: {
            type: Date
        },

        claimSource: {
            type: String,
            enum: ['in-game', 'discord', 'admin', null],
            default: null
        },

        claimTxnId: {
            type: String,
            index: true
        },

        claimProcessingStartedAt: {
            type: Date,
            index: true
        },

        // Short-lived command lock used while in-game reward tokens are being spawned.
        // This rejects rapid duplicate commands; claimStatus prevents stale processing
        // rewards from becoming claimable again after the lock expires.
        claimLockUntil: {
            type: Date,
            index: true
        },

        rawResponse: {
            type: mongoose.Schema.Types.Mixed
        }
    },
    {
        timestamps: true
    }
);

// ❌ REMOVE this unique index (was causing E11000 because providerVoteId is always null)
// VoteSchema.index(
//     { provider: 1, providerVoteId: 1 },
//     { unique: true, sparse: true }
// );

// Keep these – they’re useful for queries
VoteSchema.index({ steamId64: 1, claimed: 1 });
VoteSchema.index({ steamId64: 1, claimStatus: 1 });
VoteSchema.index({ steamId64: 1, claimed: 1, claimLockUntil: 1 });
VoteSchema.index({ steamId64: 1, claimStatus: 1, claimProcessingStartedAt: 1 });

module.exports = mongoose.model('Vote', VoteSchema);
