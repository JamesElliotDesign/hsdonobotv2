require("dotenv").config();
const { CFToolsClientBuilder, SteamId64 } = require("cftools-sdk");

(async () => {
  const appId = process.env.CFTOOLS_APPLICATION_ID;
  const secret = process.env.CFTOOLS_SECRET_KEY;
  const serverApiId = process.env.CFTOOLS_SERVER_API_ID;

  // ✅ Get SteamID from command-line argument
  const steamId = process.argv[2];

  if (!appId || !secret || !serverApiId || !steamId) {
    console.error("❌ FATAL: Missing environment variables or SteamID argument!");
    return;
  }

  try {
    const client = await new CFToolsClientBuilder()
      .withCredentials(appId, secret)
      .withServerApiId(serverApiId)
      .build();

    const user = await client.resolve(new SteamId64(steamId));
    console.log("✅ Resolved to CF Tools ID:", user.id);

    await client.deletePriorityQueue(user);
    console.log("✅ Successfully removed from priority queue.");
  } catch (err) {
    console.error("❌ ERROR during removal:");
    console.error(err);
  }
})();
