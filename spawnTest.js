// spawnPlayerItemTest.js
const axios = require("axios");
require("dotenv").config();

const API_BASE_URL = "https://data.cftools.cloud/v1";
const APPLICATION_ID = process.env.CFTOOLS_APPLICATION_ID;

// 👇 Use the same secret var you used in listGameLabsActions
// (that script used CFTOOLS_SECRET_KEY)
const APPLICATION_SECRET =
  process.env.CFTOOLS_SECRET_KEY || process.env.CFTOOLS_APPLICATION_SECRET;

const SERVER_API_ID = process.env.CFTOOLS_SERVER_API_ID;

// 🔑 Your Steam64 here, or via env
const TEST_PLAYER_STEAM_ID =
  process.env.TEST_PLAYER_STEAM_ID || "7656XXXXXXXXXXXXX";

let authToken = null;
let tokenExpiration = 0;

async function authenticate() {
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

  console.log("✅ Authenticated with CF Tools!");
}

async function spawnItemOnPlayerBySteam64(steam64, itemClassname, quantity, stacked) {
  try {
    if (!authToken || Date.now() >= tokenExpiration) await authenticate();

    const response = await axios.post(
      `${API_BASE_URL}/server/${SERVER_API_ID}/GameLabs/action`,
      {
        actionCode: "CFCloud_SpawnPlayerItem",
        actionContext: "player",
        referenceKey: steam64, // Must be the player's Steam64 ID
        parameters: {
          debug: {
            // we don't want debug spawn
            valueBoolean: 0,
          },
          item: {
            // class name of the item to spawn
            valueString: itemClassname,
          },
          quantity: {
            // how many items
            valueInt: quantity,
          },
          stacked: {
            // spawn as a stack if item supports it
            valueBoolean: stacked ? 1 : 0,
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          "User-Agent": APPLICATION_ID,
        },
      }
    );

    console.log("✅ Spawn request OK!", response.data);
  } catch (err) {
    if (err.response) {
      console.error("❌ Error response:", err.response.status, err.response.data);
    } else {
      console.error("❌ Request error:", err);
    }
  }
}

(async () => {
  if (!APPLICATION_ID || !APPLICATION_SECRET || !SERVER_API_ID) {
    console.error(
      "❌ Missing CFTOOLS_APPLICATION_ID / CFTOOLS_SECRET_KEY (or CFTOOLS_APPLICATION_SECRET) / CFTOOLS_SERVER_API_ID in .env"
    );
    process.exit(1);
  }

  if (!TEST_PLAYER_STEAM_ID || TEST_PLAYER_STEAM_ID === "7656XXXXXXXXXXXXX") {
    console.error("❌ Set TEST_PLAYER_STEAM_ID in .env or edit spawnPlayerItemTest.js with your SteamID64.");
    process.exit(1);
  }

  const steam64 = TEST_PLAYER_STEAM_ID;
  const itemClassname = "TraderPlus_Coin"; // Reward token classname
  const quantity = 10;
  const stacked = true;

  console.log(
    `🎮 Spawning ${quantity}x ${itemClassname} (stacked=${stacked}) on player ${steam64}...`
  );
  await spawnItemOnPlayerBySteam64(steam64, itemClassname, quantity, stacked);
})();
