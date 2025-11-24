// models/Vote.js
const mongoose = require('mongoose');

const VoteSchema = new mongoose.Schema(
    {
        // Where this vote came from – future-proof in case you add more sites later
        provider: {
            type: String,
            required: true,
            default: 'top-games',
            index: true
        },

        // If Top-Games ever gives you a unique vote ID, store it here to prevent dupes
        providerVoteId: {
            type: String,
            index: true,
            sparse: true
        },

        // Core player identity
        steamId64: {
            type: String,
            required: false,
            index: true
        },

        // Optional – if we can resolve Discord via your SteamLink table
        discordId: {
            type: String,
            required: false,
            index: true
        },

        // Name Top-Games knows them by (can change over time, so just for display)
        playerName: {
            type: String,
            required: false
        },

        // When the vote was cast / claimed from Top-Games
        votedAt: {
            type: Date,
            required: true,
            default: Date.now
        },

        // How many in-game "Reward_Tokens" this vote is worth
        rewardTokens: {
            type: Number,
            required: true,
            default: 1,
            min: 0
        },

        // Has this vote been turned into in-game tokens yet?
        claimed: {
            type: Boolean,
            required: true,
            default: false,
            index: true
        },

        claimedAt: {
            type: Date
        },

        // Where the claim came from: in-game chat, Discord command, or manual admin
        claimSource: {
            type: String,
            enum: ['in-game', 'discord', 'admin', null],
            default: null
        },

        // Optional: some audit ID you attach when you spawn items (e.g. DayZ log ID)
        claimTxnId: {
            type: String
        },

        // Debug / audit: raw Top-Games response we used to create this record
        rawResponse: {
            type: mongoose.Schema.Types.Mixed
        }
    },
    {
        timestamps: true // adds createdAt / updatedAt
    }
);

// Prevent duplicate inserts if the API ever gives stable IDs
VoteSchema.index(
    { provider: 1, providerVoteId: 1 },
    { unique: true, sparse: true }
);

// Handy compound index for "all unclaimed votes for this steamId"
VoteSchema.index({ steamId64: 1, claimed: 1 });

module.exports = mongoose.model('Vote', VoteSchema);
