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

function extractClaimedCode(json) {
    if (!json || typeof json !== 'object') return null;

    if (typeof json.claimed === 'number') {
        return json.claimed;
    }

    if (json.data && typeof json.data.claimed === 'number') {
        return json.data.claimed;
    }

    return null;
}

async function callTopGamesVoteEndpoint(endpoint, params) {
    const serverToken = getServerToken();
    const searchParams = new URLSearchParams({
        server_token: serverToken,
        ...params,
    });

    const url = `${BASE_URL}/votes/${endpoint}?${searchParams.toString()}`;

    const res = await fetch(url, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
        },
    });

    const rawText = await res.text();
    let json;

    try {
        json = JSON.parse(rawText);
    } catch (e) {
        console.error(`Top-Games ${endpoint}: failed to parse JSON response:`, rawText);
        throw new Error('Top-Games API returned invalid JSON.');
    }

    return {
        ok: res.ok,
        status: res.status,
        json,
        rawText,
    };
}

/**
 * Claim a vote from Top-Games using the vote form username/playername.
 *
 * This is the endpoint we need because players type their SteamID64 into
 * the Top-Games "username" box. Top-Games stores that as playername, not as
 * the API steam_id field.
 *
 * Claimed code meanings used by common Top-Games plugins:
 *   0 / 404 = no unclaimed vote found
 *   1       = vote found and now marked claimed by Top-Games
 *   2       = vote was already claimed
 */
async function claimVoteByPlayerName(playerName) {
    const result = await callTopGamesVoteEndpoint('claim-username', {
        playername: playerName,
    });

    // No vote is not an exceptional condition for polling.
    if (result.status === 404) {
        return {
            claimedCode: 0,
            raw: result.json,
            rawText: result.rawText,
            status: result.status,
        };
    }

    if (!result.ok) {
        console.error('Top-Games claim-username: non-OK status', result.status, result.json);
        throw new Error(`Top-Games API error: HTTP ${result.status}`);
    }

    const claimedCode = extractClaimedCode(result.json);

    if (claimedCode === null) {
        console.warn('Top-Games claim-username: no "claimed" code in response:', result.json);
    }

    return {
        claimedCode,
        raw: result.json,
        rawText: result.rawText,
        status: result.status,
    };
}

/**
 * Backwards-compatible wrapper used by the old Discord /claimvote command.
 * Despite the name, this claims by username/playername with the SteamID64 as
 * the typed playername.
 */
async function claimVotesBySteamId(steamId64) {
    return claimVoteByPlayerName(steamId64);
}

module.exports = {
    claimVoteByPlayerName,
    claimVotesBySteamId,
};
