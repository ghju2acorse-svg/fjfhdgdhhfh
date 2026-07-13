// db.js
// SQLite database setup for Flashino (demo).
//
// IMPORTANT: `demo_balance` on the users table is play-money only.
// There is no deposit, withdrawal, or payment-processor code anywhere
// in this project. Balances can only change through the server-side
// game logic in /games, which is the single source of truth for every
// win/loss. Do not wire this balance to any real currency, gift card,
// crypto wallet, or in-game currency (Robux, gems, etc). If you want
// this to become a real product, it needs a licensed gambling operator
// and a real KYC/payments stack — that is out of scope for this repo.

const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'flashino.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    demo_balance  REAL NOT NULL DEFAULT 1000,
    xp            INTEGER NOT NULL DEFAULT 0,
    level         INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS game_rounds (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    game        TEXT NOT NULL,
    bet         REAL NOT NULL,
    payout      REAL NOT NULL,
    net         REAL NOT NULL,
    detail_json TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    username   TEXT NOT NULL,
    message    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mines_sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) UNIQUE,
    bet          REAL NOT NULL,
    mine_count   INTEGER NOT NULL,
    mine_indices TEXT NOT NULL,
    revealed     TEXT NOT NULL DEFAULT '[]',
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS crash_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) UNIQUE,
    bet         REAL NOT NULL,
    crash_point REAL NOT NULL,
    started_at  INTEGER NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS blackjack_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) UNIQUE,
    bet         REAL NOT NULL,
    deck        TEXT NOT NULL,
    player_hand TEXT NOT NULL,
    dealer_hand TEXT NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1
  );

  -- Roblox account-linking codes. This table only ever proves "this
  -- website account and this Roblox UserId are controlled by the same
  -- person" — no Robux, items, or currency of any kind flow through
  -- it, and this codebase never reads roblox_user_id anywhere except
  -- to display it. One row per attempt; old/expired rows are cheap to
  -- keep around for audit purposes but can be pruned periodically.
  CREATE TABLE IF NOT EXISTS roblox_links (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id),
    code             TEXT UNIQUE NOT NULL,
    roblox_username  TEXT NOT NULL,
    roblox_user_id   INTEGER NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending', -- pending | verified | expired
    expires_at       INTEGER NOT NULL,
    verified_at      TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_roblox_links_user ON roblox_links(user_id);
`);

// Same safe-migration pattern as last_bonus_date above.
try {
  db.exec('ALTER TABLE users ADD COLUMN roblox_user_id INTEGER');
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e;
}
try {
  db.exec('ALTER TABLE users ADD COLUMN roblox_username TEXT');
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e;
}

// Safe migration for databases created before this column existed —
// better-sqlite3 has no "ADD COLUMN IF NOT EXISTS", so just try it and
// ignore the "duplicate column" error on databases that already have it.
try {
  db.exec('ALTER TABLE users ADD COLUMN last_bonus_date TEXT');
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e;
}

// XP: every settled round grants XP proportional to bet size, and
// levels up on simple thresholds. This only affects the level shown
// in the UI and the chat gate — it never touches demo_balance.
const XP_PER_UNIT_WAGERED = 2;
function levelForXp(xp) {
  // Level N requires N * 150 XP (simple, transparent curve).
  let level = 1;
  while (xp >= level * 150) level++;
  return level;
}

function addXp(userId, bet) {
  const gained = Math.max(1, Math.round(bet * XP_PER_UNIT_WAGERED));
  const user = db.prepare('SELECT xp FROM users WHERE id = ?').get(userId);
  const newXp = user.xp + gained;
  const newLevel = levelForXp(newXp);
  db.prepare('UPDATE users SET xp = ?, level = ? WHERE id = ?').run(newXp, newLevel, userId);
  return { xp: newXp, level: newLevel, gained };
}

// Daily login bonus — still play-money (demo_balance), same as every
// other balance change in this app. Grants at most once per UTC
// calendar day per account, so logging out/in repeatedly doesn't farm
// it. The owner's account gets a larger bonus; this only affects a
// number in a closed-loop currency, nothing that touches real value.
const OWNER_USERNAME = 'zephyr';
const OWNER_BONUS = 15;
const STANDARD_BONUS = 0.03;

function grantLoginBonus(userId, username) {
  const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD" (UTC)
  const user = db.prepare('SELECT last_bonus_date FROM users WHERE id = ?').get(userId);
  if (user && user.last_bonus_date === today) {
    return { granted: 0, balance: null };
  }
  const amount = username.toLowerCase() === OWNER_USERNAME ? OWNER_BONUS : STANDARD_BONUS;
  db.prepare('UPDATE users SET demo_balance = demo_balance + ?, last_bonus_date = ? WHERE id = ?').run(
    amount,
    today,
    userId
  );
  const updated = db.prepare('SELECT demo_balance FROM users WHERE id = ?').get(userId);
  return { granted: amount, balance: updated.demo_balance };
}

module.exports = { db, addXp, levelForXp, grantLoginBonus };
