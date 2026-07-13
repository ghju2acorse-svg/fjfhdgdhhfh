// server.js
// Flashino demo backend.
//
// This server has real accounts (bcrypt password hashes, sessions) and
// a real SQLite database, but the balance it tracks is play-money only:
// there is no deposit endpoint, no withdrawal endpoint, and no payment
// processor integration anywhere in this codebase. Every win or loss
// is decided server-side in /games so the client can't cheat, which is
// what "server-authoritative" means below — but "server-authoritative"
// is not the same as "real money." Wiring this balance to Robux, gift
// cards, crypto, or any other real-value currency is not something
// this project supports and isn't a change I'll help make — see the
// comment at the top of db.js for the full reasoning.

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const { db, grantLoginBonus } = require('./db');
const wallet = require('./wallet');
const roblox = require('./roblox');
const SqliteSessionStore = require('./session-store');

const coinflip = require('./games/coinflip');
const roulette = require('./games/roulette');
const upgrader = require('./games/upgrader');
const casebattles = require('./games/casebattles');
const mines = require('./games/mines');
const crash = require('./games/crash');
const blackjack = require('./games/blackjack');

const app = express();
const PORT = process.env.PORT || 3000;
const CHAT_MIN_LEVEL = 3;

if (!process.env.SESSION_SECRET) {
  console.warn(
    '[server] SESSION_SECRET is not set — using a random secret generated at startup, which means everyone gets logged out every time the server restarts. Set SESSION_SECRET in your .env for production.'
  );
}

app.use(express.json());
app.use(
  session({
    store: new SqliteSessionStore(),
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 },
  })
);
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  next();
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    balance: u.demo_balance,
    xp: u.xp,
    level: u.level,
    robloxLinked: !!u.roblox_user_id,
    robloxUsername: u.roblox_username || null,
  };
}

function handleError(res, err) {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Server error' });
}

// ---------- auth ----------

// Live availability check while typing in the sign-up form. This is a
// UX convenience only — the actual, authoritative duplicate check
// happens in /api/register below (and is backed by a UNIQUE constraint
// on users.username at the database level), so a username can never
// actually end up taken twice even if this check is bypassed.
app.get('/api/check-username', (req, res) => {
  const username = (req.query.u || '').toString();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return res.json({ valid: false, available: false });
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  res.json({ valid: true, available: !existing });
});

app.post('/api/register', (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || !/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-20 characters: letters, numbers, underscores.' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) return res.status(409).json({ error: 'That username is taken.' });

    const hash = bcrypt.hashSync(password, 10);
    let info;
    try {
      info = db
        .prepare('INSERT INTO users (username, password_hash, demo_balance) VALUES (?, ?, 0.05)')
        .run(username, hash);
    } catch (dbErr) {
      // Belt-and-suspenders: the pre-check above already caught this,
      // but the UNIQUE constraint on users.username is the real
      // guarantee — translate its failure into a clean 409 too.
      if (dbErr && dbErr.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'That username is taken.' });
      }
      throw dbErr;
    }

    req.session.userId = info.lastInsertRowid;
    const bonus = grantLoginBonus(info.lastInsertRowid, username);
    const user = wallet.getUserById(info.lastInsertRowid);
    res.json({ user: publicUser(user), bonus: bonus.granted });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!row || !bcrypt.compareSync(password || '', row.password_hash)) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    req.session.userId = row.id;
    const bonus = grantLoginBonus(row.id, row.username);
    const user = wallet.getUserById(row.id);
    res.json({ user: publicUser(user), bonus: bonus.granted });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = wallet.getUserById(req.session.userId);
  if (!user) return res.json({ user: null });
  res.json({ user: publicUser(user) });
});

// Real recent rounds across all players — no fabricated numbers. Used
// for the small activity feed on each game page. Usernames and amounts
// are exactly what's in game_rounds; nothing here is invented.
app.get('/api/recent-rounds', (req, res) => {
  const game = (req.query.game || '').toString();
  const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 10));
  let rows;
  if (game) {
    rows = db
      .prepare(
        `SELECT u.username, r.game, r.bet, r.payout, r.net, r.created_at
         FROM game_rounds r JOIN users u ON u.id = r.user_id
         WHERE r.game = ? ORDER BY r.id DESC LIMIT ?`
      )
      .all(game, limit);
  } else {
    rows = db
      .prepare(
        `SELECT u.username, r.game, r.bet, r.payout, r.net, r.created_at
         FROM game_rounds r JOIN users u ON u.id = r.user_id
         ORDER BY r.id DESC LIMIT ?`
      )
      .all(limit);
  }
  res.json({ rounds: rows });
});

// Demo convenience only: resets this account's play-money balance/XP.
// Still not a deposit or withdrawal — it only ever sets the balance
// back to the same fixed starting amount every new account gets.
app.post('/api/reset-demo', requireAuth, (req, res) => {
  const userId = req.session.userId;
  db.prepare('UPDATE users SET demo_balance = 0.05, xp = 0, level = 1 WHERE id = ?').run(userId);
  // A closed tab or refresh mid-round can leave one of these behind with
  // no way for the UI to resume it (grid state, hand, etc. only ever
  // lived client-side). Clearing them here means Reset is always a real
  // way out, not just a balance reset.
  db.prepare('DELETE FROM mines_sessions WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM crash_sessions WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM blackjack_sessions WHERE user_id = ?').run(userId);
  const user = wallet.getUserById(userId);
  res.json({ user: publicUser(user) });
});

// ---------- chat (level-gated) ----------
app.get('/api/chat', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT username, message, created_at FROM chat_messages ORDER BY id DESC LIMIT 50')
    .all();
  res.json({ messages: rows.reverse() });
});

app.post('/api/chat', requireAuth, (req, res) => {
  const user = wallet.getUserById(req.session.userId);
  if (user.level < CHAT_MIN_LEVEL) {
    return res.status(403).json({ error: `Chat unlocks at Level ${CHAT_MIN_LEVEL}. You're Level ${user.level}.` });
  }
  const message = (req.body && req.body.message || '').toString().trim().slice(0, 200);
  if (!message) return res.status(400).json({ error: 'Message is empty.' });
  db.prepare('INSERT INTO chat_messages (user_id, username, message) VALUES (?, ?, ?)').run(
    user.id,
    user.username,
    message
  );
  res.json({ ok: true });
});

// ---------- roblox account linking ----------
// NOTE: requireAuth here means "has a website session." In the real,
// licensed/KYC'd product this sits in front of, make sure these three
// routes are also gated behind your KYC/age-verification step — i.e.
// a signed-up-but-not-yet-verified account shouldn't be able to reach
// /api/roblox/link/start at all. That's a route-ordering/middleware
// decision to make in that codebase, not something this demo repo
// enforces on its own.

app.post('/api/roblox/link/start', requireAuth, async (req, res) => {
  try {
    const robloxUsername = (req.body && req.body.robloxUsername || '').toString().trim();
    if (!robloxUsername) return res.status(400).json({ error: 'Roblox username is required.' });
    const result = await roblox.startLink(req.session.userId, robloxUsername);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.get('/api/roblox/link/status', requireAuth, (req, res) => {
  try {
    const result = roblox.getStatus(req.session.userId);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// Called by your Roblox game server, NOT the browser — authenticated
// with a shared secret (ROBLOX_GAME_SERVER_SECRET) instead of a
// session cookie, since the caller here is a Roblox server instance,
// not a logged-in website user.
app.post('/api/roblox/link/complete', (req, res) => {
  try {
    const { secret, code, robloxUserId } = req.body || {};
    const result = roblox.completeLink({ secret, code, robloxUserId });
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// ---------- simple round-based games ----------
function simpleRoundRoute(gameName, playFn, buildParams) {
  return (req, res) => {
    try {
      const user = wallet.getUserById(req.session.userId);
      const bet = Number(req.body && req.body.bet);
      wallet.validateBet(bet, user.demo_balance);
      const params = buildParams(req.body, bet);
      const result = playFn(params);
      const settled = wallet.settleRound(user.id, gameName, bet, result.payout, result.detail, true);
      res.json({ ...result, wallet: { balance: settled.balance, level: settled.level, xp: settled.xp } });
    } catch (err) {
      handleError(res, err);
    }
  };
}

app.post(
  '/api/games/coinflip',
  requireAuth,
  simpleRoundRoute('coinflip', coinflip.play, (body, bet) => ({ bet, choice: body.choice }))
);

app.post(
  '/api/games/roulette',
  requireAuth,
  simpleRoundRoute('roulette', roulette.play, (body, bet) => ({ bet, choice: body.choice }))
);

app.post(
  '/api/games/upgrader',
  requireAuth,
  simpleRoundRoute('upgrader', upgrader.play, (body, bet) => ({ bet, chance: Number(body.chance) }))
);

app.post(
  '/api/games/casebattles',
  requireAuth,
  simpleRoundRoute('casebattles', casebattles.play, (body, bet) => ({ bet }))
);

// ---------- mines (multi-step session) ----------
app.post('/api/games/mines/start', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const user = wallet.getUserById(userId);
    const bet = Number(req.body && req.body.bet);
    const mineCount = Number(req.body && req.body.mineCount);

    wallet.validateBet(bet, user.demo_balance);
    if (!Number.isInteger(mineCount) || mineCount < mines.MIN_MINES || mineCount > mines.MAX_MINES) {
      return res.status(400).json({ error: `mineCount must be between ${mines.MIN_MINES} and ${mines.MAX_MINES}.` });
    }
    const existing = db.prepare('SELECT id FROM mines_sessions WHERE user_id = ?').get(userId);
    if (existing) return res.status(409).json({ error: 'Finish your current Mines round first.' });

    wallet.deductBet(userId, bet);
    const mineIndices = mines.placeMines(mineCount);
    db.prepare(
      'INSERT INTO mines_sessions (user_id, bet, mine_count, mine_indices, revealed) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, bet, mineCount, JSON.stringify(mineIndices), JSON.stringify([]));

    res.json({ started: true, bet, mineCount, gridSize: mines.GRID_SIZE, balance: wallet.getUserById(userId).demo_balance });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/games/mines/reveal', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const tile = Number(req.body && req.body.tile);
    const s = db.prepare('SELECT * FROM mines_sessions WHERE user_id = ?').get(userId);
    if (!s) return res.status(400).json({ error: 'No active Mines round. Start one first.' });
    if (!Number.isInteger(tile) || tile < 0 || tile >= mines.GRID_SIZE) {
      return res.status(400).json({ error: 'Invalid tile.' });
    }
    const mineIndices = JSON.parse(s.mine_indices);
    const revealed = JSON.parse(s.revealed);
    if (revealed.includes(tile)) return res.status(400).json({ error: 'Tile already revealed.' });

    if (mineIndices.includes(tile)) {
      db.prepare('DELETE FROM mines_sessions WHERE user_id = ?').run(userId);
      const settled = wallet.settleRound(userId, 'mines', s.bet, 0, { mineIndices, revealed, hit: tile }, false);
      return res.json({
        safe: false,
        mineIndices,
        wallet: { balance: settled.balance, level: settled.level, xp: settled.xp },
      });
    }

    revealed.push(tile);
    const multiplier = mines.multiplierFor(revealed.length, s.mine_count);
    db.prepare('UPDATE mines_sessions SET revealed = ? WHERE user_id = ?').run(JSON.stringify(revealed), userId);
    res.json({ safe: true, revealed, multiplier, potentialPayout: s.bet * multiplier });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/games/mines/cashout', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const s = db.prepare('SELECT * FROM mines_sessions WHERE user_id = ?').get(userId);
    if (!s) return res.status(400).json({ error: 'No active Mines round.' });
    const revealed = JSON.parse(s.revealed);
    if (revealed.length === 0) return res.status(400).json({ error: 'Reveal at least one tile before cashing out.' });

    const multiplier = mines.multiplierFor(revealed.length, s.mine_count);
    const payout = s.bet * multiplier;
    db.prepare('DELETE FROM mines_sessions WHERE user_id = ?').run(userId);
    const settled = wallet.settleRound(userId, 'mines', s.bet, payout, { revealed, multiplier, cashedOut: true }, false);
    res.json({ payout, multiplier, wallet: { balance: settled.balance, level: settled.level, xp: settled.xp } });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------- crash (time-based session) ----------
app.post('/api/games/crash/bet', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const user = wallet.getUserById(userId);
    const bet = Number(req.body && req.body.bet);
    wallet.validateBet(bet, user.demo_balance);

    const existing = db.prepare('SELECT id FROM crash_sessions WHERE user_id = ?').get(userId);
    if (existing) return res.status(409).json({ error: 'Finish your current Crash round first.' });

    wallet.deductBet(userId, bet);
    const crashPoint = crash.generateCrashPoint();
    db.prepare(
      'INSERT INTO crash_sessions (user_id, bet, crash_point, started_at) VALUES (?, ?, ?, ?)'
    ).run(userId, bet, crashPoint, Date.now());

    res.json({ started: true, bet, balance: wallet.getUserById(userId).demo_balance });
  } catch (err) {
    handleError(res, err);
  }
});

app.get('/api/games/crash/state', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const s = db.prepare('SELECT * FROM crash_sessions WHERE user_id = ?').get(userId);
  if (!s) return res.json({ active: false });

  const elapsed = Date.now() - s.started_at;
  const currentMultiplier = crash.multiplierAtElapsedMs(elapsed);
  if (currentMultiplier >= s.crash_point) {
    db.prepare('DELETE FROM crash_sessions WHERE user_id = ?').run(userId);
    const settled = wallet.settleRound(userId, 'crash', s.bet, 0, { crashPoint: s.crash_point }, false);
    return res.json({
      active: false,
      crashed: true,
      crashPoint: s.crash_point,
      wallet: { balance: settled.balance, level: settled.level, xp: settled.xp },
    });
  }
  res.json({ active: true, multiplier: currentMultiplier, bet: s.bet });
});

app.post('/api/games/crash/cashout', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const s = db.prepare('SELECT * FROM crash_sessions WHERE user_id = ?').get(userId);
    if (!s) return res.status(400).json({ error: 'No active Crash round.' });

    const elapsed = Date.now() - s.started_at;
    const currentMultiplier = crash.multiplierAtElapsedMs(elapsed);
    if (currentMultiplier >= s.crash_point) {
      db.prepare('DELETE FROM crash_sessions WHERE user_id = ?').run(userId);
      const settled = wallet.settleRound(userId, 'crash', s.bet, 0, { crashPoint: s.crash_point }, false);
      return res.json({
        crashed: true,
        crashPoint: s.crash_point,
        wallet: { balance: settled.balance, level: settled.level, xp: settled.xp },
      });
    }

    const payout = s.bet * currentMultiplier;
    db.prepare('DELETE FROM crash_sessions WHERE user_id = ?').run(userId);
    const settled = wallet.settleRound(userId, 'crash', s.bet, payout, { cashedOutAt: currentMultiplier }, false);
    res.json({
      crashed: false,
      cashedOutAt: currentMultiplier,
      payout,
      wallet: { balance: settled.balance, level: settled.level, xp: settled.xp },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------- blackjack (multi-step session) ----------
app.post('/api/games/blackjack/deal', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const user = wallet.getUserById(userId);
    const bet = Number(req.body && req.body.bet);
    wallet.validateBet(bet, user.demo_balance);

    const existing = db.prepare('SELECT id FROM blackjack_sessions WHERE user_id = ?').get(userId);
    if (existing) return res.status(409).json({ error: 'Finish your current Blackjack hand first.' });

    wallet.deductBet(userId, bet);
    const deck = blackjack.freshDeck();
    const playerHand = [deck.shift(), deck.shift()];
    const dealerHand = [deck.shift(), deck.shift()];

    db.prepare(
      'INSERT INTO blackjack_sessions (user_id, bet, deck, player_hand, dealer_hand) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, bet, JSON.stringify(deck), JSON.stringify(playerHand), JSON.stringify(dealerHand));

    const playerBJ = blackjack.isBlackjack(playerHand);
    if (playerBJ) {
      // Resolve immediately: natural blackjack pays 2.5x unless dealer also has one (push).
      const dealerBJ = blackjack.isBlackjack(dealerHand);
      const payout = dealerBJ ? bet : bet * 2.5;
      db.prepare('DELETE FROM blackjack_sessions WHERE user_id = ?').run(userId);
      const settled = wallet.settleRound(userId, 'blackjack', bet, payout, { playerHand, dealerHand, blackjack: true }, false);
      return res.json({
        playerHand,
        dealerHand,
        finished: true,
        outcome: dealerBJ ? 'push' : 'blackjack',
        payout,
        wallet: { balance: settled.balance, level: settled.level, xp: settled.xp },
      });
    }

    res.json({ playerHand, dealerHand: [dealerHand[0]], finished: false });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/games/blackjack/hit', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const s = db.prepare('SELECT * FROM blackjack_sessions WHERE user_id = ?').get(userId);
    if (!s) return res.status(400).json({ error: 'No active Blackjack hand.' });

    const deck = JSON.parse(s.deck);
    const playerHand = JSON.parse(s.player_hand);
    playerHand.push(deck.shift());

    const total = blackjack.handValue(playerHand);
    if (total > 21) {
      db.prepare('DELETE FROM blackjack_sessions WHERE user_id = ?').run(userId);
      const settled = wallet.settleRound(
        userId,
        'blackjack',
        s.bet,
        0,
        { playerHand, dealerHand: JSON.parse(s.dealer_hand), bust: true },
        false
      );
      return res.json({
        playerHand,
        finished: true,
        outcome: 'bust',
        wallet: { balance: settled.balance, level: settled.level, xp: settled.xp },
      });
    }

    db.prepare('UPDATE blackjack_sessions SET deck = ?, player_hand = ? WHERE user_id = ?').run(
      JSON.stringify(deck),
      JSON.stringify(playerHand),
      userId
    );
    res.json({ playerHand, finished: false, total });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/games/blackjack/stand', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const s = db.prepare('SELECT * FROM blackjack_sessions WHERE user_id = ?').get(userId);
    if (!s) return res.status(400).json({ error: 'No active Blackjack hand.' });

    const deck = JSON.parse(s.deck);
    const playerHand = JSON.parse(s.player_hand);
    const { hand: dealerHand } = blackjack.dealerPlay(deck, JSON.parse(s.dealer_hand));

    const playerTotal = blackjack.handValue(playerHand);
    const dealerTotal = blackjack.handValue(dealerHand);

    let outcome, payout;
    if (dealerTotal > 21 || playerTotal > dealerTotal) {
      outcome = 'win';
      payout = s.bet * 2;
    } else if (playerTotal === dealerTotal) {
      outcome = 'push';
      payout = s.bet;
    } else {
      outcome = 'lose';
      payout = 0;
    }

    db.prepare('DELETE FROM blackjack_sessions WHERE user_id = ?').run(userId);
    const settled = wallet.settleRound(userId, 'blackjack', s.bet, payout, { playerHand, dealerHand, outcome }, false);
    res.json({
      playerHand,
      dealerHand,
      playerTotal,
      dealerTotal,
      finished: true,
      outcome,
      payout,
      wallet: { balance: settled.balance, level: settled.level, xp: settled.xp },
    });
  } catch (err) {
    handleError(res, err);
  }
});

app.listen(PORT, () => {
  console.log(`Flashino demo server running at http://localhost:${PORT}`);
});
