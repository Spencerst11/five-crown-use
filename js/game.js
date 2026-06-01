// ============================================================
// game.js — Five Crowns Game Logic (v8)
// New: getPublicState now includes revealedLeftover (unmelded
//      cards shown in the right Final Cards panel after round ends)
// ============================================================

const Game = (() => {

  let state = null;
  function get() { return state; }
  function set(s) { state = s; }

  function fresh(playerIds, playerNames, hostId, playerAvatars) {
    return {
      phase: 'lobby', round: 1, dealerIdx: 0, turnIdx: 0,
      players: playerIds.map((id, i) => ({
        id, name: playerNames[i],
        avatar: (playerAvatars && playerAvatars[i]) || { animal:'none', color:'gold' },
        hand: [], score: 0, roundScores: [],
        wentOut: false, lastRoundMeld: null,
        revealedMelds: null, revealedLeftover: null,
      })),
      drawPile: [], discardPile: [],
      hostId, goingOutPlayerId: null,
      finalTurnsLeft: 0, drawnThisTurn: false, roundWinner: null,
    };
  }

  // ── ROUND SETUP ──────────────────────────────────────────
  function dealRound(s) {
    const handSize = s.round + 2;
    const deck = shuffleDeck(buildDoubleDeck());
    s.players.forEach(p => {
      p.hand = []; p.wentOut = false;
      p.lastRoundMeld = null; p.revealedMelds = null; p.revealedLeftover = null;
      p.finalScoreCards = null;
    });
    s.goingOutPlayerId = null; s.finalTurnsLeft = 0;
    s.drawnThisTurn = false; s.roundWinner = null;
    const n = s.players.length;
    for (let i = 0; i < handSize; i++)
      for (let j = 0; j < n; j++)
        s.players[(s.dealerIdx + 1 + j) % n].hand.push(deck.pop());
    s.drawPile = deck;
    s.discardPile = [s.drawPile.pop()];
    s.turnIdx = (s.dealerIdx + 1) % n;
    s.phase = 'draw';
  }

  // ── DRAW ─────────────────────────────────────────────────
  function drawFromDeck(s, playerId) {
    const p = getPlayer(s, playerId);
    if (!p) return { ok:false, err:'Player not found' };
    if (!isPlayerTurn(s, playerId)) return { ok:false, err:'Not your turn' };
    if (s.phase !== 'draw' && s.phase !== 'going-out') return { ok:false, err:'Cannot draw now' };
    if (s.drawnThisTurn) return { ok:false, err:'Already drew this turn' };

    let didReshuffle = false;
    if (s.drawPile.length === 0) didReshuffle = reshuffleDiscard(s);
    if (s.drawPile.length === 0) return { ok:false, err:'No cards left to draw!' };

    const card = s.drawPile.pop();
    p.hand.push(card);
    s.drawnThisTurn = true;
    if (s.phase === 'draw') s.phase = 'discard';
    return { ok:true, card, action:'draw-deck', reshuffled: didReshuffle };
  }

  function drawFromDiscard(s, playerId) {
    const p = getPlayer(s, playerId);
    if (!p) return { ok:false, err:'Player not found' };
    if (!isPlayerTurn(s, playerId)) return { ok:false, err:'Not your turn' };
    if (s.phase !== 'draw' && s.phase !== 'going-out') return { ok:false, err:'Cannot draw now' };
    if (s.drawnThisTurn) return { ok:false, err:'Already drew this turn' };
    if (s.discardPile.length === 0) return { ok:false, err:'Discard pile empty' };

    const card = s.discardPile.pop();
    p.hand.push(card);
    s.drawnThisTurn = true;
    if (s.phase === 'draw') s.phase = 'discard';
    return { ok:true, card, action:'draw-discard' };
  }

  // ── DISCARD ──────────────────────────────────────────────
  function discardCard(s, playerId, cardId) {
    const p = getPlayer(s, playerId);
    if (!p) return { ok:false, err:'Player not found' };
    if (!isPlayerTurn(s, playerId)) return { ok:false, err:'Not your turn' };
    if (s.phase !== 'discard' && s.phase !== 'going-out') return { ok:false, err:'Cannot discard now' };
    if (s.phase === 'going-out' && !s.drawnThisTurn) return { ok:false, err:'Must draw first on your final turn' };

    const idx = p.hand.findIndex(c => c.id === cardId);
    if (idx === -1) return { ok:false, err:'Card not in hand' };
    const [card] = p.hand.splice(idx, 1);
    s.discardPile.push(card);

    // On a plain final-turn discard (player chose NOT to lay down melds),
    // all remaining cards count as points.
    if (s.phase === 'going-out') {
      p.revealedMelds = [];
      p.revealedLeftover = [...p.hand];
      p.revealedLeftoverRound = s.round;
      p.finalScoreCards = [...p.hand];
    }

    return advanceTurn(s, playerId);
  }

  // ── VALIDATE GO-OUT ──────────────────────────────────────
  function validateGoOut(hand, discardCardId, meldGroups, round) {
    const discardCard = hand.find(c => c.id === discardCardId);
    if (!discardCard) return { ok:false, err:'Discard card not found in hand' };
    const melds = meldGroups.map(group => group.map(id => hand.find(c => c.id === id)).filter(Boolean));
    const meldCardIds = new Set(melds.flat().map(c => c.id));
    if (meldCardIds.has(discardCardId)) return { ok:false, err:'Discard card cannot be in a meld' };
    const allUsed = new Set([...meldCardIds, discardCardId]);
    for (const c of hand) if (!allUsed.has(c.id)) return { ok:false, err:'All cards must be in a meld or discarded' };
    for (let i = 0; i < melds.length; i++) {
      if (melds[i].length < 3) return { ok:false, err:`Group ${i+1} needs at least 3 cards` };
      if (!isValidMeld(melds[i], round)) return { ok:false, err:`Group ${i+1} is not a valid book or run` };
    }
    return { ok:true, melds, discard: discardCard };
  }

  // ── GO OUT ───────────────────────────────────────────────
  function goOut(s, playerId, discardCardId, meldGroups) {
    const p = getPlayer(s, playerId);
    if (!p) return { ok:false, err:'Player not found' };
    if (!isPlayerTurn(s, playerId)) return { ok:false, err:'Not your turn' };
    if (s.phase !== 'discard') return { ok:false, err:'Must draw first' };

    const validation = validateGoOut(p.hand, discardCardId, meldGroups, s.round);
    if (!validation.ok) return { ok:false, err:validation.err };

    const cardIdx = p.hand.findIndex(c => c.id === discardCardId);
    p.hand.splice(cardIdx, 1);
    s.discardPile.push(validation.discard);

    p.wentOut = true;
    p.lastRoundMeld = validation.melds;
    p.revealedMelds = validation.melds;
    p.revealedLeftover = [];  // went out = no leftover points

    s.goingOutPlayerId = playerId;
    s.roundWinner = playerId;
    s.phase = 'going-out';

    const n = s.players.length;
    s.finalTurnsLeft = n - 1;
    s.turnIdx = (s.turnIdx + 1) % n;
    s.drawnThisTurn = false;

    if (s.finalTurnsLeft === 0) return endRound(s);
    return { ok:true, action:'going-out', melds:validation.melds, discardCard:validation.discard, playerName:p.name };
  }

  // ── FINAL TURN LAY-DOWN ──────────────────────────────────
  // A non-going-out player, on their final turn, manually groups melds and
  // discards one card. Only the unmelded leftover counts as points.
  // meldGroups: array of arrays of card IDs. discardCardId: the card to discard.
  function finalTurnLayDown(s, playerId, discardCardId, meldGroups) {
    const p = getPlayer(s, playerId);
    if (!p) return { ok:false, err:'Player not found' };
    if (!isPlayerTurn(s, playerId)) return { ok:false, err:'Not your turn' };
    if (s.phase !== 'going-out') return { ok:false, err:'Not a final turn' };
    if (!s.drawnThisTurn) return { ok:false, err:'Draw a card first on your final turn' };

    const discardCard = p.hand.find(c => c.id === discardCardId);
    if (!discardCard) return { ok:false, err:'Discard card not found in hand' };

    // Build and validate the melds the player chose (each must be a legal book/run of 3+)
    const groups = (meldGroups || []).map(g => g.map(id => p.hand.find(c => c.id === id)).filter(Boolean));
    const meldCardIds = new Set(groups.flat().map(c => c.id));
    if (meldCardIds.has(discardCardId)) return { ok:false, err:'Discard cannot be in a meld' };
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].length > 0 && groups[i].length < 3) return { ok:false, err:`Group ${i+1} needs at least 3 cards` };
      if (groups[i].length >= 3 && !isValidMeld(groups[i], s.round)) return { ok:false, err:`Group ${i+1} is not a valid book or run` };
    }

    // Remove the discard from hand and place on pile
    const idx = p.hand.findIndex(c => c.id === discardCardId);
    p.hand.splice(idx, 1);
    s.discardPile.push(discardCard);

    // Leftover = everything still in hand that is NOT in a valid meld group
    const validMelds = groups.filter(g => g.length >= 3 && isValidMeld(g, s.round));
    const meldedIds = new Set(validMelds.flat().map(c => c.id));
    const leftover = p.hand.filter(c => !meldedIds.has(c.id));

    p.revealedMelds = validMelds;
    p.revealedLeftover = leftover;
    p.revealedLeftoverRound = s.round;
    // Store the chosen leftover so endRound scores exactly this (not the whole hand)
    p.finalScoreCards = leftover;

    return advanceTurn(s, playerId);
  }

  function advanceTurn(s, playerId) {
    const n = s.players.length;
    if (s.phase === 'going-out') {
      s.finalTurnsLeft--;
      if (s.finalTurnsLeft <= 0) return endRound(s);
    }
    s.turnIdx = (s.turnIdx + 1) % n;
    s.drawnThisTurn = false;
    s.phase = s.phase === 'going-out' ? 'going-out' : 'draw';
    return { ok:true, action:'next-turn' };
  }

  // ── ROUND END ────────────────────────────────────────────
  function endRound(s) {
    s.phase = 'round-end';
    const results = s.players.map(p => {
      let roundScore = 0;
      if (p.wentOut) {
        roundScore = 0;
      } else if (p.finalScoreCards) {
        // Player manually laid down melds on their final turn — score ONLY
        // the unmelded leftover they chose. Fully melded = 0 points.
        roundScore = handScore(p.finalScoreCards, s.round);
      } else {
        // Fallback (player never got a final turn / disconnected): score whole hand
        roundScore = handScore(p.hand, s.round);
        if (!p.revealedLeftover) {
          p.revealedLeftover = [...p.hand];
          if (!p.revealedMelds) p.revealedMelds = [];
        }
      }
      p.score += roundScore;
      p.roundScores.push(roundScore);
      p.lastRoundScore = roundScore;  // stash for panel display
      return { playerId:p.id, name:p.name, roundScore, totalScore:p.score };
    });

    if (s.round >= 11) {
      s.phase = 'game-over';
      const winner = s.players.reduce((a,b) => a.score <= b.score ? a : b);
      s.winner = winner.id;
      return { ok:true, action:'game-over', results, winner:winner.id, winnerName:winner.name };
    }
    return { ok:true, action:'round-end', results };
  }

  function nextRound(s) {
    s.round++;
    s.dealerIdx = (s.dealerIdx + 1) % s.players.length;
    dealRound(s);
    return { ok:true, action:'round-start' };
  }

  // ── HELPERS ─────────────────────────────────────────────
  function reshuffleDiscard(s) {
    if (s.discardPile.length <= 1) return false;
    const top = s.discardPile.pop();
    s.drawPile = shuffleDeck(s.discardPile);
    s.discardPile = [top];
    return true;
  }
  function getPlayer(s, id) { return s.players.find(p => p.id === id) || null; }
  function isPlayerTurn(s, id) { return s.players[s.turnIdx]?.id === id; }

  function getPublicState(s, forPlayerId) {
    return {
      phase: s.phase, round: s.round, turnIdx: s.turnIdx,
      dealerIdx: s.dealerIdx, goingOutPlayerId: s.goingOutPlayerId,
      finalTurnsLeft: s.finalTurnsLeft, drawnThisTurn: s.drawnThisTurn,
      roundWinner: s.roundWinner, winner: s.winner || null,
      drawPileCount: s.drawPile.length,
      discardTop: s.discardPile[s.discardPile.length - 1] || null,
      players: s.players.map(p => ({
        id: p.id, name: p.name, avatar: p.avatar,
        handCount: p.hand.length, score: p.score,
        roundScores: p.roundScores, wentOut: p.wentOut,
        revealedMelds: p.revealedMelds || null,
        revealedLeftover: p.revealedLeftover || null,
        roundScore: p.lastRoundScore,
        roundForScore: s.round,
        hand: p.id === forPlayerId ? p.hand : null,
      })),
    };
  }

  return {
    fresh, get, set, dealRound,
    drawFromDeck, drawFromDiscard, discardCard,
    goOut, validateGoOut, finalTurnLayDown, nextRound, endRound,
    getPlayer, isPlayerTurn, getPublicState,
  };
})();
