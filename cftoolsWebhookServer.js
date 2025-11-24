// cftoolsWebhookServer.js
const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const { payOutVoteRewards, payOutDonationRewards } = require('./services/claims');

// Shared secret you configured in the CF Tools integration
const WEBHOOK_SECRET = process.env.CFTOOLS_WEBHOOK_SECRET;

// Verify Hephaistos signature: sha256(delivery_uuid + secret)
function isValidSignature(req) {
  if (!WEBHOOK_SECRET) {
    console.warn('⚠️ CFTOOLS_WEBHOOK_SECRET is not set; skipping signature validation.');
    return true; // or false if you want to enforce it strictly
  }

  const deliveryId = req.headers['x-hephaistos-delivery'];
  const receivedSig = req.headers['x-hephaistos-signature'];

  if (!deliveryId || !receivedSig) {
    console.warn('⚠️ Missing delivery/signature headers on CFTools webhook.');
    return false;
  }

  const localSig = crypto
    .createHash('sha256')
    .update(`${deliveryId}${WEBHOOK_SECRET}`)
    .digest('hex');

  if (localSig !== receivedSig) {
    console.warn(`❌ Signature mismatch for delivery ${deliveryId}`);
    return false;
  }

  return true;
}

function extractChatInfo(payload) {
  // We’ll log the payload the first few times so you can tighten this later.
  // These are just common patterns; we’ll adapt once we see the real shape.
  const message =
    payload.message ||
    payload.msg ||
    payload.data?.message ||
    payload.data?.msg ||
    '';

  const steamId64 =
    payload.steam64 ||
    payload.player_steamid ||
    payload.playerSteam64 ||
    payload.data?.steam64 ||
    payload.data?.player?.steam64 ||
    payload.player?.steam64 ||
    null;

  return { steamId64, message };
}

function startCFToolsWebhookServer() {
  const app = express();
  app.use(bodyParser.json());

  // Main webhook endpoint – match this path in CF Tools (CFTOOLS_WEBHOOK_URL)
  app.post('/cftools/webhook', async (req, res) => {
    const eventType = req.headers['x-hephaistos-event'];
    const deliveryId = req.headers['x-hephaistos-delivery'];

    // 1) Signature validation
    if (!isValidSignature(req)) {
      // We still return 204 so Hephaistos doesn’t immediately kill the webhook,
      // but we ignore the event.
      return res.status(204).end();
    }

    // 2) Handle verification ping
    if (eventType === 'verification') {
      console.log(`✅ CFTools webhook verification received (delivery ${deliveryId}).`);
      return res.status(204).end();
    }

    const payload = req.body;
    console.log(`📨 CFTools webhook event: ${eventType} (delivery ${deliveryId})`);
    // Log payload once you’re live to see actual structure
    console.dir(payload, { depth: null });

    try {
      // You’ll see the exact eventType for chat in your logs.
      // Common flavors are things like "gamelabs.chat.message" or similar.
      // For now, we’ll run our logic for all events and just guard on having a message + steamId.
      const { steamId64, message } = extractChatInfo(payload);

      if (steamId64 && message) {
        const lower = message.trim().toLowerCase();

        if (lower.startsWith('!claimvote')) {
          const result = await payOutVoteRewards(steamId64);
          console.log(`🎟 !claimvote from ${steamId64}:`, result);
        } else if (lower.startsWith('!claimdonation')) {
          const result = await payOutDonationRewards(steamId64);
          console.log(`💰 !claimdonation from ${steamId64}:`, result);
        }
      }
    } catch (err) {
      console.error('❌ Error handling CFTools webhook event:', err);
      // Still return 204 so we don't break the webhook
    }

    // Hephaistos expects 204 + empty body for successful processing
    return res.status(204).end();
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`🌐 CFTools webhook server listening on port ${port}`);
  });
}

module.exports = { startCFToolsWebhookServer };
