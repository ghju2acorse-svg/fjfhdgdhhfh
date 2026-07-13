// games/blackjack.js
const { shuffledIndices } = require('./rng');

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function freshDeck() {
  const cards = [];
  for (const s of SUITS) for (const r of RANKS) cards.push(r + s);
  const order = shuffledIndices(cards.length);
  return order.map(i => cards[i]);
}

function cardValue(card) {
  const rank = card.slice(0, -1);
  if (rank === 'A') return 11;
  if (['J', 'Q', 'K'].includes(rank)) return 10;
  return parseInt(rank, 10);
}

function handValue(hand) {
  let total = hand.reduce((s, c) => s + cardValue(c), 0);
  let aces = hand.filter(c => c.startsWith('A')).length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function isBlackjack(hand) {
  return hand.length === 2 && handValue(hand) === 21;
}

function dealerPlay(deck, dealerHand) {
  const hand = [...dealerHand];
  const remaining = [...deck];
  while (handValue(hand) < 17) {
    hand.push(remaining.shift());
  }
  return { hand, remaining };
}

module.exports = { freshDeck, cardValue, handValue, isBlackjack, dealerPlay };
