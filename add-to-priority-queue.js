require("dotenv").config();
const { CFToolsClientBuilder, SteamId64 } = require("cftools-sdk");

(async () => {
  const appId = process.env.CFTOOLS_APPLICATION_ID;
  const secret = process.env.CFTOOLS_SECRET_KEY;
  const serverApiId = process.env.CFTOOLS_SERVER_API_ID;

  // ✅ Grab the SteamID passed as a command-line argument
  const steamId = process.argv[2];

  if (!appId || !secret || !serverApiId || !steamId) {
    console.error("FATAL: Missing required inputs (env vars or SteamID).");
    return;
  }

  try {
    const client = await new CFToolsClientBuilder()
      .withCredentials(appId, secret)
      .withServerApiId(serverApiId)
      .build();

    const user = await client.resolve(new SteamId64(steamId));
    console.log("✅ Resolved to CFTools ID:", user.id);

    const request = {
      id: user,
      playerId: user.id,
      comment: "DonatorBot Auto Grant"
    };

    await client.putPriorityQueue(request);
    console.log("✅ SUCCESS! Priority queue granted.");
  } catch (err) {
    console.error("❌ ERROR:");
    console.error(err);
  }
})();
