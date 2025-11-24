// services/topGames.js
const fetch = require('node-fetch');

const BASE_URL = 'https://api.top-games.net/v1';

function getServerToken() {
    const token = process.env.TOPGAMES_SERVER_TOKEN;
    if (!token) {
        throw new Error('TOPGAMES_SERVER_TOKEN is not set in environment variables.');
    }
    return token;
}

/**
 * Call Top-Games using the SteamID64 as the *username*.
 *
 * Endpoint:
 *   GET /v1/votes/claim-username?server_token=...&playername=...
 *
 * We pass steamId64 as the playername, because that's what you tell
 * players to use on the vote site. This keeps everything bound to
 * their real Steam identity, but matches how Top-Games stores it.
 */
async function claimVotesBySteamId(steamId64) {
    const serverToken = getServerToken();
    const url = `${BASE_URL}/votes/claim-username?server_token=${encodeURIComponent(
        serverToken
    )}&playername=${encodeURIComponent(steamId64)}`;

    const res = await fetch(url, {
        method: 'GET',
        headers: {
            Accept: 'application/json'
        }
    });

    const rawText = await res.text();
    let json;
    try {
        json = JSON.parse(rawText);
    } catch (e) {
        console.error('Top-Games claim-username: failed to parse JSON response:', rawText);
        throw new Error('Top-Games API returned invalid JSON.');
    }

    if (!res.ok) {
        console.error('Top-Games claim-username: non-OK status', res.status, json);
        throw new Error(`Top-Games API error: HTTP ${res.status}`);
    }

    let claimedCode = null;
    if (typeof json.claimed === 'number') {
        claimedCode = json.claimed;
    } else if (json.data && typeof json.data.claimed === 'number') {
        claimedCode = json.data.claimed;
    }

    if (claimedCode === null) {
        console.warn('Top-Games claim-username: no "claimed" code in response:', json);
    }

    return {
        claimedCode,
        raw: json,
        rawText
    };
}

module.exports = {
    claimVotesBySteamId
};
