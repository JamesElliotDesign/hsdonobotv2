const crypto = require('crypto');
const axios = require('axios');
const {
  SUPPORT_TERMS_URL,
  SUPPORT_TERMS_VERSION,
} = require('../config/supportProgram');

const FALLBACK_SNAPSHOT = [
  `Hacksaw Support Terms version ${SUPPORT_TERMS_VERSION}.`,
  `Published at ${SUPPORT_TERMS_URL}.`,
  'The player confirms that the displayed account, payment and benefit details are correct and agrees to the current Hacksaw Support Terms.',
].join('\n');

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

async function captureTermsSnapshot() {
  try {
    const response = await axios.get(SUPPORT_TERMS_URL, {
      timeout: 5000,
      responseType: 'text',
      maxContentLength: 200 * 1024,
      headers: {
        'User-Agent': 'HacksawSupportBot/2.0',
      },
    });

    const html = String(response.data || '').slice(0, 200 * 1024);
    if (!html.trim()) {
      throw new Error('Support Terms page returned an empty response.');
    }

    return {
      version: SUPPORT_TERMS_VERSION,
      url: SUPPORT_TERMS_URL,
      hash: sha256(html),
      snapshot: html,
      source: 'website',
    };
  } catch (error) {
    console.warn(`⚠️ Could not snapshot Support Terms website; using versioned fallback: ${error.message}`);
    return {
      version: SUPPORT_TERMS_VERSION,
      url: SUPPORT_TERMS_URL,
      hash: sha256(FALLBACK_SNAPSHOT),
      snapshot: FALLBACK_SNAPSHOT,
      source: 'fallback',
    };
  }
}

module.exports = {
  captureTermsSnapshot,
  sha256,
};
