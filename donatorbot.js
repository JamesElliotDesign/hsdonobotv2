require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const weeklyBackup = require('./tasks/weeklyBackup');
const pqExpiryCheck = require('./tasks/pqExpiryCheck');
const { connectToDatabase } = require('./db');
const { startCFToolsWebhookServer } = require('./cftoolsWebhookServer');
const Vote = require('./models/Vote');
const VOTES_CHANNEL_ID = '1283142509060427877';


const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
    console.error("❌ BOT_TOKEN is missing! Make sure it's in your .env file.");
    process.exit(1);
}

client.commands = new Map();

client.once('ready', async () => {
    console.log(`${client.user.tag} is online!`);

    const guild = client.guilds.cache.first(); // Replace with your guild ID if needed

    const commandsPath = path.join(__dirname, 'commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    // Every Monday at 12:00 PM server time
    cron.schedule('0 12 * * 1', () => {
        weeklyBackup(client);
    });

    // Every day at 12:30 PM server time
    cron.schedule('30 12 * * *', () => {
        pqExpiryCheck(client);
    });
    console.log("📆 Daily PQ expiry check cron job scheduled.");

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
            await guild.commands.create(command.data);
        } else {
            console.warn(`[WARNING] The command at ${filePath} is missing "data" or "execute".`);
        }
    }

    console.log("✅ Commands registered.");
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) {
        return interaction.reply({ content: '❌ Command not found.', ephemeral: true });
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: '⚠️ There was an error executing that command.', ephemeral: true });
    }
});

client.on('messageCreate', async (message) => {
  try {
    // Only care about the votes channel
    if (message.channelId !== VOTES_CHANNEL_ID) return;

    // Ignore non-bot senders if that channel is read-only anyway.
    // If your votes come from a webhook / bot, this is safe:
    if (!message.author.bot) return;

    const content = (message.content || '').trim();
    // Expected format: "7656119... just voted for your server!"
    const match = content.match(/^(.+?) just voted for your server!?$/i);
    if (!match) return;

    const username = match[1].trim();

    // We require players to use SteamID64 as username
    const steamId64 = /^\d{17}$/.test(username) ? username : null;
    if (!steamId64) {
      console.log(
        `[VOTE] Ignoring vote with non-Steam username "${username}" (content="${content}")`
      );
      return;
    }

    // Use the Discord message ID as providerVoteId to avoid duplicates
    const providerVoteId = message.id;

    // Optional: defensive de-duplication if the bot ever restarts and reprocesses somehow
    const existing = await Vote.findOne({
      provider: 'top-games',
      providerVoteId,
    });
    if (existing) {
      console.log(
        `[VOTE] Duplicate vote message ignored for ${steamId64}, providerVoteId=${providerVoteId}`
      );
      return;
    }

    const voteDoc = new Vote({
      provider: 'top-games',
      providerVoteId,
      steamId64,
      discordId: null,
      playerName: username,
      votedAt: message.createdAt || new Date(),
      rewardTokens: 10,
      claimed: false,
      claimSource: null,
      rawResponse: { discordMessageId: message.id },
    });

    await voteDoc.save();
    console.log(
      `[VOTE] Recorded vote for SteamID ${steamId64} (+${voteDoc.rewardTokens} tokens)`
    );
  } catch (err) {
    console.error('❌ Error processing vote webhook message:', err);
  }
});

(async () => {
  try {
    await connectToDatabase();

    // Start the CFTools webhook HTTP server
    startCFToolsWebhookServer();

    await client.login(TOKEN);
    console.log('🤖 Donator bot logged in.');
  } catch (err) {
    console.error('❌ Failed to start bot:', err);
    process.exit(1);
  }
})();
