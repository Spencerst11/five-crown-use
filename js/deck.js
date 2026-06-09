// ============================================================
// deck.js — Card & Deck Logic for Five Kingdoms
// ============================================================

const SUITS = [
  { id: 'star',    symbol: '★', cls: 'suit-star'    },
  { id: 'heart',   symbol: '♥', cls: 'suit-heart'   },
  { id: 'club',    symbol: '♣', cls: 'suit-club'    },
  { id: 'spade',   symbol: '♠', cls: 'suit-spade'   },
  { id: 'diamond', symbol: '♦', cls: 'suit-diamond' },
];

// Ranks 3–13 (J=11, Q=12, K=13), plus Joker=0
// Card values for scoring
const RANK_INFO = {
  0:  { label: 'JK', display: '🃏', score: 50  }, // Joker
  3:  { label: '3',  display: '3',  score: 3   },
  4:  { label: '4',  display: '4',  score: 4   },
  5:  { label: '5',  display: '5',  score: 5   },
  6:  { label: '6',  display: '6',  score: 6   },
  7:  { label: '7',  display: '7',  score: 7   },
  8:  { label: '8',  display: '8',  score: 8   },
  9:  { label: '9',  display: '9',  score: 9   },
  10: { label: '10', display: '10', score: 10  },
  11: { label: 'J',  display: 'J',  score: 11  },
  12: { label: 'Q',  display: 'Q',  score: 12  },
  13: { label: 'K',  display: 'K',  score: 13  },
};

let _cardIdCounter = 0;

function makeCard(rank, suit, deckIndex) {
  return {
    id: `c${_cardIdCounter++}`,
    rank,       // 0 = Joker, 3–13
    suit,       // suit id string (null for joker)
    deckIndex,  // which deck it came from (0 or 1)
  };
}

// Build one 58-card deck: 55 ranked cards + 3 jokers
function buildSingleDeck(deckIndex) {
  const cards = [];
  for (const suit of SUITS) {
    for (let rank = 3; rank <= 13; rank++) {
      cards.push(makeCard(rank, suit.id, deckIndex));
    }
  }
  // 3 Jokers
  for (let j = 0; j < 3; j++) {
    cards.push(makeCard(0, null, deckIndex));
  }
  return cards; // 55 + 3 = 58
}

// Build full double deck (116 cards)
function buildDoubleDeck() {
  _cardIdCounter = 0;
  return [...buildSingleDeck(0), ...buildSingleDeck(1)];
}

// Fisher-Yates shuffle
function shuffleDeck(deck) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Round number (1–11) → wild rank (3–13)
function getWildRank(round) {
  return round + 2; // round 1 → 3, round 11 → 13
}

// Is this card wild for the given round?
function isWild(card, round) {
  if (card.rank === 0) return true;          // Joker always wild
  if (card.rank === getWildRank(round)) return true;
  return false;
}

// Score a single card for given round
function cardScore(card, round) {
  if (card.rank === 0) return 50; // Joker
  if (card.rank === getWildRank(round)) return 20; // round wild
  return RANK_INFO[card.rank].score;
}

// Score an entire unmelded hand
function handScore(cards, round) {
  return cards.reduce((sum, c) => sum + cardScore(c, round), 0);
}

// ── MELD VALIDATION ─────────────────────────────────────────

// Check if an array of cards forms a valid book (3+ same rank, wilds ok)
// A "book" = 3+ cards same value (rank). Wilds substitute freely.
function isValidBook(cards, round) {
  if (cards.length < 3) return false;
  const naturals = cards.filter(c => !isWild(c, round));
  if (naturals.length === 0) return true; // all wilds ok
  const firstRank = naturals[0].rank;
  return naturals.every(c => c.rank === firstRank);
}

// Check if an array of cards forms a valid run (3+ consecutive same suit, wilds ok)
function isValidRun(cards, round) {
  if (cards.length < 3) return false;
  const naturals = cards.filter(c => !isWild(c, round));
  if (naturals.length === 0) return true; // all wilds
  const suit = naturals[0].suit;
  if (!suit) return false;
  if (!naturals.every(c => c.suit === suit)) return false;

  // Sort naturals by rank
  const sorted = naturals.slice().sort((a, b) => a.rank - b.rank);
  const wildCount = cards.length - naturals.length;

  // Check consecutive: gaps must be fillable with wilds
  let wildNeeded = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].rank - sorted[i - 1].rank;
    if (gap < 1) return false; // duplicate rank in run
    wildNeeded += gap - 1;
  }
  return wildNeeded <= wildCount;
}

// Check if a group of cards is a valid meld (book or run)
function isValidMeld(cards, round) {
  return isValidBook(cards, round) || isValidRun(cards, round);
}

// ── AUTO-MELD DETECTION ─────────────────────────────────────
// Attempt to partition hand into valid melds + discard (1 leftover)
// Returns { melds: [[...], [...]], leftover: [...], canGoOut: bool }
// This is a heuristic solver — exhaustive for small hands

function tryMeld(hand, round) {
  const handSize = hand.length;
  // Need exactly 1 discard card
  if (handSize < 3) return { melds: [], leftover: hand, canGoOut: false };

  // Try every possible discard
  for (let discardIdx = 0; discardIdx < handSize; discardIdx++) {
    const discard = hand[discardIdx];
    const remaining = hand.filter((_, i) => i !== discardIdx);
    const result = partitionIntoMelds(remaining, round);
    if (result !== null) {
      return { melds: result, leftover: [discard], canGoOut: true, discard };
    }
  }
  return { melds: [], leftover: hand, canGoOut: false };
}

// Try to partition cards entirely into valid melds (recursive backtracking)
function partitionIntoMelds(cards, round) {
  if (cards.length === 0) return [];
  if (cards.length < 3) return null;

  // Try each subset of size 3, 4, 5... as first meld
  for (let size = 3; size <= cards.length; size++) {
    const combos = getCombinations(cards, size);
    for (const combo of combos) {
      if (isValidMeld(combo, round)) {
        const rest = cards.filter(c => !combo.includes(c));
        const sub = partitionIntoMelds(rest, round);
        if (sub !== null) return [combo, ...sub];
      }
    }
  }
  return null;
}

// Get all combinations of size k from array
function getCombinations(arr, k) {
  const result = [];
  function helper(start, current) {
    if (current.length === k) { result.push([...current]); return; }
    for (let i = start; i < arr.length; i++) {
      current.push(arr[i]);
      helper(i + 1, current);
      current.pop();
    }
  }
  helper(0, []);
  return result;
}

// ── SUIT HELPERS ─────────────────────────────────────────────
function getSuitInfo(suitId) {
  return SUITS.find(s => s.id === suitId) || { symbol: '?', cls: '' };
}

function getCardLabel(card) {
  if (card.rank === 0) return 'Joker';
  const ri = RANK_INFO[card.rank];
  const si = getSuitInfo(card.suit);
  return `${ri.label}${si.symbol}`;
}

function getWildLabel(round) {
  const rank = getWildRank(round);
  const ri = RANK_INFO[rank];
  return `${ri.label}s`;
}
