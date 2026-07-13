// games/roulette.js
const { randInt } = require('./rng');

const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

function colorOf(n) {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

const PAYOUTS = { red: 2, black: 2, green: 14 };

function play({ bet, choice }) {
  if (!['red', 'black', 'green'].includes(choice)) {
    const err = new Error('choice must be "red", "black", or "green"');
    err.status = 400;
    throw err;
  }
  const landed = randInt(0, 36);
  const color = colorOf(landed);
  const won = color === choice;
  const payout = won ? bet * PAYOUTS[choice] : 0;
  return { won, landed, color, payout, detail: { choice, landed, color } };
}

module.exports = { play, colorOf };
