const crypto = require('crypto');
const mongoose = require('mongoose');

function createEventId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
}

const SupportEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true, default: createEventId },
    orderId: { type: String, index: true },
    discordId: { type: String, required: true, index: true },
    eventType: { type: String, required: true, index: true },
    actorType: {
      type: String,
      required: true,
      enum: ['player', 'staff', 'system', 'cftools'],
      default: 'system',
    },
    actorDiscordId: { type: String },
    occurredAt: { type: Date, required: true, default: Date.now, index: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

SupportEventSchema.index({ discordId: 1, occurredAt: 1 });
SupportEventSchema.index({ orderId: 1, occurredAt: 1 });

module.exports = mongoose.model('SupportEvent', SupportEventSchema);
