// wallet.js
// All balance mutation goes through here. No other file should touch
// users.demo_balance directly. There is deliberately no deposit() or
// withdraw() function — this wallet only ever moves play-money between
// "user balance" and "a game round's payout".

const { db, addXp } = require('./db');

class InsufficientFundsError extends Error {
  constructor() {
    super('Insufficient balance');
    this.status = 400;
  }
}
class InvalidBetError extends Error {
  constructor(msg) {
    super(msg || 'Invalid bet');
    this.status = 400;
  }
}

function getUserById(id) {
  return db
    .prepare('SELECT id, username, demo_balance, xp, level, roblox_user_id, roblox_username FROM users WHERE id = ?')
    .get(id);
}

function validateBet(bet, balance) {
  if (typeof bet !== 'number' || !Number.isFinite(bet) || bet <= 0) {
    throw new InvalidBetError('Bet must be a positive number');
  }
  if (bet > 1_000_000) throw new InvalidBetError('Bet is too large');
  if (bet > balance) throw new InsufficientFundsError();
}

// Deduct a bet immediately (used by games with a mid-round state, like
// Mines and Crash, where the bet leaves the balance before the outcome
// is known).
const deductBet = db.transaction((userId, bet) => {
  const user = db.prepare('SELECT demo_balance FROM users WHERE id = ?').get(userId);
  if (!user) throw new InvalidBetError('User not found');
  validateBet(bet, user.demo_balance);
  db.prepare('UPDATE users SET demo_balance = demo_balance - ? WHERE id = ?').run(bet, userId);
});

// Settle a round: bet has ALREADY been deducted (or is deducted here if
// `deductNow` is true), payout is credited, round is logged, XP is granted.
const settleRound = db.transaction((userId, game, bet, payout, detail, deductNow) => {
  const user = db.prepare('SELECT demo_balance FROM users WHERE id = ?').get(userId);
  if (!user) throw new InvalidBetError('User not found');

  if (deductNow) {
    validateBet(bet, user.demo_balance);
    db.prepare('UPDATE users SET demo_balance = demo_balance - ? WHERE id = ?').run(bet, userId);
  }
  if (payout > 0) {
    db.prepare('UPDATE users SET demo_balance = demo_balance + ? WHERE id = ?').run(payout, userId);
  }

  db.prepare(
    `INSERT INTO game_rounds (user_id, game, bet, payout, net, detail_json) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, game, bet, payout, payout - bet, JSON.stringify(detail || {}));

  const xpResult = addXp(userId, bet);
  const balance = db.prepare('SELECT demo_balance FROM users WHERE id = ?').get(userId).demo_balance;
  return { balance, ...xpResult };
});

module.exports = {
  getUserById,
  validateBet,
  deductBet,
  settleRound,
  InsufficientFundsError,
  InvalidBetError,
};
