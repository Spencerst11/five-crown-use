// ============================================================
// main.js — App Controller for Five Crowns (v2)
// ============================================================

// ── SCREEN MANAGEMENT ────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');
  window.scrollTo(0, 0);
}

// ── LOCAL STATE ───────────────────────────────────────────────

let _selectedCards   = new Set();
let _currentPublicState = null;
let _pendingGoOut    = false;
let _localHand       = [];  // local copy for drag reorder (not authoritative)
let _dealAnimating   = false;

// ── AVATAR SELECTION ─────────────────────────────────────────
// Separate state for create vs join forms

let _createAvatar = { animal: 'none', color: 'gold' };
let _joinAvatar   = { animal: 'none', color: 'gold' };

const COLOR_NAMES = {
  red: 'Red', pink: 'Berry Pink', periwinkle: 'Periwinkle',
  sage: 'Sage', orange: 'Orange', gold: 'Gold',
};
const ANIMAL_NAMES = {
  '🐧': 'Penguin', '🐉': 'Dragon', '🦫': 'Capybara',
  '🐢': 'Turtle', '🦕': 'Dinosaur', '🐩': 'Poodle', 'none': 'None',
};

function _refreshAvatarPreview(prefix, avatar) {
  const previewEl = document.getElementById(`${prefix}-avatar-preview`);
  const labelEl   = document.getElementById(`${prefix}-avatar-label`);
  if (!previewEl) return;

  const colorMap = {
    red:'#e53e3e', pink:'#d53f8c', periwinkle:'#7b8cde',
    sage:'#68a57a', orange:'#ed8936', gold:'#d4a017',
  };
  previewEl.style.background = colorMap[avatar.color] || colorMap.gold;
  previewEl.textContent = avatar.animal === 'none' ? '' : avatar.animal;

  const animalLabel = ANIMAL_NAMES[avatar.animal] || 'None';
  const colorLabel  = COLOR_NAMES[avatar.color]   || 'Gold';
  labelEl.textContent = avatar.animal === 'none'
    ? `No Avatar · ${colorLabel}`
    : `${animalLabel} · ${colorLabel}`;
}

function selectAnimal(el, animal) {
  document.querySelectorAll('#create-avatar-picker .avatar-opt').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  _createAvatar.animal = animal;
  _refreshAvatarPreview('create', _createAvatar);
}

function selectColor(el, color) {
  document.querySelectorAll('#create-avatar-picker .color-opt').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  _createAvatar.color = color;
  _refreshAvatarPreview('create', _createAvatar);
}

function selectAnimalJoin(el, animal) {
  document.querySelectorAll('#join-avatar-picker .avatar-opt').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  _joinAvatar.animal = animal;
  _refreshAvatarPreview('join', _joinAvatar);
}

function selectColorJoin(el, color) {
  document.querySelectorAll('#join-avatar-picker .color-opt').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  _joinAvatar.color = color;
  _refreshAvatarPreview('join', _joinAvatar);
}

// ── ROOM CREATION ─────────────────────────────────────────────

function createRoom() {
  const name = document.getElementById('create-name').value.trim();
  const maxPlayers = parseInt(document.getElementById('create-players').value);

  if (!name) { UI.showToast('Please enter your name.'); return; }

  showScreen('screen-lobby');
  document.getElementById('lobby-room-code').textContent = '…';
  document.getElementById('lobby-host-controls').style.display = 'none';

  const code = Network.createRoom(name, maxPlayers, _createAvatar, {
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

  Network.joinRoom(name, code, _joinAvatar, {
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
    UI.showToast(`Room code: ${code}`, 4000);
  });
}

function hostStartGame() { Network.hostStartGame(); }

function leaveRoom() {
  Network.destroy();
  _selectedCards.clear();
  _currentPublicState = null;
  _localHand = [];
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

  // Sync local hand from authoritative state
  const localPlayer = publicState.players.find(p => p.id === localId);
  if (localPlayer?.hand) {
    // Preserve drag-reorder if same cards (just reordered locally)
    if (_localHand.length === localPlayer.hand.length &&
        _localHand.every(c => localPlayer.hand.some(h => h.id === c.id))) {
      // Keep local order — user may have dragged
    } else {
      _localHand = [...localPlayer.hand];
    }
  }

  // Navigate to correct screen
  if (publicState.phase === 'game-over') {
    _renderGameTable(publicState);
    setTimeout(() => {
      const results = publicState.players.map(p => ({
        playerId: p.id, name: p.name,
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
      const results = publicState.players.map(p => ({
        playerId: p.id, name: p.name,
        roundScore: p.roundScores[p.roundScores.length - 1] || 0,
        totalScore: p.score,
      }));
      UI.renderRoundResults(results, publicState.round, false, Network.getIsHost());
      showScreen('screen-round-results');
    }, 600);
    return;
  }

  // Show game table
  const gameScreen = document.getElementById('screen-game');
  if (!gameScreen.classList.contains('active') &&
      ['draw','discard','going-out'].includes(publicState.phase)) {
    showScreen('screen-game');
  }

  // Deal animation on round start
  if (action === 'round-start' && localPlayer?.hand) {
    _dealAnimating = true;
    _selectedCards.clear();
    const handSize = publicState.round + 2;
    UI.playDealAnimation(handSize, () => {
      _dealAnimating = false;
      _renderGameTable(publicState);
    });
    // Render table behind animation immediately
    _renderGameTable(publicState);
    UI.showToast(`Round ${publicState.round} of 11 begins!`, 2500);
    return;
  }

  // Draw animation
  if (action === 'draw-deck' || action === 'draw-discard') {
    UI.animateDraw(action === 'draw-discard');
  }

  _renderGameTable(publicState);

  // Toasts for events
  if (action === 'going-out') {
    const goingOutName = _getPlayerName(publicState, publicState.goingOutPlayerId);
    const isMe = publicState.goingOutPlayerId === localId;
    UI.showToast(
      isMe
        ? 'You went out! Everyone gets one more turn.'
        : `${goingOutName} went out! See their cards above. Last turn for everyone.`,
      4000
    );
  } else if (action === 'next-turn') {
    const turnPlayer = publicState.players[publicState.turnIdx];
    if (turnPlayer?.id === localId) UI.showToast('Your turn!', 1500);
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

  UI.updateHeader(s.round, s.phase, s.drawnThisTurn);
  UI.renderOpponents(s.players, localId, currentTurnPlayer?.id);
  UI.updateDrawPile(s.drawPileCount, isMyTurn, s.phase);
  UI.renderDiscardTop(s.discardTop, s.round);

  // Gone-out display
  UI.renderGoneOutDisplay(s.players, localId);

  document.getElementById('player-name-display').textContent = Network.getLocalPlayerName();
  UI.updateTurnIndicator(isMyTurn, s.phase);

  // Render hand using local order (supports drag reorder)
  if (_localHand.length > 0) {
    UI.renderHand(_localHand, s.round, _selectedCards, handleCardClick, handleCardReorder);
  } else if (localPlayer?.hand) {
    UI.renderHand(localPlayer.hand, s.round, _selectedCards, handleCardClick, handleCardReorder);
  }

  // Action log
  if (currentTurnPlayer) {
    const isMe = currentTurnPlayer.id === localId;
    const name = isMe ? 'You' : currentTurnPlayer.name;
    let msg = '';
    if (s.phase === 'draw') msg = `${name} ${isMe ? 'need to' : 'needs to'} draw a card.`;
    else if (s.phase === 'discard') msg = `${name} ${isMe ? 'need to' : 'needs to'} discard.`;
    else if (s.phase === 'going-out') {
      msg = `${_getPlayerName(s, s.goingOutPlayerId)} went out! Final turns: ${s.finalTurnsLeft}`;
    }
    UI.logAction(msg);
  }
}

// ── CARD DRAG REORDER ─────────────────────────────────────────
// Purely local — does not send to network. Just reorders _localHand.

function handleCardReorder(fromIdx, toIdx) {
  if (fromIdx === toIdx) return;
  if (fromIdx < 0 || toIdx < 0 || fromIdx >= _localHand.length || toIdx >= _localHand.length) return;

  const moved = _localHand.splice(fromIdx, 1)[0];
  _localHand.splice(toIdx, 0, moved);

  // Re-render with new order
  const s = _currentPublicState;
  if (s) UI.renderHand(_localHand, s.round, _selectedCards, handleCardClick, handleCardReorder);
}

// ── CARD CLICK (select to discard) ───────────────────────────

function handleCardClick(card, el) {
  const s = _currentPublicState;
  if (!s) return;
  const localId = Network.getLocalPlayerId();
  const isMyTurn = s.players[s.turnIdx]?.id === localId;

  if (!isMyTurn) { UI.showToast("It's not your turn yet."); return; }
  if (s.phase !== 'discard' && s.phase !== 'going-out') {
    UI.showToast('Draw a card first!'); return;
  }

  if (_selectedCards.has(card.id)) {
    _selectedCards.delete(card.id);
  } else {
    _selectedCards.clear();
    _selectedCards.add(card.id);
  }

  UI.renderHand(_localHand, s.round, _selectedCards, handleCardClick, handleCardReorder);

  if (_selectedCards.size === 1) {
    UI.showToast('Tap discard pile to discard this card.', 2000);
  }
}

// ── DRAW ACTIONS ─────────────────────────────────────────────

function drawFromDeck() {
  const s = _currentPublicState;
  if (!s) return;
  const localId = Network.getLocalPlayerId();
  if (s.players[s.turnIdx]?.id !== localId) { UI.showToast("It's not your turn!"); return; }
  if (s.phase !== 'draw') { UI.showToast('You already drew a card.'); return; }
  Network.sendAction({ type: 'draw-deck' });
}

function drawFromDiscard() {
  const s = _currentPublicState;
  if (!s) return;
  const localId = Network.getLocalPlayerId();
  if (s.players[s.turnIdx]?.id !== localId) { UI.showToast("It's not your turn!"); return; }

  if (s.phase === 'draw') {
    if (!s.discardTop) { UI.showToast('Discard pile is empty.'); return; }
    Network.sendAction({ type: 'draw-discard' });
    return;
  }

  if (s.phase === 'discard' || s.phase === 'going-out') {
    if (_selectedCards.size === 0) {
      UI.showToast('Select a card from your hand first, then tap the discard pile.');
      return;
    }
    const cardId = [..._selectedCards][0];
    _selectedCards.clear();
    Network.sendAction({ type: 'discard', cardId });
  }
}

// ── GO OUT ────────────────────────────────────────────────────

function goOut() {
  const s = _currentPublicState;
  if (!s) return;
  const localId = Network.getLocalPlayerId();
  if (s.players[s.turnIdx]?.id !== localId) { UI.showToast("It's not your turn!"); return; }
  if (s.phase !== 'discard') { UI.showToast('You must draw a card first.'); return; }

  const meldResult = tryMeld(_localHand, s.round);
  if (!meldResult.canGoOut) {
    UI.showToast("Can't go out yet — hand can't be fully melded into books/runs.", 3000);
    return;
  }

  _pendingGoOut = true;
  document.getElementById('goout-modal').classList.remove('hidden');

  const preview = document.getElementById('goout-hand-preview');
  preview.innerHTML = '';
  const info = document.createElement('div');
  info.style.cssText = 'font-size:.85rem;color:#a0c0a0;margin-bottom:.5rem;';
  info.textContent = `${meldResult.melds.length} meld(s) formed. Will discard: ${getCardLabel(meldResult.discard)}`;
  preview.appendChild(info);
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
  if (!s || _localHand.length === 0) return;
  const round = s.round;

  _localHand.sort((a, b) => {
    // Jokers first, then by suit, then by rank
    if (a.rank === 0 && b.rank !== 0) return -1;
    if (b.rank === 0 && a.rank !== 0) return 1;
    if (a.suit !== b.suit) return (a.suit || 'zzz').localeCompare(b.suit || 'zzz');
    return a.rank - b.rank;
  });

  UI.renderHand(_localHand, round, _selectedCards, handleCardClick, handleCardReorder);
}

// ── NEXT ROUND ────────────────────────────────────────────────

function nextRound() {
  const s = _currentPublicState;
  if (s && s.phase === 'game-over') { showScreen('screen-main-menu'); return; }
  if (Network.getIsHost()) Network.sendAction({ type: 'next-round' });
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
  // Init avatar previews
  _refreshAvatarPreview('create', _createAvatar);
  _refreshAvatarPreview('join',   _joinAvatar);
  console.log('Five Crowns v2 loaded ♛');
});
