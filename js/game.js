// ============================================================
// game.js — Five Crowns Game State & Logic
// ============================================================

const Game = (() => {

  // ── STATE ────────────────────────────────────────────────
  let state = null;

  function fresh(playerIds, playerNames, hostId) {
    return {
      phase: 'lobby',       // lobby | draw | discard | going-out | round-end | game-over
      round: 1,             // 1–11
      dealerIdx: 0,
      turnIdx: 0,
      players: playerIds.map((id, i) => ({
        id,
        name: playerNames[i],
        hand: [],
        score: 0,
        roundScores: [],  // per-round delta
        wentOut: false,
        lastRoundMeld: null,
      })),
      drawPile: [],
      discardPile: [],
      hostId,
      goingOutPlayerId: null,   // who triggered going-out
      finalTurnsLeft: 0,        // countdown for last-turn phase
      drawnThisTurn: false,     // has current player drawn yet?
      roundWinner: null,        // who went out this round
    };
  }

  function get() { return state; }
  function set(s) { state = s; }

  // ── ROUND SETUP ──────────────────────────────────────────
  function dealRound(s) {
    const handSize = s.round + 2; // round 1 → 3 cards, round 11 → 13
    const deck = shuffleDeck(buildDoubleDeck());

    // Reset per-round state
    s.players.forEach(p => { p.hand = []; p.wentOut = false; p.lastRoundMeld = null; });
    s.goingOutPlayerId = null;
    s.finalTurnsLeft = 0;
    s.drawnThisTurn = false;
    s.roundWinner = null;

    // Deal hand-size cards to each player, starting left of dealer
    const numPlayers = s.players.length;
    for (let i = 0; i < handSize; i++) {
      for (let j = 0; j < numPlayers; j++) {
        const pIdx = (s.dealerIdx + 1 + j) % numPlayers;
        s.players[pIdx].hand.push(deck.pop());
      }
    }

    // Remaining cards = draw pile, flip one to start discard
    s.drawPile = deck;
    s.discardPile = [s.drawPile.pop()];

    // First player to left of dealer goes first
    s.turnIdx = (s.dealerIdx + 1) % numPlayers;
    s.phase = 'draw';
  }

  // ── TURN ACTIONS ─────────────────────────────────────────

  function drawFromDeck(s, playerId) {
    const p = getPlayer(s, playerId);
    if (!p) return { ok: false, err: 'Player not found' };
    if (!isPlayerTurn(s, playerId)) return { ok: false, err: 'Not your turn' };
    if (s.phase !== 'draw') return { ok: false, err: 'Cannot draw now' };
    if (s.drawPile.length === 0) reshuffleDiscard(s);
    if (s.drawPile.length === 0) return { ok: false, err: 'Draw pile empty!' };

    const card = s.drawPile.pop();
    p.hand.push(card);
    s.drawnThisTurn = true;
    s.phase = 'discard';
    return { ok: true, card };
  }

  function drawFromDiscard(s, playerId) {
    const p = getPlayer(s, playerId);
    if (!p) return { ok: false, err: 'Player not found' };
    if (!isPlayerTurn(s, playerId)) return { ok: false, err: 'Not your turn' };
    if (s.phase !== 'draw') return { ok: false, err: 'Cannot draw now' };
    if (s.discardPile.length === 0) return { ok: false, err: 'Discard pile empty' };

    const card = s.discardPile.pop();
    p.hand.push(card);
    s.drawnThisTurn = true;
    s.phase = 'discard';
    return { ok: true, card };
  }

  function discardCard(s, playerId, cardId) {
    const p = getPlayer(s, playerId);
    if (!p) return { ok: false, err: 'Player not found' };
    if (!isPlayerTurn(s, playerId)) return { ok: false, err: 'Not your turn' };
    if (s.phase !== 'discard' && s.phase !== 'going-out') return { ok: false, err: 'Cannot discard now' };

    const cardIdx = p.hand.findIndex(c => c.id === cardId);
    if (cardIdx === -1) return { ok: false, err: 'Card not in hand' };

    const [card] = p.hand.splice(cardIdx, 1);
    s.discardPile.push(card);

    // Advance turn
    return advanceTurn(s, playerId);
  }

  function goOut(s, playerId) {
    const p = getPlayer(s, playerId);
    if (!p) return { ok: false, err: 'Player not found' };
    if (!isPlayerTurn(s, playerId)) return { ok: false, err: 'Not your turn' };
    if (s.phase !== 'discard') return { ok: false, err: 'Must draw first' };

    // Validate: can the hand meld (minus one discard)?
    const meldResult = tryMeld(p.hand, s.round);
    if (!meldResult.canGoOut) return { ok: false, err: 'Hand cannot be fully melded' };

    // Remove the auto-discard from hand
    const discardCard = meldResult.discard;
    const cardIdx = p.hand.findIndex(c => c.id === discardCard.id);
    p.hand.splice(cardIdx, 1);
    s.discardPile.push(discardCard);

    p.wentOut = true;
    p.lastRoundMeld = meldResult.melds;
    s.goingOutPlayerId = playerId;
    s.roundWinner = playerId;
    s.phase = 'going-out';

    // Everyone else gets one more turn
    const numPlayers = s.players.length;
    s.finalTurnsLeft = numPlayers - 1;

    // Move to next player
    s.turnIdx = (s.turnIdx + 1) % numPlayers;
    s.drawnThisTurn = false;

    if (s.finalTurnsLeft === 0) {
      return endRound(s);
    }

    return { ok: true, action: 'going-out', melds: meldResult.melds, discardCard };
  }

  function advanceTurn(s, playerId) {
    const numPlayers = s.players.length;

    if (s.phase === 'going-out') {
      s.finalTurnsLeft--;
      if (s.finalTurnsLeft <= 0) {
        return endRound(s);
      }
    }

    s.turnIdx = (s.turnIdx + 1) % numPlayers;
    s.drawnThisTurn = false;
    s.phase = s.phase === 'going-out' ? 'going-out' : 'draw';
    return { ok: true, action: 'next-turn' };
  }

  // ── ROUND END ────────────────────────────────────────────
  function endRound(s) {
    s.phase = 'round-end';

    // Score each player's remaining hand
    const results = s.players.map(p => {
      // If they went out (or successfully melded in last turn), score = 0 for their melds
      // Otherwise count all cards in hand
      let roundScore = 0;
      if (p.wentOut) {
        roundScore = 0;
      } else {
        // Try to meld what they can and score the rest
        const meldResult = tryMeld(p.hand, s.round);
        if (meldResult.canGoOut) {
          // They could have gone out — score 0
          roundScore = 0;
          p.lastRoundMeld = meldResult.melds;
        } else {
          // Score all remaining cards
          let leftover = p.hand;
          if (meldResult.melds.length > 0) {
            // Credit what they could meld
            const melded = meldResult.melds.flat();
            leftover = p.hand.filter(c => !melded.some(m => m.id === c.id));
          }
          roundScore = handScore(leftover, s.round);
        }
      }
      p.score += roundScore;
      p.roundScores.push(roundScore);
      return { playerId: p.id, name: p.name, roundScore, totalScore: p.score };
    });

    // Check game over (11 rounds)
    if (s.round >= 11) {
      s.phase = 'game-over';
      const winner = s.players.reduce((a, b) => a.score <= b.score ? a : b);
      s.winner = winner.id;
      return { ok: true, action: 'game-over', results, winner: winner.id, winnerName: winner.name };
    }

    return { ok: true, action: 'round-end', results };
  }

  // ── NEXT ROUND ───────────────────────────────────────────
  function nextRound(s) {
    s.round++;
    s.dealerIdx = (s.dealerIdx + 1) % s.players.length;
    dealRound(s);
    return { ok: true, action: 'round-start' };
  }

  // ── HELPERS ─────────────────────────────────────────────
  function reshuffleDiscard(s) {
    if (s.discardPile.length <= 1) return;
    const top = s.discardPile.pop();
    s.drawPile = shuffleDeck(s.discardPile);
    s.discardPile = [top];
  }

  function getPlayer(s, id) {
    return s.players.find(p => p.id === id) || null;
  }

  function isPlayerTurn(s, id) {
    return s.players[s.turnIdx]?.id === id;
  }

  function currentTurnPlayerId(s) {
    return s.players[s.turnIdx]?.id || null;
  }

  function getPublicState(s, forPlayerId) {
    // Return state safe to send to a specific player
    return {
      phase: s.phase,
      round: s.round,
      turnIdx: s.turnIdx,
      dealerIdx: s.dealerIdx,
      goingOutPlayerId: s.goingOutPlayerId,
      finalTurnsLeft: s.finalTurnsLeft,
      drawnThisTurn: s.drawnThisTurn,
      roundWinner: s.roundWinner,
      winner: s.winner || null,
      drawPileCount: s.drawPile.length,
      discardTop: s.discardPile[s.discardPile.length - 1] || null,
      players: s.players.map(p => ({
        id: p.id,
        name: p.name,
        handCount: p.hand.length,
        score: p.score,
        roundScores: p.roundScores,
        wentOut: p.wentOut,
        // Only send actual hand to the owner
        hand: p.id === forPlayerId ? p.hand : null,
      })),
    };
  }

  return {
    fresh,
    get,
    set,
    dealRound,
    drawFromDeck,
    drawFromDiscard,
    discardCard,
    goOut,
    nextRound,
    endRound,
    getPlayer,
    isPlayerTurn,
    currentTurnPlayerId,
    getPublicState,
  };
})();
