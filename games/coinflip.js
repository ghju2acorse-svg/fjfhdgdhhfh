// games/coinflip.js
const { randFloat } = require('./rng');

const WIN_CHANCE = 0.49; // slight house edge instead of a flat 50/50
const PAYOUT_MULT = 2;

function play({ bet, choice }) {
  if (choice !== 'heads' && choice !== 'tails') {
    const err = new Error('choice must be "heads" or "tails"');
    err.status = 400;
    throw err;
  }
  const won = randFloat() < WIN_CHANCE;
  const result = won ? choice : (choice === 'heads' ? 'tails' : 'heads');
  const payout = won ? bet * PAYOUT_MULT : 0;
  return { won, result, payout, detail: { choice, result } };
}

module.exports = { play };
