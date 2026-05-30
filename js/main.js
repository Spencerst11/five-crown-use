// ============================================================
// main.js — App Controller for Five Crowns
// ============================================================

// ── SCREEN MANAGEMENT ────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');
  window.scrollTo(0, 0);
}

// ── LOCAL STATE ───────────────────────────────────────────────

let _selectedCards = new Set();    // card IDs selected in hand
let _currentPublicState = null;    // latest state snapshot
let _pendingGoOut = false;

// ── ROOM CREATION ─────────────────────────────────────────────

function createRoom() {
  const name = document.getElementById('create-name').value.trim();
  const roomName = document.getElementById('create-room-name').value.trim();
  const maxPlayers = parseInt(document.getElementById('create-players').value);

  if (!name) { UI.showToast('Please enter your name.'); return; }

  showScreen('screen-lobby');
  document.getElementById('lobby-room-code').textContent = '…';
  document.getElementById('lobby-host-controls').style.display = 'none';

  const code = Network.createRoom(name, maxPlayers, {
    onStateUpdate: handleStateUpdate,
    onLobbyUpdate: handleLobbyUpdate,
    onMessage: (msg) => UI.showToast(msg),
    onError: (err) => { UI.showToast('⚠️ ' + err, 4000); console.error(err); },
  });

  document.getElementById('lobby-room-code').textContent = code;
  document.getElementById('lobby-host-controls').style.display = 'block';
}

function joinRoom() {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();

  if (!name) { UI.showToast('Please enter your name.'); return; }
  if (code.length < 4) { UI.showToast('Please enter a valid room code (4 characters).'); return; }

  showScreen('screen-lobby');
  document.getElementById('lobby-room-code').textContent = code;
  document.getElementById('lobby-host-controls').style.display = 'none';

  Network.joinRoom(name, code, {
    onStateUpdate: handleStateUpdate,
    onLobbyUpdate: handleLobbyUpdate,
    onMessage: (msg) => UI.showToast(msg),
    onError: (err) => { UI.showToast('⚠️ ' + err, 4000); console.error(err); },
  });
}

function copyRoomCode() {
  const code = document.getElementById('lobby-room-code').textContent;
  navigator.clipboard.writeText(code).then(() => {
    UI.showToast('Room code copied! Share it with family.');
  }).catch(() => {
    // Fallback: show code prominently
    UI.showToast(`Room code: ${code}`, 4000);
  });
}

function hostStartGame() {
  Network.hostStartGame();
}

function leaveRoom() {
  Network.destroy();
  _selectedCards.clear();
  _currentPublicState = null;
  showScreen('screen-main-menu');
}

// ── LOBBY HANDLER ─────────────────────────────────────────────

function handleLobbyUpdate(players) {
  const localId = Network.getLocalPlayerId();
  const maxPlayers = Network.getExpectedPlayers();
  UI.renderLobby(players, localId, maxPlayers);
}

// ── GAME STATE HANDLER ────────────────────────────────────────

function handleStateUpdate(publicState, result) {
  _currentPublicState = publicState;
  const localId = Network.getLocalPlayerId();
  const { action } = result || {};

  // Navigate to correct screen
  if (publicState.phase === 'game-over') {
    _renderGameTable(publicState); // still update table for a moment
    setTimeout(() => {
      // Build final results from player data
      const results = publicState.players.map(p => ({
        playerId: p.id,
        name: p.name,
        totalScore: p.score,
        roundScore: p.roundScores[p.roundScores.length - 1] || 0,
      }));
      UI.renderGameOver(results, publicState.winner, _getPlayerName(publicState, publicState.winner));
      showScreen('screen-game-over');
    }, 800);
    return;
  }

  if (publicState.phase === 'round-end') {
    _renderGameTable(publicState);
    setTimeout(() => {
      // Build results array from players
      const results = publicState.players.map(p => ({
        playerId: p.id,
        name: p.name,
        roundScore: p.roundScores[p.roundScores.length - 1] || 0,
        totalScore: p.score,
      }));
      UI.renderRoundResults(results, publicState.round, false, Network.getIsHost());
      showScreen('screen-round-results');
    }, 600);
    return;
  }

  // Show game table
  if (document.getElementById('screen-game').classList.contains('active') === false &&
      (publicState.phase === 'draw' || publicState.phase === 'discard' || publicState.phase === 'going-out')) {
    showScreen('screen-game');
  }

  _renderGameTable(publicState);

  // Show toast for game events
  if (action === 'round-start') {
    const wildLabel = getWildLabel(publicState.round);
    UI.showToast(`Round ${publicState.round} begins! Wild: ${wildLabel}`, 3000);
    _selectedCards.clear();
  } else if (action === 'going-out') {
    const goingOutName = _getPlayerName(publicState, publicState.goingOutPlayerId);
    const isMe = publicState.goingOutPlayerId === localId;
    UI.showToast(isMe ? 'You went out! Everyone gets one more turn.' : `${goingOutName} went out! Last turn for everyone.`, 3500);
  } else if (action === 'next-turn') {
    // Who's turn is it?
    const turnPlayer = publicState.players[publicState.turnIdx];
    const isMyTurn = turnPlayer?.id === localId;
    if (isMyTurn) UI.showToast('Your turn!', 1500);
  }
}

function _getPlayerName(publicState, id) {
  return publicState.players.find(p => p.id === id)?.name || 'Unknown';
}

// ── RENDER GAME TABLE ─────────────────────────────────────────

function _renderGameTable(s) {
  const localId = Network.getLocalPlayerId();
  const localPlayer = s.players.find(p => p.id === localId);
  const currentTurnPlayer = s.players[s.turnIdx];
  const isMyTurn = currentTurnPlayer?.id === localId;

  // Header
  UI.updateHeader(s.round, s.phase, s.drawnThisTurn);

  // Opponents
  UI.renderOpponents(s.players, localId, currentTurnPlayer?.id);

  // Draw pile
  UI.updateDrawPile(s.drawPileCount, isMyTurn, s.phase, !s.drawnThisTurn);

  // Discard
  UI.renderDiscardTop(s.discardTop, s.round);

  // Player name
  document.getElementById('player-name-display').textContent = Network.getLocalPlayerName();

  // Turn indicator & go-out button
  UI.updateTurnIndicator(isMyTurn, s.phase);

  // Hand
  if (localPlayer?.hand) {
    UI.renderHand(localPlayer.hand, s.round, _selectedCards, handleCardClick);
  }

  // Action log
  if (currentTurnPlayer) {
    const isMe = currentTurnPlayer.id === localId;
    const name = isMe ? 'You' : currentTurnPlayer.name;
    let msg = '';
    if (s.phase === 'draw') msg = `${name} ${isMe ? 'need to' : 'needs to'} draw a card.`;
    else if (s.phase === 'discard') msg = `${name} ${isMe ? 'need to' : 'needs to'} discard.`;
    else if (s.phase === 'going-out') {
      const goerName = _getPlayerName(s, s.goingOutPlayerId);
      msg = `${goerName} went out! Final turns remaining: ${s.finalTurnsLeft}`;
    }
    UI.logAction(msg);
  }
}

// ── CARD INTERACTION ──────────────────────────────────────────

function handleCardClick(card, el) {
  const s = _currentPublicState;
  if (!s) return;
  const localId = Network.getLocalPlayerId();
  const isMyTurn = s.players[s.turnIdx]?.id === localId;

  if (!isMyTurn) { UI.showToast("It's not your turn yet."); return; }
  if (s.phase !== 'discard' && s.phase !== 'going-out') {
    UI.showToast('Draw a card first!'); return;
  }

  // Toggle selection
  if (_selectedCards.has(card.id)) {
    _selectedCards.delete(card.id);
  } else {
    _selectedCards.clear(); // single-card selection for discard
    _selectedCards.add(card.id);
  }

  // Re-render hand
  const localPlayer = s.players.find(p => p.id === localId);
  if (localPlayer?.hand) {
    UI.renderHand(localPlayer.hand, s.round, _selectedCards, handleCardClick);
  }

  // If one card selected, auto-prompt discard
  if (_selectedCards.size === 1) {
    const selectedId = [..._selectedCards][0];
    UI.showToast('Tap the card again or click the discard pile to discard it.', 2000);
  }
}

// ── DRAW ACTIONS ─────────────────────────────────────────────

function drawFromDeck() {
  const s = _currentPublicState;
  if (!s) return;
  const localId = Network.getLocalPlayerId();
  const isMyTurn = s.players[s.turnIdx]?.id === localId;
  if (!isMyTurn) { UI.showToast("It's not your turn!"); return; }
  if (s.phase !== 'draw') { UI.showToast('You already drew a card.'); return; }
  Network.sendAction({ type: 'draw-deck' });
}

function drawFromDiscard() {
  const s = _currentPublicState;
  if (!s) return;
  const localId = Network.getLocalPlayerId();
  const isMyTurn = s.players[s.turnIdx]?.id === localId;
  if (!isMyTurn) { UI.showToast("It's not your turn!"); return; }

  if (s.phase === 'draw') {
    // Draw from discard
    if (!s.discardTop) { UI.showToast('Discard pile is empty.'); return; }
    Network.sendAction({ type: 'draw-discard' });
    return;
  }

  if (s.phase === 'discard' || s.phase === 'going-out') {
    // Discard selected card
    if (_selectedCards.size === 0) {
      UI.showToast('Select a card from your hand first, then tap the discard pile.');
      return;
    }
    const cardId = [..._selectedCards][0];
    _selectedCards.clear();
    Network.sendAction({ type: 'discard', cardId });
    return;
  }
}

// ── GO OUT ────────────────────────────────────────────────────

function goOut() {
  const s = _currentPublicState;
  if (!s) return;
  const localId = Network.getLocalPlayerId();
  const localPlayer = s.players.find(p => p.id === localId);
  if (!localPlayer?.hand) return;

  const isMyTurn = s.players[s.turnIdx]?.id === localId;
  if (!isMyTurn) { UI.showToast("It's not your turn!"); return; }
  if (s.phase !== 'discard') { UI.showToast('You must draw a card first.'); return; }

  // Check if can go out
  const meldResult = tryMeld(localPlayer.hand, s.round);
  if (!meldResult.canGoOut) {
    UI.showToast("Can't go out yet — hand can't be fully melded into books/runs.", 3000);
    return;
  }

  // Show confirmation modal
  _pendingGoOut = true;
  document.getElementById('goout-modal').classList.remove('hidden');

  // Preview melds
  const preview = document.getElementById('goout-hand-preview');
  preview.innerHTML = '';
  const meldInfo = document.createElement('div');
  meldInfo.style.cssText = 'font-size:0.85rem;color:#a0c0a0;margin-bottom:0.5rem;';
  meldInfo.textContent = `${meldResult.melds.length} meld(s) formed. Discard: ${getCardLabel(meldResult.discard)}`;
  preview.appendChild(meldInfo);
}

function confirmGoOut() {
  document.getElementById('goout-modal').classList.add('hidden');
  if (_pendingGoOut) {
    _pendingGoOut = false;
    Network.sendAction({ type: 'go-out' });
  }
}

function cancelGoOut() {
  document.getElementById('goout-modal').classList.add('hidden');
  _pendingGoOut = false;
}

// ── SORT HAND ─────────────────────────────────────────────────

function sortHand() {
  const s = _currentPublicState;
  if (!s) return;
  const localId = Network.getLocalPlayerId();
  const localPlayer = s.players.find(p => p.id === localId);
  if (!localPlayer?.hand) return;

  // Sort: wilds first, then by suit, then by rank
  const round = s.round;
  localPlayer.hand.sort((a, b) => {
    const aW = isWild(a, round) ? 0 : 1;
    const bW = isWild(b, round) ? 0 : 1;
    if (aW !== bW) return aW - bW;
    if (a.suit !== b.suit) return (a.suit || 'zzz').localeCompare(b.suit || 'zzz');
    return a.rank - b.rank;
  });

  UI.renderHand(localPlayer.hand, round, _selectedCards, handleCardClick);
}

// ── NEXT ROUND ────────────────────────────────────────────────

function nextRound() {
  const s = _currentPublicState;
  if (s && s.phase === 'game-over') {
    showScreen('screen-main-menu');
    return;
  }
  if (Network.getIsHost()) {
    Network.sendAction({ type: 'next-round' });
  }
}

// ── SCOREBOARD ────────────────────────────────────────────────

function toggleScoreboard() {
  const overlay = document.getElementById('scoreboard-overlay');
  const isHidden = overlay.classList.contains('hidden');
  if (isHidden && _currentPublicState) {
    UI.renderScoreboard(_currentPublicState.players, _currentPublicState.round);
  }
  overlay.classList.toggle('hidden');
}

// ── KEYBOARD SHORTCUTS ────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.getElementById('scoreboard-overlay').classList.add('hidden');
    document.getElementById('goout-modal').classList.add('hidden');
  }
  if (e.key === 's' && document.getElementById('screen-game').classList.contains('active')) {
    toggleScoreboard();
  }
});

// ── BOOT ──────────────────────────────────────────────────────

window.addEventListener('load', () => {
  showScreen('screen-splash');
  console.log('Five Crowns loaded ♛');
});
