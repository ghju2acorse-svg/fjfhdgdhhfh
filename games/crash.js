// games/crash.js
const { randFloat } = require('./rng');

const HOUSE_EDGE = 0.03;
const GROWTH_PER_SEC = 0.09; // multiplier grows roughly e^(GROWTH_PER_SEC * t)

/**
 * Standard crash-game distribution: crash point is drawn so that the
 * probability of surviving past multiplier M is proportional to 1/M,
 * which gives the house a fixed edge no matter when players cash out.
 */
function generateCrashPoint() {
  const r = Math.max(randFloat(), 1e-9);
  const raw = (1 - HOUSE_EDGE) / r;
  return Math.max(1.0, Math.round(raw * 100) / 100);
}

function multiplierAtElapsedMs(elapsedMs) {
  const t = elapsedMs / 1000;
  return Math.max(1, Math.round(Math.exp(GROWTH_PER_SEC * t) * 100) / 100);
}

module.exports = { generateCrashPoint, multiplierAtElapsedMs };
