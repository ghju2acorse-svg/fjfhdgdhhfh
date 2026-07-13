// roblox.js
// Handles proof-of-ownership linking between a website account and a
// Roblox account. This module never touches Robux, items, or any
// in-game currency — it only stores a Roblox UserId next to the
// website account once ownership has been verified via a one-time
// code entered inside a Roblox experience you control.
//
// Placement note: wherever this gets mounted in the real product,
// /api/roblox/link/* should sit behind the same auth + KYC gate as the
// rest of the account — i.e. only an already-verified adult account
// should ever be able to reach these routes.

const crypto = require('crypto');
const { db } = require('./db');

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// A simple, unambiguous word bank for the "Flash-Ino | word word word word
// word" passphrase style code. All short, common, easy to read aloud and
// type, no homophones/near-duplicates.
const WORD_BANK = [
  'sun', 'ocean', 'chair', 'pencil', 'chimney', 'river', 'garden', 'window',
  'candle', 'forest', 'anchor', 'ladder', 'pillow', 'rocket', 'basket', 'bridge',
  'cactus', 'dragon', 'ember', 'falcon', 'glacier', 'harbor', 'island', 'jungle',
  'kettle', 'lantern', 'meadow', 'nickel', 'orbit', 'pepper', 'quartz', 'ribbon',
  'saddle', 'temple', 'umbrella', 'velvet', 'walnut', 'yonder', 'zephyr', 'amber',
  'boulder', 'canyon', 'desert', 'eagle', 'feather', 'granite', 'hollow', 'ivory',
  'jasper', 'kernel', 'lighthouse', 'marble', 'nectar', 'oasis', 'prairie', 'quiver',
  'ranger', 'summit', 'thunder', 'urchin', 'valley', 'willow', 'copper', 'maple',
  'coral', 'dune', 'ember', 'frost', 'grove', 'hazel', 'indigo', 'juniper',
  'knight', 'lotus', 'moss', 'north', 'onyx', 'plume', 'quill', 'reed'
];

function generateCode() {
  const chosen = [];
  const pool = [...WORD_BANK];
  for (let i = 0; i < 5; i++) {
    const idx = crypto.randomInt(0, pool.length);
    chosen.push(pool[idx]);
    pool.splice(idx, 1); // no repeated words within one code
  }
  return `Flash-Ino | ${chosen.join(' ')}`;
}

// Shared secret your Roblox game server uses to authenticate its call
// to /api/roblox/link/complete. Set this in your environment; never
// hardcode it, and never expose it to the browser.
const GAME_SERVER_SECRET = process.env.ROBLOX_GAME_SERVER_SECRET;
if (!GAME_SERVER_SECRET) {
  console.warn('[roblox] ROBLOX_GAME_SERVER_SECRET is not set — /api/roblox/link/complete will reject all requests.');
}

// The Roblox experience (place) users are sent to in order to verify.
const ROBLOX_PLACE_ID = process.env.ROBLOX_PLACE_ID;

// Roblox's public username -> UserId lookup. No auth required, no
// scopes, just resolves a username to an ID so we know who we're
// waiting to hear back about.
async function lookupRobloxUserId(username) {
  const resp = await fetch('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
  });
  if (!resp.ok) {
    const err = new Error('Roblox lookup failed. Try again in a moment.');
    err.status = 502;
    throw err;
  }
  const data = await resp.json();
  const match = data.data && data.data[0];
  if (!match) {
    const err = new Error('No Roblox account found with that username.');
    err.status = 404;
    throw err;
  }
  return { userId: match.id, username: match.name };
}

// Called by POST /api/roblox/link/start (already behind requireAuth +
// your KYC gate). Looks up the username, mints a code, stores the
// pending row.
async function startLink(websiteUserId, robloxUsername) {
  const { userId: robloxUserId, username: resolvedUsername } = await lookupRobloxUserId(robloxUsername);

  // One active pending code per website account at a time — clears any
  // stale pending attempt rather than piling up rows.
  db.prepare(`DELETE FROM roblox_links WHERE user_id = ? AND status = 'pending'`).run(websiteUserId);

  const code = generateCode();
  const expiresAt = Date.now() + CODE_TTL_MS;
  db.prepare(
    `INSERT INTO roblox_links (user_id, code, roblox_username, roblox_user_id, status, expires_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`
  ).run(websiteUserId, code, resolvedUsername, robloxUserId, expiresAt);

  const joinUrl = ROBLOX_PLACE_ID
    ? `https://www.roblox.com/games/${ROBLOX_PLACE_ID}?linkCode=${encodeURIComponent(code)}`
    : `https://www.roblox.com/games/`; // fallback if not configured yet

  return { code, joinUrl, robloxUsername: resolvedUsername };
}

// Called by GET /api/roblox/link/status.
function getStatus(websiteUserId) {
  const row = db
    .prepare(`SELECT * FROM roblox_links WHERE user_id = ? ORDER BY id DESC LIMIT 1`)
    .get(websiteUserId);
  if (!row) return { status: 'none' };

  if (row.status === 'pending' && Date.now() > row.expires_at) {
    db.prepare(`UPDATE roblox_links SET status = 'expired' WHERE id = ?`).run(row.id);
    return { status: 'expired' };
  }
  return { status: row.status, robloxUsername: row.roblox_username };
}

// Called by POST /api/roblox/link/complete — this is the ONLY route
// meant to be hit by your Roblox game server, never by the browser.
// Verifies the shared secret, the code, and that the UserId reported
// by the game server matches the UserId we resolved at start().
function completeLink({ secret, code, robloxUserId }) {
  if (!GAME_SERVER_SECRET || secret !== GAME_SERVER_SECRET) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }
  const row = db.prepare(`SELECT * FROM roblox_links WHERE code = ?`).get(code);
  if (!row) {
    const err = new Error('Unknown code');
    err.status = 404;
    throw err;
  }
  if (row.status !== 'pending') {
    const err = new Error(`Code already ${row.status}`);
    err.status = 409;
    throw err;
  }
  if (Date.now() > row.expires_at) {
    db.prepare(`UPDATE roblox_links SET status = 'expired' WHERE id = ?`).run(row.id);
    const err = new Error('Code expired');
    err.status = 410;
    throw err;
  }
  if (Number(robloxUserId) !== Number(row.roblox_user_id)) {
    // The player who typed the code in-game isn't the account that
    // requested it — do not link, and do not leak which account this
    // code belonged to in the error message.
    const err = new Error('UserId mismatch');
    err.status = 409;
    throw err;
  }

  db.prepare(`UPDATE roblox_links SET status = 'verified', verified_at = datetime('now') WHERE id = ?`).run(row.id);
  db.prepare(`UPDATE users SET roblox_user_id = ?, roblox_username = ? WHERE id = ?`).run(
    row.roblox_user_id,
    row.roblox_username,
    row.user_id
  );
  return { ok: true, websiteUserId: row.user_id };
}

module.exports = { startLink, getStatus, completeLink };