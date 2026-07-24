const assert = require('assert');
const fs = require('fs');
const path = require('path');
const support = require('../config/supportProgram');
const { createTextPdf, sanitizePdfText } = require('../services/simplePdf');
const {
  describePriorityQueue,
  formatReceiptMoney,
  priorityQueueReceiptDescription,
} = require('../services/supportText');
const { normalizePlayerName } = require('../utils/playerNames');
const { isAlreadyPresentPriorityQueueResponse } = require('../services/priorityQueue');

assert.strictEqual(support.poundsToPence(20), 2000);
assert.strictEqual(support.tokensForAmountPence(2000), 2000);
assert.strictEqual(support.getCurrentRank(1999), null);
assert.strictEqual(support.getCurrentRank(2000).key, 'AMETHYST');
assert.strictEqual(support.getCurrentRank(5000).key, 'JADE');
assert.strictEqual(support.getCurrentRank(200000).key, 'DIAMOND');
assert.strictEqual(support.getCurrentRank(200000).roleId, '1359232541965422662');
assert.strictEqual(normalizePlayerName('  @Matess 912  '), 'matess 912');
assert.deepStrictEqual(
  support.getCrossedRanks(4000, 11000).map((rank) => rank.key),
  ['JADE', 'AMBER']
);

assert.strictEqual(
  describePriorityQueue({ kind: 'thirty_days' }, 'pending'),
  '30 days of Priority Queue will be added'
);
assert.strictEqual(
  describePriorityQueue({ kind: 'already_unlimited' }, 'pending'),
  'Lifetime Priority Queue is already active'
);
assert.strictEqual(
  describePriorityQueue({ kind: 'none' }, 'pending'),
  'No Priority Queue included for an individual purchase below £20'
);

assert.strictEqual(isAlreadyPresentPriorityQueueResponse('Request failed with status code 409'), true);
assert.strictEqual(isAlreadyPresentPriorityQueueResponse('Player already exists in priority queue'), true);
assert.strictEqual(isAlreadyPresentPriorityQueueResponse('Duplicate priority queue entry'), true);
assert.strictEqual(isAlreadyPresentPriorityQueueResponse('Request failed with status code 401'), false);
assert.strictEqual(isAlreadyPresentPriorityQueueResponse('connect ETIMEDOUT'), false);
assert.strictEqual(formatReceiptMoney(2000), 'GBP 20.00');
assert.strictEqual(priorityQueueReceiptDescription({ kind: 'already_unlimited' }), 'Lifetime Priority Queue was already active');
assert.strictEqual(sanitizePdfText("£20 – player's"), "GBP 20 - player's");
assert.deepStrictEqual(
  support.getCardsToCredit(
    { unclaimedRankCards: ['HS_RANKIDAMETHYST'], claimedRankCards: [] },
    5000
  ).map((rank) => rank.key),
  ['JADE']
);

const pdf = createTextPdf(['Support receipt test', 'Order HS-TEST']);
assert.ok(pdf.subarray(0, 8).toString('ascii').startsWith('%PDF-1.4'));
const tempPath = path.join(__dirname, '.support-receipt-test.pdf');
fs.writeFileSync(tempPath, pdf);
fs.unlinkSync(tempPath);

console.log('Support programme tests passed.');
