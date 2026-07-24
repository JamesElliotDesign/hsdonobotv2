const assert = require('assert');
const fs = require('fs');
const path = require('path');
const support = require('../config/supportProgram');
const { createTextPdf } = require('../services/simplePdf');
const { normalizePlayerName } = require('../utils/playerNames');

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
