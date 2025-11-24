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

        // 💰 Hacksaw token balances
        //  - unclaimedDonationTokens: tokens owed but not yet spawned in-game
        //  - claimedDonationTokens: total tokens already paid out
        unclaimedDonationTokens: { type: Number, required: true, default: 0 },
        claimedDonationTokens: { type: Number, required: true, default: 0 },

        history: { type: [DonationHistorySchema], default: [] }
    },
    { timestamps: true }
);

module.exports = mongoose.model('Donation', DonationSchema);
