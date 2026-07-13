// games/casebattles.js
const { weightedPick } = require('./rng');

// Reward multipliers and their weights. Expected value is kept under 1
// so the house holds a consistent edge across many rounds.
const TABLE = [
  { value: 0.10, weight: 30 },
  { value: 0.25, weight: 25 },
  { value: 0.50, weight: 20 },
  { value: 1.00, weight: 14 },
  { value: 2.00, weight: 7 },
  { value: 5.00, weight: 3 },
  { value: 10.00, weight: 1 },
];

function play({ bet }) {
  const multiplier = weightedPick(TABLE);
  const payout = bet * multiplier;
  return { multiplier, payout, detail: { multiplier, table: TABLE.map(t => t.value) } };
}

module.exports = { play, TABLE };
