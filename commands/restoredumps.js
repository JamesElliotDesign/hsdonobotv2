// commands/restoredumps.js
const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const fetch = require('node-fetch');
const Donation = require('../models/Donation');
const SteamLink = require('../models/SteamLink');

const BACKUP_CHANNEL_ID = '1382491124656111626';

async function downloadJsonFromAttachment(attachment, label) {
    const res = await fetch(attachment.url);
    if (!res.ok) {
        throw new Error(`Failed to download ${label}: HTTP ${res.status}`);
    }
    return res.json();
}

async function importDonations(data) {
    // Support both array format and old object format just in case
    let docs = [];

    if (Array.isArray(data)) {
        docs = data;
    } else if (typeof data === 'object' && data !== null) {
        // old style: { discordId: {total, ...}, ... }
        docs = Object.entries(data).map(([discordId, val]) => ({
            discordId,
            total: val.total || 0,
            lastDonationAt: val.lastDonation ? new Date(val.lastDonation) : undefined
        }));
    }

    for (const doc of docs) {
        if (!doc.discordId) continue;

        await Donation.updateOne(
            { discordId: doc.discordId },
            {
                $set: {
                    total: doc.total || 0,
                    lastDonationAt: doc.lastDonationAt || doc.lastDonation || doc.lastDonationTime || undefined,
                    pqExpiryAt: doc.pqExpiryAt || undefined,
                    unlimitedPriorityQueue: Boolean(doc.unlimitedPriorityQueue),
                    // keep any existing pqExpiryNotified/history if present
                }
            },
            { upsert: true }
        );
    }
}

async function importSteamLinks(data) {
    let docs = [];

    if (Array.isArray(data)) {
        docs = data;
    } else if (typeof data === 'object' && data !== null) {
        // old style: { discordId: steamId, ... }
        docs = Object.entries(data).map(([discordId, steamId64]) => ({
            discordId,
            steamId64
        }));
    }

    for (const doc of docs) {
        if (!doc.discordId || !doc.steamId64) continue;

        await SteamLink.updateOne(
            { discordId: doc.discordId },
            { $set: { steamId64: doc.steamId64 } },
            { upsert: true }
        );
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('restoredumps')
        .setDescription('Restore donation and Steam link data from the latest backup .txt files in the backup channel.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const channel = await interaction.client.channels.fetch(BACKUP_CHANNEL_ID);
            if (!channel || !channel.isTextBased()) {
                return interaction.editReply('❌ Could not access the backup channel.');
            }

            // Fetch recent messages and find the latest one with both dumps
            const messages = await channel.messages.fetch({ limit: 50 });
            let targetMessage = null;

            for (const msg of messages.values()) {
                if (!msg.attachments || msg.attachments.size < 2) continue;

                const attachments = Array.from(msg.attachments.values());
                const hasDonos = attachments.some(a => a.name && a.name.toLowerCase().includes('donations'));
                const hasLinks = attachments.some(a => a.name && a.name.toLowerCase().includes('links'));

                if (hasDonos && hasLinks) {
                    targetMessage = msg;
                    break;
                }
            }

            if (!targetMessage) {
                return interaction.editReply('❌ No suitable backup message with both donation and link dumps was found in the backup channel.');
            }

            const attachments = Array.from(targetMessage.attachments.values());

            const donationsAttachment = attachments.find(a => a.name.toLowerCase().includes('donations'));
            const linksAttachment = attachments.find(a => a.name.toLowerCase().includes('links'));

            if (!donationsAttachment || !linksAttachment) {
                return interaction.editReply('❌ Backup message found but missing one of the required files (donations / links).');
            }

            const [donationsData, linksData] = await Promise.all([
                downloadJsonFromAttachment(donationsAttachment, 'donations'),
                downloadJsonFromAttachment(linksAttachment, 'steamlinks')
            ]);

            await importDonations(donationsData);
            await importSteamLinks(linksData);

            await interaction.editReply('✅ Restore complete. Donation and Steam link data have been imported into MongoDB.');
        } catch (err) {
            console.error('❌ Error restoring dumps:', err);
            await interaction.editReply('❌ An unexpected error occurred during restore. Check logs for details.');
        }
    }
};
