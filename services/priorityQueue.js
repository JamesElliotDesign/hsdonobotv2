// services/priorityQueue.js
const path = require('path');
const { execFile } = require('child_process');

const ADD_PQ_SCRIPT = path.join(__dirname, '..', 'add-to-priority-queue.js');
const REMOVE_PQ_SCRIPT = path.join(__dirname, '..', 'remove-from-priority-queue.js');

function combinedProcessOutput(error, stdout, stderr) {
    return [error?.message, stdout, stderr]
        .filter(Boolean)
        .map((value) => String(value).trim())
        .filter(Boolean)
        .join('\n');
}

/**
 * CF Tools treats an attempt to add an existing PQ entry as an error response.
 * For Hacksaw this is an idempotent success: the database controls expiry and
 * the CF Tools entry only needs to exist once.
 */
function isAlreadyPresentPriorityQueueResponse(output) {
    const text = String(output || '').toLowerCase();
    if (!text) return false;

    const explicitPatterns = [
        /already\s+(?:exists|present|added|whitelisted)/i,
        /already\s+in\s+(?:the\s+)?priority\s*queue/i,
        /priority\s*queue[^\n]{0,120}already/i,
        /duplicate[^\n]{0,120}(?:priority|queue|entry|player)/i,
        /(?:priority|queue|entry|player)[^\n]{0,120}duplicate/i,
        /entry[^\n]{0,80}(?:exists|present)/i,
    ];

    if (explicitPatterns.some((pattern) => pattern.test(text))) return true;

    // The CF Tools add-PQ endpoint commonly uses HTTP 409 Conflict when the
    // player already has a permanent entry. In the context of this add action,
    // that is safe to treat as "already present" rather than a failed grant.
    return /(?:status(?:\s*code)?\s*[:=]?\s*409|\b409\b[^\n]{0,80}conflict|conflict[^\n]{0,80}\b409\b)/i.test(text);
}

function makeProcessError(actionLabel, steamId, output, originalError) {
    const summary = output || originalError?.message || `Unknown PQ ${actionLabel} failure.`;
    const error = new Error(summary);
    error.cause = originalError;
    error.action = actionLabel;
    error.steamId = steamId;
    return error;
}

function runPriorityQueueScriptDetailed(scriptPath, steamId, actionLabel) {
    return new Promise((resolve) => {
        execFile('node', [scriptPath, steamId], (error, stdout, stderr) => {
            const output = combinedProcessOutput(error, stdout, stderr);

            if (!error) {
                console.log(`✅ PQ ${actionLabel} script completed for ${steamId}`);
                if (stdout) console.log(stdout.trim());
                if (stderr) console.error(stderr.trim());
                resolve({ status: 'succeeded', output });
                return;
            }

            if (actionLabel === 'add' && isAlreadyPresentPriorityQueueResponse(output)) {
                console.log(`ℹ️ Player ${steamId} is already present in CF Tools Priority Queue; treating the add as successful.`);
                if (output) console.log(output);
                resolve({ status: 'already_present', output });
                return;
            }

            console.error(`❌ Error running PQ ${actionLabel} script for ${steamId}:`);
            if (output) console.error(output);
            resolve({
                status: 'failed',
                output,
                error: makeProcessError(actionLabel, steamId, output, error),
            });
        });
    });
}

async function addToPriorityQueueDetailed(steamId) {
    return runPriorityQueueScriptDetailed(ADD_PQ_SCRIPT, steamId, 'add');
}

/**
 * Backwards-compatible wrapper used by the original commands.
 * Returns null for both newly added and already-present players, and an Error
 * only for genuine failures such as authentication, network, or server errors.
 */
async function addToPriorityQueue(steamId) {
    const result = await addToPriorityQueueDetailed(steamId);
    return result.status === 'failed' ? result.error : null;
}

async function removeFromPriorityQueue(steamId) {
    const result = await runPriorityQueueScriptDetailed(REMOVE_PQ_SCRIPT, steamId, 'remove');
    return result.status === 'failed' ? result.error : null;
}

function isActiveTimedPriorityQueue(donation, now = new Date()) {
    if (!donation || !donation.pqExpiryAt) return false;

    const expiryDate = new Date(donation.pqExpiryAt);
    return expiryDate.getTime() > now.getTime();
}

function hasPriorityQueueAccess(donation, now = new Date()) {
    return Boolean(donation && (donation.unlimitedPriorityQueue || isActiveTimedPriorityQueue(donation, now)));
}

function addYears(date, years) {
    const result = new Date(date);
    result.setFullYear(result.getFullYear() + years);
    return result;
}

module.exports = {
    addToPriorityQueue,
    addToPriorityQueueDetailed,
    removeFromPriorityQueue,
    isAlreadyPresentPriorityQueueResponse,
    isActiveTimedPriorityQueue,
    hasPriorityQueueAccess,
    addYears
};
