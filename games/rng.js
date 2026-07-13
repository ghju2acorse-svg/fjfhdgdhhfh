// games/rng.js
// Central RNG. Uses Node's crypto module (CSPRNG) rather than Math.random.
//
// Note on "provably fair": a full commit-reveal scheme (server publishes
// a hashed seed before the round, reveals the seed after so the result
// can be independently verified) is the industry-standard next step and
// would slot in here — generate the seed, hash it into the round record,
// return the hash pre-round and the seed post-round. It's not
// implemented in this demo to keep the scope manageable, but the RNG
// call sites below are exactly where it would go.

const crypto = require('crypto');

/** Random integer in [min, max] inclusive. */
function randInt(min, max) {
  return min + crypto.randomInt(max - min + 1);
}

/** Random float in [0, 1). */
function randFloat() {
  return crypto.randomInt(0, 1_000_000) / 1_000_000;
}

/** Weighted pick from [{ value, weight }, ...]. */
function weightedPick(entries) {
  const total = entries.reduce((s, e) => s + e.weight, 0);
  let r = randFloat() * total;
  for (const e of entries) {
    if (r < e.weight) return e.value;
    r -= e.weight;
  }
  return entries[entries.length - 1].value;
}

/** Fisher-Yates shuffle of [0, n). */
function shuffledIndices(n) {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = { randInt, randFloat, weightedPick, shuffledIndices };
