// cftoolsWebhookServer.js
const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const { payOutVoteRewards, payOutDonationRewards } = require('./services/claims');

const WEBHOOK_SECRET = process.env.CFTOOLS_WEBHOOK_SECRET;

function isValidSignature(req) {
  if (!WEBHOOK_SECRET) return true; // optional strict mode
  
  const deliveryId = req.headers['x-hephaistos-delivery'];
  const receivedSig = req.headers['x-hephaistos-signature'];
  if (!deliveryId || !receivedSig) return false;

  const localSig = crypto
    .createHash('sha256')
    .update(`${deliveryId}${WEBHOOK_SECRET}`)
    .digest('hex');

  return localSig === receivedSig;
}

function extractChatInfo(payload) {
  return {
    message: payload.message || '',
    steamId64: payload.player_steam64 || null,
    playerName: payload.player_name || null
  };
}

function startCFToolsWebhookServer() {
  const app = express();
  app.use(bodyParser.json());

  app.post('/cftools/webhook', async (req, res) => {
    const eventType = req.headers['x-hephaistos-event'];
    const deliveryId = req.headers['x-hephaistos-delivery'];

    // 1️⃣ Validate signature
    if (!isValidSignature(req)) {
      console.warn('❌ Invalid CFTools signature');
      return res.status(204).end();
    }

    // 2️⃣ Handle verification handshake
    if (eventType === 'verification') {
      console.log(`✅ Webhook verified (delivery ${deliveryId})`);
      return res.status(204).end();
    }

    // 3️⃣ FILTER: Only process actual chat events
    if (eventType !== 'user.chat') {
      // Any non-chat event gets ignored
      return res.status(204).end();
    }

    // 4️⃣ Extract chat info from the payload
    const payload = req.body;
    console.log(`📨 Received CHAT event: ${eventType}`, payload);

    const { steamId64, message } = extractChatInfo(payload);
    if (!steamId64 || !message) {
      console.log('⚠️ Missing steamId or message in webhook payload.');
      return res.status(204).end();
    }

    const cmd = message.trim().toLowerCase();

    try {
      // 5️⃣ Run claim commands
      if (cmd.startsWith('/claimvotes')) {
        const result = await payOutVoteRewards(steamId64);
        console.log(`🎟 Vote claim result for ${steamId64}:`, result);
      }

      if (cmd.startsWith('/claimdono')) {
        const result = await payOutDonationRewards(steamId64);
        console.log(`💰 Donation claim result for ${steamId64}:`, result);
      }
    } catch (err) {
      console.error('❌ Error running in-game claim:', err);
    }

    // 6️⃣ REQUIRED BY CFTools — must always respond with 204 + empty body
    return res.status(204).end();
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`🌐 CFTools webhook server running on port ${port}`);
  });
}

module.exports = { startCFToolsWebhookServer };
