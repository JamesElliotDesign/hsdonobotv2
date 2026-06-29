// models/Donation.js
const mongoose = require('mongoose');

const DonationHistorySchema = new mongoose.Schema(
    {
        amount: { type: Number, required: true },
        at: { type: Date, required: true, default: Date.now },
        addedBy: { type: String }, // Discord ID of staff / bot user, optional
        note: { type: String }
    },
    { _id: false }
);

const DonationSchema = new mongoose.Schema(
    {
        discordId: { type: String, required: true, unique: true, index: true },
        total: { type: Number, required: true, default: 0 },
        lastDonationAt: { type: Date },
        pqExpiryAt: { type: Date },
        pqExpiryNotified: { type: Boolean, default: false },
        unlimitedPriorityQueue: { type: Boolean, required: true, default: false, index: true },

        // Short-lived in-game claim locks. These reject rapid duplicate commands
        // while the original command is still being handled.
        donationClaimLockId: { type: String },
        donationClaimLockUntil: { type: Date, index: true },
        rankClaimLockId: { type: String },
        rankClaimLockUntil: { type: Date, index: true },

        // Recoverable processing/spent states.
        // Tokens/cards are moved here before CFTools is called, so a bot crash
        // after CFTools accepts the spawn cannot expose the same rewards as
        // unclaimed again. Staff can later release or finalize these manually.
        donationClaimProcessingId: { type: String, index: true },
        donationClaimProcessingTokens: { type: Number, required: true, default: 0, min: 0 },
        donationClaimProcessingStartedAt: { type: Date, index: true },
        rankClaimProcessingId: { type: String, index: true },
        rankClaimProcessingCards: { type: [String], default: [] },
        rankClaimProcessingStartedAt: { type: Date, index: true },

        // Hacksaw token balances
        //  - unclaimedDonationTokens: tokens owed but not yet spawned in-game
        //  - claimedDonationTokens: total tokens already paid out
        unclaimedDonationTokens: { type: Number, required: true, default: 0, min: 0 },
        claimedDonationTokens: { type: Number, required: true, default: 0, min: 0 },

        // Rank ID card claim tracking
        //  - unclaimedRankCards: classnames owed but not yet spawned in-game
        //  - claimedRankCards: classnames already claimed/spawned
        unclaimedRankCards: { type: [String], default: [] },
        claimedRankCards: { type: [String], default: [] },

        history: { type: [DonationHistorySchema], default: [] }
    },
    { timestamps: true }
);

DonationSchema.index({ discordId: 1, donationClaimLockUntil: 1 });
DonationSchema.index({ discordId: 1, rankClaimLockUntil: 1 });
DonationSchema.index({ discordId: 1, donationClaimProcessingStartedAt: 1 });
DonationSchema.index({ discordId: 1, rankClaimProcessingStartedAt: 1 });

module.exports = mongoose.model('Donation', DonationSchema);
