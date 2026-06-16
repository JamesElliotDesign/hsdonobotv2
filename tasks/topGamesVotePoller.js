// tasks/topGamesVotePoller.js
const SteamLink = require('../models/SteamLink');
const Vote = require('../models/Vote');
const { claimVoteByPlayerName } = require('../services/topGames');

const DEFAULT_REWARD_TOKENS = 10;
const DEFAULT_DELAY_MS = 750;
const DEFAULT_VOTE_LOG_CHANNEL_ID = '1283142509060427877';

let isRunning = false;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRewardTokensPerVote() {
    const parsed = Number.parseInt(process.env.TOPGAMES_REWARD_TOKENS_PER_VOTE || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REWARD_TOKENS;
}

function getPollDelayMs() {
    const parsed = Number.parseInt(process.env.TOPGAMES_POLL_DELAY_MS || '', 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DELAY_MS;
}

function getVoteLogChannelId() {
    return process.env.TOPGAMES_VOTE_LOG_CHANNEL_ID || DEFAULT_VOTE_LOG_CHANNEL_ID;
}

async function getLinkedPlayerDisplayName(client, link, steamId64) {
    if (!client || !link.discordId) {
        return `SteamID ${steamId64}`;
    }

    try {
        const guild = client.guilds.cache.first();
        if (guild) {
            const member = await guild.members.fetch(link.discordId).catch(() => null);
            if (member?.displayName) {
                return member.displayName;
            }
        }

        const user = await client.users.fetch(link.discordId).catch(() => null);
        if (user?.username) {
            return user.username;
        }
    } catch (err) {
        console.warn(`[TOPGAMES POLLER] Could not resolve Discord display name for ${link.discordId}:`, err.message || err);
    }

    return `SteamID ${steamId64}`;
}

async function sendVoteLog(client, link, steamId64, rewardTokens) {
    const channelId = getVoteLogChannelId();
    if (!channelId || !client) return;

    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) return;

        const displayName = await getLinkedPlayerDisplayName(client, link, steamId64);

        await channel.send({
            content:
                `✅ **${displayName}** just voted for the server! ` +
                `They have been credited **${rewardTokens} Reward Tokens** to claim in-game with \`/claimvote\`.`,
            allowedMentions: { parse: [] },
        });
    } catch (err) {
        console.warn('⚠️ Failed to send Top-Games vote log message:', err.message || err);
    }
}

async function pollTopGamesVotes(client) {
    if (isRunning) {
        console.log('[TOPGAMES POLLER] Previous run still active; skipping this run.');
        return;
    }

    isRunning = true;

    const startedAt = new Date();
    let checked = 0;
    let recorded = 0;
    let failed = 0;

    try {
        const links = await SteamLink.find({}).lean();
        const validLinks = links.filter((link) => /^\d{17}$/.test(String(link.steamId64 || '').trim()));

        console.log(`[TOPGAMES POLLER] Starting. Checking ${validLinks.length} linked SteamID(s).`);

        for (const link of validLinks) {
            const steamId64 = String(link.steamId64).trim();
            checked += 1;

            try {
                // Players must vote using their exact SteamID64 as the Top-Games username/playername.
                const result = await claimVoteByPlayerName(steamId64);

                if (result.claimedCode === 1) {
                    const rewardTokens = getRewardTokensPerVote();

                    const voteDoc = new Vote({
                        provider: 'top-games',
                        providerVoteId: `top-games-api:${steamId64}:${Date.now()}`,
                        steamId64,
                        discordId: link.discordId || null,
                        playerName: steamId64,
                        votedAt: new Date(),
                        rewardTokens,
                        claimed: false,
                        claimSource: null,
                        rawResponse: {
                            source: 'top-games-api-poller',
                            playername: steamId64,
                            topGamesStatus: result.status,
                            topGamesResponse: result.raw,
                        },
                    });

                    await voteDoc.save();
                    recorded += 1;

                    console.log(`[TOPGAMES POLLER] Recorded vote for ${steamId64} (+${rewardTokens} tokens).`);
                    await sendVoteLog(client, link, steamId64, rewardTokens);
                } else if (result.claimedCode === 0 || result.claimedCode === 2 || result.claimedCode === null) {
                    // Normal no-op states: no vote, already claimed, or no claimed code.
                } else {
                    console.warn(`[TOPGAMES POLLER] Unknown claimedCode for ${steamId64}:`, result.claimedCode, result.raw);
                }
            } catch (err) {
                failed += 1;
                console.error(`[TOPGAMES POLLER] Failed while checking ${steamId64}:`, err.message || err);
            }

            const delayMs = getPollDelayMs();
            if (delayMs > 0) {
                await sleep(delayMs);
            }
        }

        const durationSeconds = Math.round((Date.now() - startedAt.getTime()) / 1000);
        console.log(
            `[TOPGAMES POLLER] Finished. checked=${checked}, recorded=${recorded}, failed=${failed}, duration=${durationSeconds}s.`
        );
    } finally {
        isRunning = false;
    }
}

module.exports = pollTopGamesVotes;
