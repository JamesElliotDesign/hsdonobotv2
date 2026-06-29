// services/priorityQueue.js
const path = require('path');
const { execFile } = require('child_process');

const ADD_PQ_SCRIPT = path.join(__dirname, '..', 'add-to-priority-queue.js');
const REMOVE_PQ_SCRIPT = path.join(__dirname, '..', 'remove-from-priority-queue.js');

function runPriorityQueueScript(scriptPath, steamId, actionLabel) {
    return new Promise((resolve) => {
        execFile('node', [scriptPath, steamId], (error, stdout, stderr) => {
            if (error) {
                console.error(`❌ Error running PQ ${actionLabel} script for ${steamId}: ${error.message}`);
            } else {
                console.log(`✅ PQ ${actionLabel} script completed for ${steamId}`);
                if (stdout) console.log(stdout);
                if (stderr) console.error(stderr);
            }

            resolve(error || null);
        });
    });
}

function addToPriorityQueue(steamId) {
    return runPriorityQueueScript(ADD_PQ_SCRIPT, steamId, 'add');
}

function removeFromPriorityQueue(steamId) {
    return runPriorityQueueScript(REMOVE_PQ_SCRIPT, steamId, 'remove');
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
    removeFromPriorityQueue,
    isActiveTimedPriorityQueue,
    hasPriorityQueueAccess,
    addYears
};
