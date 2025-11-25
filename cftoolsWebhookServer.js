// cftoolsWebhookServer.js
const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const { payOutDonationRewards, payOutVoteRewards } = require('./services/claims');
const { sendServerMessage } = require('./services/cftoolsGameLabs');

const WEBHOOK_SECRET = process.env.CFTOOLS_WEBHOOK_SECRET;

function isValidSignature(req) {
  if (!WEBHOOK_SECRET) return true;

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
    playerName: payload.player_name || null,
  };
}

function startCFToolsWebhookServer() {
  const app = express();
  app.use(bodyParser.json());

  app.post('/cftools/webhook', async (req, res) => {
    const eventType = req.headers['x-hephaistos-event'];
    const deliveryId = req.headers['x-hephaistos-delivery'];

    if (!isValidSignature(req)) {
      console.warn('❌ Invalid CFTools signature');
      return res.status(204).end();
    }

    if (eventType === 'verification') {
      console.log(`✅ Webhook verified (delivery ${deliveryId})`);
      return res.status(204).end();
    }

    if (eventType !== 'user.chat') {
      return res.status(204).end();
    }

    const payload = req.body;
    console.log(`📨 Received CHAT event: ${eventType}`, payload);

    const { steamId64, message, playerName } = extractChatInfo(payload);
    if (!steamId64 || !message) {
      console.log('⚠️ Missing steamId or message in webhook payload.');
      return res.status(204).end();
    }

    const cmd = message.trim().toLowerCase();

    try {
      if (cmd.startsWith('/claimvotes') || cmd.startsWith('!claimvote')) {
        const result = await payOutVoteRewards(steamId64);
        console.log(`🎟 claimvotes result for ${steamId64}:`, result);

        if (result.tokensPaid > 0) {
          await sendServerMessage(
            `${playerName || 'A player'} claimed ${result.tokensPaid} Reward Tokens from their votes!`
          );
        } else {
          await sendServerMessage(
            `${playerName || 'You'} has no unclaimed Reward Tokens at this time.`
          );
        }
      }

      if (cmd.startsWith('/claimdono') || cmd.startsWith('!claimdonation')) {
        const result = await payOutDonationRewards(steamId64);
        console.log(`💰 claimdonation result for ${steamId64}:`, result);

        if (result.tokensPaid > 0) {
          await sendServerMessage(
            `${playerName || 'A player'} claimed ${result.tokensPaid} Hacksaw Tokens from their donations!`
          );
        } else {
          let msg = `${playerName || 'You'} has no unclaimed donation tokens.`;
          if (result.reason === 'no_steam_link') {
            msg = `${playerName || 'You'} does not have a donation account linked to this SteamID.`;
          } else if (result.reason === 'no_donation_record') {
            msg = `${playerName || 'You'} does not have any recorded donations.`;
          }
          await sendServerMessage(msg);
        }
      }
    } catch (err) {
      console.error('❌ Error running in-game claim:', err);
      await sendServerMessage(
        `${playerName || 'A player'} attempted to claim tokens, but an error occurred. Please contact staff if this persists.`
      );
    }

    return res.status(204).end();
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`🌐 CFTools webhook server running on port ${port}`);
  });
}

module.exports = { startCFToolsWebhookServer };
