// games/upgrader.js
const { randFloat } = require('./rng');

// Chance is slightly worse than mathematically fair (chance = 1/mult)
// to give the "house" a small edge, same as every other game here.
// Chance is now continuous (the player drags a handle around a circle
// to set it) rather than a fixed list of multipliers, so we validate a
// range instead of a whitelist.
const HOUSE_EDGE = 0.04;
const MIN_CHANCE = 0.05; // 5%
const MAX_CHANCE = 0.95; // 95%

function multiplierFor(chance) {
  return (1 - HOUSE_EDGE) / chance;
}

function play({ bet, chance }) {
  if (typeof chance !== 'number' || !Number.isFinite(chance) || chance < MIN_CHANCE || chance > MAX_CHANCE) {
    const err = new Error(`chance must be between ${MIN_CHANCE} and ${MAX_CHANCE}`);
    err.status = 400;
    throw err;
  }
  const multiplier = multiplierFor(chance);
  const won = randFloat() < chance;

  // The wheel's green zone spans [0, chance*360) degrees (0 = top,
  // clockwise). We pick a landing angle consistent with `won` so the
  // needle animation always visually matches the real outcome.
  const arcDeg = chance * 360;
  const landingAngle = won ? randFloat() * arcDeg : arcDeg + randFloat() * (360 - arcDeg);

  const payout = won ? bet * multiplier : 0;
  return { won, chance, multiplier, landingAngle, payout, detail: { chance, multiplier, landingAngle } };
}

module.exports = { play, multiplierFor, MIN_CHANCE, MAX_CHANCE, HOUSE_EDGE };
