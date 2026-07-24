const zlib = require('zlib');
const mongoose = require('mongoose');
const { AttachmentBuilder } = require('discord.js');
const Donation = require('../models/Donation');
const SteamLink = require('../models/SteamLink');

const MAX_ATTACHMENTS_PER_MESSAGE = 8;

function timestampForFilename(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, '-');
}

function jsonBuffer(value) {
    return Buffer.from(JSON.stringify(value, null, 2), 'utf8');
}

async function sendAttachmentBatches(channel, content, attachments) {
    for (let index = 0; index < attachments.length; index += MAX_ATTACHMENTS_PER_MESSAGE) {
        const batch = attachments.slice(index, index + MAX_ATTACHMENTS_PER_MESSAGE);
        await channel.send({
            content: index === 0 ? content : '📦 **Weekly MongoDB backup — continued**',
            files: batch,
        });
    }
}

module.exports = async function weeklyBackup(client) {
    try {
        const channelId = process.env.BACKUP_CHANNEL_ID;
        if (!channelId) {
            return console.error('❌ BACKUP_CHANNEL_ID is not configured.');
        }

        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) {
            return console.error('❌ Backup channel not found or is not text based.');
        }

        if (!mongoose.connection.db) {
            return console.error('❌ MongoDB is not connected; weekly backup was not created.');
        }

        const now = new Date();
        const stamp = timestampForFilename(now);
        const attachments = [];

        // Keep these two plain JSON files for compatibility with /restoredumps.
        const [donations, steamLinks] = await Promise.all([
            Donation.find().lean(),
            SteamLink.find().lean(),
        ]);

        attachments.push(
            new AttachmentBuilder(jsonBuffer(donations), { name: 'donations_backup.json' }),
            new AttachmentBuilder(jsonBuffer(steamLinks), { name: 'steamlinks_backup.json' })
        );

        // Create a genuine snapshot of every MongoDB collection used by the bot.
        const collections = await mongoose.connection.db.listCollections().toArray();
        const manifest = {
            generatedAt: now.toISOString(),
            database: mongoose.connection.name,
            collections: [],
        };

        for (const collectionInfo of collections) {
            const name = collectionInfo.name;
            const documents = await mongoose.connection.db.collection(name).find({}).toArray();
            const raw = jsonBuffer({ collection: name, generatedAt: now.toISOString(), documents });
            const compressed = zlib.gzipSync(raw, { level: 9 });

            manifest.collections.push({
                name,
                documentCount: documents.length,
                uncompressedBytes: raw.length,
                compressedBytes: compressed.length,
            });

            attachments.push(
                new AttachmentBuilder(compressed, {
                    name: `mongodb-${name}-${stamp}.json.gz`,
                })
            );
        }

        attachments.unshift(
            new AttachmentBuilder(jsonBuffer(manifest), {
                name: `mongodb-backup-manifest-${stamp}.json`,
            })
        );

        await sendAttachmentBatches(
            channel,
            `📦 **Weekly MongoDB backup** — ${now.toISOString()}\n` +
            `Collections: **${manifest.collections.length}** | Donation records: **${donations.length}** | Steam links: **${steamLinks.length}**`,
            attachments
        );

        console.log(`✅ Weekly MongoDB backup sent (${manifest.collections.length} collections).`);
    } catch (error) {
        console.error('❌ Weekly MongoDB backup failed:', error);
    }
};
