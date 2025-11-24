// services/cftoolsGameLabs.js
const axios = require("axios");
require("dotenv").config();

const API_BASE_URL = "https://data.cftools.cloud/v1";
const APPLICATION_ID = process.env.CFTOOLS_APPLICATION_ID;
const APPLICATION_SECRET =
  process.env.CFTOOLS_SECRET_KEY || process.env.CFTOOLS_APPLICATION_SECRET;
const SERVER_API_ID = process.env.CFTOOLS_SERVER_API_ID;

let authToken = null;
let tokenExpiration = 0;

async function authenticate() {
  if (!APPLICATION_ID || !APPLICATION_SECRET || !SERVER_API_ID) {
    throw new Error(
      "Missing CFTOOLS_APPLICATION_ID / CFTOOLS_SECRET_KEY (or CFTOOLS_APPLICATION_SECRET) / CFTOOLS_SERVER_API_ID in env."
    );
  }

  const response = await axios.post(
    `${API_BASE_URL}/auth/register`,
    {
      application_id: APPLICATION_ID,
      secret: APPLICATION_SECRET,
    },
    {
      headers: { "User-Agent": APPLICATION_ID },
    }
  );

  authToken = response.data.token;
  tokenExpiration = Date.now() + 24 * 60 * 60 * 1000; // 24h

  console.log("✅ [CFTOOLS] Authenticated with CF Tools data API.");
}

async function ensureAuth() {
  if (!authToken || Date.now() >= tokenExpiration) {
    await authenticate();
  }
}

/**
 * Spawn an item on a player's position via GameLabs.
 *
 * @param {string} steam64 - Player's SteamID64
 * @param {string} itemClassname - DayZ classname of item
 * @param {number} quantity - Number of items
 * @param {boolean} stacked - Spawn as stack if supported
 */
async function spawnItemOnPlayer(steam64, itemClassname, quantity, stacked = true) {
  await ensureAuth();

  const payload = {
    actionCode: "CFCloud_SpawnPlayerItem",
    actionContext: "player",
    referenceKey: steam64, // must be Steam64 ID
    parameters: {
      debug: {
        valueBoolean: 0, // no debug spawn
      },
      item: {
        valueString: itemClassname,
      },
      quantity: {
        valueInt: quantity,
      },
      stacked: {
        valueBoolean: stacked ? 1 : 0,
      },
    },
  };

  const response = await axios.post(
    `${API_BASE_URL}/server/${SERVER_API_ID}/GameLabs/action`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${authToken}`,
        "User-Agent": APPLICATION_ID,
      },
    }
  );

  return response.data;
}

/**
 * (Optional) Teleport helper if you need it later
 */
async function teleportPlayer(steam64, [x, y, z]) {
  await ensureAuth();

  const payload = {
    actionCode: "CFCloud_TeleportPlayer",
    actionContext: "player",
    referenceKey: steam64,
    parameters: {
      vector: {
        valueVectorX: x,
        valueVectorY: y,
        valueVectorZ: z,
      },
    },
  };

  const response = await axios.post(
    `${API_BASE_URL}/server/${SERVER_API_ID}/GameLabs/action`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${authToken}`,
        "User-Agent": APPLICATION_ID,
      },
    }
  );

  return response.data;
}

module.exports = {
  spawnItemOnPlayer,
  teleportPlayer,
};
