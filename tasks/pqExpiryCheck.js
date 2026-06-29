// tasks/pqExpiryCheck.js
const Donation = require('../models/Donation');
const SteamLink = require('../models/SteamLink');
const { removeFromPriorityQueue } = require('../services/priorityQueue');

const EXPIRED_CHANNEL_ID = '1400136473281429534'; // #expired-pq

module.exports = async function pqExpiryCheck(client) {
    const now = new Date();

    // Fetch all users whose timed PQ has expired, excluding unlimited PQ users.
    const expiredDonations = await Donation.find({
        pqExpiryAt: { $lte: now },
        unlimitedPriorityQueue: { $ne: true }
    }).lean(); // we’ll update by id later

    if (!expiredDonations.length) {
        console.log('✅ PQ Expiry Sweep complete. No expired users.');
        return;
    }

    const channel = await client.channels.fetch(EXPIRED_CHANNEL_ID).catch(() => null);
    if (!channel) {
        console.warn('❌ PQ Expiry Check: Failed to fetch expired-pq channel.');
    }

    let removedCount = 0;
    let skippedUnlimitedCount = 0;

    for (const donation of expiredDonations) {
        const { discordId, pqExpiryNotified } = donation;

        // Safety guard in case an old query result or concurrent update grants unlimited PQ mid-sweep.
        if (donation.unlimitedPriorityQueue) {
            skippedUnlimitedCount++;
            continue;
        }

        // Find linked SteamID
        const link = await SteamLink.findOne({ discordId }).lean();
        if (!link) {
            console.warn(`⚠️ PQ expired but no SteamID linked for Discord user ${discordId}`);
            // We still want to mark them as notified so we don't spam logs
            await Donation.updateOne(
                { _id: donation._id },
                { $set: { pqExpiryNotified: true } }
            );
            continue;
        }

        const steamId = link.steamId64;

        // Remove from CF Tools priority queue
        await removeFromPriorityQueue(steamId);

        // Only send the Discord reminder once per expiry
        if (!pqExpiryNotified && channel) {
            const userMention = `<@${discordId}>`;
            await channel.send(
                `⏰ ${userMention} your **Priority Queue** access has expired and you have been removed from the queue.`
            );
        }

        // Mark as notified so we don't spam on next runs
        await Donation.updateOne(
            { _id: donation._id },
            { $set: { pqExpiryNotified: true } }
        );

        removedCount++;
    }

    console.log(`🔁 PQ Expiry Sweep complete. Removed ${removedCount} users. Skipped ${skippedUnlimitedCount} unlimited PQ users.`);
};
