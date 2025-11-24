// tasks/weeklyBackup.js
const fs = require('fs');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');

const DONATIONS_FILE = path.join(__dirname, '..', 'donations.json');
const STEAMLINKS_FILE = path.join(__dirname, '..', 'steamlinks.json');

module.exports = async function weeklyBackup(client) {
    const channelId = process.env.BACKUP_CHANNEL_ID;
    const channel = await client.channels.fetch(channelId);
    if (!channel) return console.error("❌ Backup channel not found.");

    const donationsTxt = fs.existsSync(DONATIONS_FILE)
        ? fs.readFileSync(DONATIONS_FILE, 'utf8')
        : 'No donation data.';

    const steamLinksTxt = fs.existsSync(STEAMLINKS_FILE)
        ? fs.readFileSync(STEAMLINKS_FILE, 'utf8')
        : 'No steam link data.';

    const donationsAttachment = new AttachmentBuilder(Buffer.from(donationsTxt), { name: 'donations_backup.txt' });
    const linksAttachment = new AttachmentBuilder(Buffer.from(steamLinksTxt), { name: 'steamlinks_backup.txt' });

    await channel.send({
        content: `📦 **Weekly backup** from ${new Date().toLocaleDateString()}`,
        files: [donationsAttachment, linksAttachment]
    });

    console.log("✅ Weekly backup sent.");
};
