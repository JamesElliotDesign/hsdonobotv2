const mongoose = require('mongoose');

const PlayerProfileSchema = new mongoose.Schema(
  {
    discordId: { type: String, required: true, unique: true, index: true },
    usernameSnapshot: { type: String },
    globalNameSnapshot: { type: String },
    displayNameSnapshot: { type: String },
    aliases: { type: [String], default: [] },
    aliasesNormalized: { type: [String], default: [] },
    lastSeenAt: { type: Date, required: true, default: Date.now, index: true },
    lastSource: { type: String },
  },
  { timestamps: true }
);

PlayerProfileSchema.index({ aliasesNormalized: 1, lastSeenAt: -1 });

module.exports = mongoose.model('PlayerProfile', PlayerProfileSchema);
