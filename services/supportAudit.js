const SupportEvent = require('../models/SupportEvent');

async function recordSupportEvent(event, options = {}) {
  const payload = {
    orderId: event.orderId || undefined,
    discordId: event.discordId,
    eventType: event.eventType,
    actorType: event.actorType || 'system',
    actorDiscordId: event.actorDiscordId || undefined,
    occurredAt: event.occurredAt || new Date(),
    data: event.data || {},
  };

  if (options.session) {
    const [created] = await SupportEvent.create([payload], { session: options.session });
    return created;
  }

  return SupportEvent.create(payload);
}

async function safeRecordSupportEvent(event) {
  try {
    return await recordSupportEvent(event);
  } catch (error) {
    // Audit logging must not make a live in-game claim fail. Fulfilment events
    // use recordSupportEvent directly inside the database transaction.
    console.error('⚠️ Failed to append support audit event:', error);
    return null;
  }
}

module.exports = {
  recordSupportEvent,
  safeRecordSupportEvent,
};
