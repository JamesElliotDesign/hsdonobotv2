// models/SteamLink.js
const mongoose = require('mongoose');

const SteamLinkSchema = new mongoose.Schema(
    {
        discordId: { type: String, required: true, unique: true, index: true },
        steamId64: { type: String, required: true }
    },
    { timestamps: true }
);

module.exports = mongoose.model('SteamLink', SteamLinkSchema);
