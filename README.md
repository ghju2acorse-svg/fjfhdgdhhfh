# Flashino — demo backend

A real Node/Express server + SQLite database behind the Flashino front end:
real accounts (bcrypt-hashed passwords, sessions), a real wallet balance,
real XP/leveling, real level-gated chat, and all 7 games running with
server-authoritative logic (the client never decides a win/loss — it
only ever displays what the server already decided).

## What this is NOT

There is no deposit endpoint, no withdrawal endpoint, and no payment
processor integration anywhere in this codebase — not stubbed out, not
commented out, just not present. `demo_balance` is a play-money number
with a fixed starting value (1,000) and a reset button. See the comment
at the top of `db.js` for the reasoning. This is intentional and isn't
something to wire up later; if you want a real-money product, that's a
different, much bigger project involving a licensed gambling operator,
KYC, and a compliant payments stack.

Roblox account linking (username lookup + avatar display used as a
substitute for real login) isn't implemented here either, for the same
reason it wasn't built earlier in this conversation — it's not real
authentication, and paired with a gambling site it's an impersonation
risk aimed at an audience that's largely underage.

## Run it

```bash
npm install
npm start
```

Then open `http://localhost:3000`. The first request creates
`flashino.db` (SQLite) in this folder automatically.

## Architecture

```
server.js        Express app, all routes, session auth
db.js             SQLite schema + XP/level curve
wallet.js         The ONLY place that touches demo_balance
games/
  rng.js          Shared CSPRNG helpers (crypto, not Math.random)
  coinflip.js      50/50-ish, 2× payout
  roulette.js      European wheel, red/black/green
  upgrader.js      Chance-based multiplier
  casebattles.js   Weighted case-opening table
  mines.js         Fair hypergeometric multiplier math
  crash.js         Crash-point distribution + growth curve
  blackjack.js     Deck, dealing, hand values, dealer AI
public/
  index.html       Front end — fetches everything from the API above
```

Every game keeps a small house edge (2-4%, tunable per file) the same
way real casino games do, so the numbers behave realistically — but
again, the currency behind those numbers has no real value.

## Auth

Real: `bcryptjs` password hashes, `express-session` cookies. Username
rules: 3-20 chars, letters/numbers/underscores. Password: 8+ chars
minimum. No OAuth, no third-party identity linking.

## Chat

`GET/POST /api/chat`. Posting requires `level >= 3`, enforced
server-side (the front end also disables the input, but the server is
what actually decides — never trust the client).

## XP / levels

`level * 150` XP to reach the next level (so it's a flat 150 XP band
per level). XP is granted per settled round, proportional to bet size.
Doesn't affect the wallet — cosmetic/gating only.

## Extending this

- **Provably-fair verification**: the RNG call sites in `games/*.js`
  are exactly where a commit-reveal seed scheme would go (hash a server
  seed, show the hash before the round, reveal the seed after). Not
  implemented here to keep scope manageable.
- **Multiplayer Case Battles**: currently single-player (you vs the
  odds table). A real "battle" mode would need a matchmaking/lobby
  layer on top of this.
- **Real crash rounds**: currently each player's Crash round is their
  own private session. A shared round with a synced multiplier across
  all players would need a small scheduler + WebSocket broadcast
  instead of per-user polling.
