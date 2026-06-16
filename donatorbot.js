require('dotenv').config();

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  process.exit(1);
});

const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const weeklyBackup = require('./tasks/weeklyBackup');
const pqExpiryCheck = require('./tasks/pqExpiryCheck');
const topGamesVotePoller = require('./tasks/topGamesVotePoller');
const { connectToDatabase } = require('./db');
const { startCFToolsWebhookServer } = require('./cftoolsWebhookServer');


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

    // Poll Top-Games directly for linked SteamID votes every 10 minutes.
    // This replaces relying on Top-Games' Discord webhook as the source of truth.
    cron.schedule('*/10 * * * *', () => {
        topGamesVotePoller(client);
    });
    console.log("📆 Top-Games vote API poller scheduled every 10 minutes.");

    // Run once shortly after startup so votes are picked up without waiting 10 minutes.
    setTimeout(() => {
        topGamesVotePoller(client);
    }, 30 * 1000);

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

// Vote recording now happens via tasks/topGamesVotePoller.js, not by reading the Discord vote channel.

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
