// ============================================================
// main.js — App Controller for Five Crowns (v3)
// Changes:
//   - Manual go-out: player groups cards into melds, picks discard
//   - Final-turn players must draw then discard
//   - Full responsive / mobile-friendly touch support
// ============================================================

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');
  window.scrollTo(0, 0);
}

// ── LOCAL STATE ───────────────────────────────────────────────
let _selectedCards      = new Set();
let _currentPublicState = null;
let _pendingGoOut       = false;
let _localHand          = [];
let _dealAnimating      = false;

// Go-out builder state
let _goOutMeldGroups    = [];   // array of Set(cardId)
let _goOutDiscardId     = null; // single card chosen as discard
let _goOutMode          = false;

// ── AVATAR SELECTION ─────────────────────────────────────────
let _createAvatar = { animal: 'none', color: 'gold' };
let _joinAvatar   = { animal: 'none', color: 'gold' };

const COLOR_NAMES  = { red:'Red', pink:'Berry Pink', periwinkle:'Periwinkle', sage:'Sage', orange:'Orange', gold:'Gold' };
const ANIMAL_NAMES = { '🐧':'Penguin','🐉':'Dragon','🦫':'Capybara','🐢':'Turtle','🦕':'Dinosaur','🐩':'Poodle','none':'None' };

function _refreshAvatarPreview(prefix, avatar) {
  const previewEl = document.getElementById(`${prefix}-avatar-preview`);
  const labelEl   = document.getElementById(`${prefix}-avatar-label`);
  if (!previewEl) return;
  const colorMap = { red:'#e53e3e',pink:'#d53f8c',periwinkle:'#7b8cde',sage:'#68a57a',orange:'#ed8936',gold:'#d4a017' };
  previewEl.style.background = colorMap[avatar.color] || colorMap.gold;
  previewEl.textContent = avatar.animal === 'none' ? '' : avatar.animal;
  const animalLabel = ANIMAL_NAMES[avatar.animal] || 'None';
  const colorLabel  = COLOR_NAMES[avatar.color]   || 'Gold';
  labelEl.textContent = avatar.animal === 'none' ? `No Avatar · ${colorLabel}` : `${animalLabel} · ${colorLabel}`;
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
  }).catch(() => { UI.showToast(`Room code: ${code}`, 4000); });
}

function hostStartGame() { Network.hostStartGame(); }

function leaveRoom() {
  Network.destroy();
  _selectedCards.clear();
  _currentPublicState = null;
  _localHand = [];
  _exitGoOutMode();
  showScreen('screen-main-menu');
}

// ── LOBBY HANDLER ─────────────────────────────────────────────
function handleLobbyUpdate(players) {
  UI.renderLobby(players, Network.getLocalPlayerId(), Network.getExpectedPlayers());
}

// ── GAME STATE HANDLER ────────────────────────────────────────
function handleStateUpdate(publicState, result) {
  _currentPublicState = publicState;
  const localId = Network.getLocalPlayerId();
  const { action } = result || {};

  const localPlayer = publicState.players.find(p => p.id === localId);
  if (localPlayer?.hand) {
    if (_localHand.length === localPlayer.hand.length &&
        _localHand.every(c => localPlayer.hand.some(h => h.id === c.id))) {
      // preserve local drag order
    } else {
      _localHand = [...localPlayer.hand];
    }
  }

  if (publicState.phase === 'game-over') {
    _exitGoOutMode();
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
    _exitGoOutMode();
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

  const gameScreen = document.getElementById('screen-game');
  if (!gameScreen.classList.contains('active') &&
      ['draw','discard','going-out'].includes(publicState.phase)) {
    showScreen('screen-game');
  }

  if (action === 'round-start' && localPlayer?.hand) {
    _exitGoOutMode();
    _selectedCards.clear();
    const handSize = publicState.round + 2;
    UI.playDealAnimation(handSize, () => {
      _dealAnimating = false;
      _renderGameTable(publicState);
    });
    _renderGameTable(publicState);
    UI.showToast(`Round ${publicState.round} of 11 begins!`, 2500);
    return;
  }

  if (action === 'draw-deck' || action === 'draw-discard') {
    UI.animateDraw(action === 'draw-discard');
  }

  // If player just drew and was in going-out mode, exit it
  if ((action === 'draw-deck' || action === 'draw-discard') && _goOutMode) {
    _exitGoOutMode();
  }

  _renderGameTable(publicState);

  if (action === 'going-out') {
    const goingOutName = _getPlayerName(publicState, publicState.goingOutPlayerId);
    const isMe = publicState.goingOutPlayerId === localId;
    UI.showToast(
      isMe
        ? 'You went out! Everyone gets one more turn.'
        : `${goingOutName} went out! See their melds above. Draw then discard on your final turn.`,
      4500
    );
  } else if (action === 'next-turn') {
    const turnPlayer = publicState.players[publicState.turnIdx];
    if (turnPlayer?.id === localId) {
      if (publicState.phase === 'going-out') {
        UI.showToast('Your final turn! Draw a card, then discard one.', 3000);
      } else {
        UI.showToast('Your turn!', 1500);
      }
    }
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
  UI.updateDrawPile(s.drawPileCount, isMyTurn, s.phase, s.drawnThisTurn);
  UI.renderDiscardTop(s.discardTop, s.round);
  UI.renderGoneOutDisplay(s.players, localId);

  document.getElementById('player-name-display').textContent = Network.getLocalPlayerName();
  UI.updateTurnIndicator(isMyTurn, s.phase, s.drawnThisTurn);

  // Render hand — in go-out mode use special builder render
  if (_goOutMode) {
    UI.renderGoOutBuilder(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId,
      handleGoOutCardClick, handleCardReorder);
  } else if (_localHand.length > 0) {
    UI.renderHand(_localHand, s.round, _selectedCards, handleCardClick, handleCardReorder);
  } else if (localPlayer?.hand) {
    UI.renderHand(localPlayer.hand, s.round, _selectedCards, handleCardClick, handleCardReorder);
  }

  // Action log
  if (currentTurnPlayer) {
    const isMe = currentTurnPlayer.id === localId;
    const name = isMe ? 'You' : currentTurnPlayer.name;
    let msg = '';
    if (s.phase === 'draw') {
      msg = `${name} ${isMe ? 'need to' : 'needs to'} draw a card.`;
    } else if (s.phase === 'discard') {
      msg = `${name} ${isMe ? 'need to' : 'needs to'} discard.`;
    } else if (s.phase === 'going-out') {
      if (!s.drawnThisTurn) {
        msg = `${name} ${isMe ? 'need to' : 'needs to'} draw one final card.`;
      } else {
        msg = `${name} ${isMe ? 'need to' : 'needs to'} discard one final card.`;
      }
    }
    UI.logAction(msg);
  }
}

// ── CARD REORDER (drag) ───────────────────────────────────────
function handleCardReorder(fromIdx, toIdx) {
  if (fromIdx === toIdx) return;
  if (fromIdx < 0 || toIdx < 0 || fromIdx >= _localHand.length || toIdx >= _localHand.length) return;
  const moved = _localHand.splice(fromIdx, 1)[0];
  _localHand.splice(toIdx, 0, moved);
  const s = _currentPublicState;
  if (!s) return;
  if (_goOutMode) {
    UI.renderGoOutBuilder(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId,
      handleGoOutCardClick, handleCardReorder);
  } else {
    UI.renderHand(_localHand, s.round, _selectedCards, handleCardClick, handleCardReorder);
  }
}

// ── NORMAL CARD CLICK ─────────────────────────────────────────
function handleCardClick(card, el) {
  const s = _currentPublicState;
  if (!s) return;
  const localId = Network.getLocalPlayerId();
  const isMyTurn = s.players[s.turnIdx]?.id === localId;

  if (!isMyTurn) { UI.showToast("It's not your turn yet."); return; }
  if (s.phase !== 'discard' && s.phase !== 'going-out') {
    UI.showToast('Draw a card first!'); return;
  }
  if (s.phase === 'going-out' && !s.drawnThisTurn) {
    UI.showToast('Draw a card first on your final turn!'); return;
  }

  if (_selectedCards.has(card.id)) {
    _selectedCards.delete(card.id);
  } else {
    _selectedCards.clear();
    _selectedCards.add(card.id);
  }

  UI.renderHand(_localHand, s.round, _selectedCards, handleCardClick, handleCardReorder);
  if (_selectedCards.size === 1) UI.showToast('Tap the discard pile to discard this card.', 2000);
}

// ── DRAW ACTIONS ─────────────────────────────────────────────
function drawFromDeck() {
  const s = _currentPublicState;
  if (!s) return;
  const localId = Network.getLocalPlayerId();
  if (s.players[s.turnIdx]?.id !== localId) { UI.showToast("It's not your turn!"); return; }
  const canDraw = s.phase === 'draw' || (s.phase === 'going-out' && !s.drawnThisTurn);
  if (!canDraw) { UI.showToast('You already drew a card.'); return; }
  Network.sendAction({ type: 'draw-deck' });
}

function drawFromDiscard() {
  const s = _currentPublicState;
  if (!s) return;
  const localId = Network.getLocalPlayerId();
  if (s.players[s.turnIdx]?.id !== localId) { UI.showToast("It's not your turn!"); return; }

  const canDraw = s.phase === 'draw' || (s.phase === 'going-out' && !s.drawnThisTurn);
  if (canDraw) {
    if (!s.discardTop) { UI.showToast('Discard pile is empty.'); return; }
    Network.sendAction({ type: 'draw-discard' });
    return;
  }

  // Discard selected card
  if (s.phase === 'discard' || (s.phase === 'going-out' && s.drawnThisTurn)) {
    if (_selectedCards.size === 0) {
      UI.showToast('Select a card from your hand first, then tap the discard pile.');
      return;
    }
    const cardId = [..._selectedCards][0];
    _selectedCards.clear();
    Network.sendAction({ type: 'discard', cardId });
  }
}

// ── GO OUT — MANUAL BUILDER ───────────────────────────────────

function goOut() {
  const s = _currentPublicState;
  if (!s) return;
  const localId = Network.getLocalPlayerId();
  if (s.players[s.turnIdx]?.id !== localId) { UI.showToast("It's not your turn!"); return; }
  if (s.phase !== 'discard') { UI.showToast('You must draw a card first.'); return; }

  // Enter go-out builder mode
  _goOutMode = true;
  _goOutMeldGroups = [new Set()]; // start with one empty group
  _goOutDiscardId = null;
  document.getElementById('goout-builder-controls').style.display = 'block';
  document.getElementById('btn-go-out').style.display = 'none';
  _renderGameTable(s);
  UI.showGoOutBuilderInstructions();
}

function _exitGoOutMode() {
  _goOutMode = false;
  _goOutMeldGroups = [];
  _goOutDiscardId = null;
  _pendingGoOut = false;
  const ctrl = document.getElementById('goout-builder-controls');
  if (ctrl) ctrl.style.display = 'none';
}

// Card click inside go-out builder
function handleGoOutCardClick(card, action) {
  // action: 'discard' | 'group-N' | 'unassign'
  const s = _currentPublicState;
  if (!s) return;

  if (action === 'discard') {
    _goOutDiscardId = _goOutDiscardId === card.id ? null : card.id;
    // Remove from any meld group if was there
    _goOutMeldGroups.forEach(g => g.delete(card.id));
  } else if (action === 'unassign') {
    _goOutMeldGroups.forEach(g => g.delete(card.id));
    if (_goOutDiscardId === card.id) _goOutDiscardId = null;
  } else if (action.startsWith('group-')) {
    const groupIdx = parseInt(action.split('-')[1]);
    // Remove from other groups/discard
    _goOutMeldGroups.forEach(g => g.delete(card.id));
    if (_goOutDiscardId === card.id) _goOutDiscardId = null;
    // Add to chosen group
    while (_goOutMeldGroups.length <= groupIdx) _goOutMeldGroups.push(new Set());
    _goOutMeldGroups[groupIdx].add(card.id);
  }

  UI.renderGoOutBuilder(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId,
    handleGoOutCardClick, handleCardReorder);
  _updateGoOutStatus();
}

function addGoOutGroup() {
  _goOutMeldGroups.push(new Set());
  const s = _currentPublicState;
  if (s) UI.renderGoOutBuilder(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId,
    handleGoOutCardClick, handleCardReorder);
}

function removeGoOutGroup(idx) {
  if (_goOutMeldGroups.length <= 1) return;
  // Unassign cards in that group
  _goOutMeldGroups.splice(idx, 1);
  const s = _currentPublicState;
  if (s) UI.renderGoOutBuilder(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId,
    handleGoOutCardClick, handleCardReorder);
}

function _updateGoOutStatus() {
  const s = _currentPublicState;
  if (!s) return;
  const meldGroupArrays = _goOutMeldGroups.map(g => [...g]);
  const validation = Game.validateGoOut
    ? null // don't call game.js directly from client — just check via UI
    : null;
  UI.updateGoOutStatus(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId);
}

function cancelGoOut() {
  document.getElementById('goout-modal').classList.add('hidden');
  _exitGoOutMode();
  const s = _currentPublicState;
  if (s) _renderGameTable(s);
}

function confirmGoOut() {
  document.getElementById('goout-modal').classList.add('hidden');
  // Already validated before opening modal
  const meldGroupArrays = _goOutMeldGroups.map(g => [...g]);
  Network.sendAction({ type: 'go-out', discardCardId: _goOutDiscardId, meldGroups: meldGroupArrays });
  _exitGoOutMode();
}

function submitGoOut() {
  const s = _currentPublicState;
  if (!s) return;

  if (!_goOutDiscardId) {
    UI.showToast('Select one card to discard (tap a card → "Discard").', 3000);
    return;
  }

  const meldGroupArrays = _goOutMeldGroups.map(g => [...g]).filter(g => g.length > 0);
  if (meldGroupArrays.length === 0) {
    UI.showToast('You need at least one meld group.', 3000);
    return;
  }

  // Validate locally first (same logic as server)
  const validation = validateGoOutLocal(_localHand, _goOutDiscardId, meldGroupArrays, s.round);
  if (!validation.ok) {
    UI.showToast('⚠️ ' + validation.err + ' — Fix your groups and try again.', 4000);
    return;
  }

  // Show confirmation
  document.getElementById('goout-modal').classList.remove('hidden');
  const preview = document.getElementById('goout-hand-preview');
  preview.innerHTML = '';
  const info = document.createElement('div');
  info.style.cssText = 'font-size:.85rem;color:#a0c0a0;margin-bottom:.5rem;text-align:left;';
  info.textContent = `${meldGroupArrays.length} meld group(s). Discard: ${getCardLabel(_localHand.find(c=>c.id===_goOutDiscardId))}`;
  preview.appendChild(info);
}

// Client-side validation mirror (matches game.js logic)
function validateGoOutLocal(hand, discardCardId, meldGroups, round) {
  const discardCard = hand.find(c => c.id === discardCardId);
  if (!discardCard) return { ok: false, err: 'Discard card not found' };

  const melds = meldGroups.map(group =>
    group.map(id => hand.find(c => c.id === id)).filter(Boolean)
  );

  const meldCardIds = new Set(melds.flat().map(c => c.id));
  if (meldCardIds.has(discardCardId)) return { ok: false, err: 'Your discard card cannot be in a meld group' };

  const allUsed = new Set([...meldCardIds, discardCardId]);
  for (const c of hand) {
    if (!allUsed.has(c.id)) return { ok: false, err: 'All cards must be placed in a group or marked as discard' };
  }

  for (let i = 0; i < melds.length; i++) {
    if (melds[i].length < 3) return { ok: false, err: `Group ${i+1} needs at least 3 cards` };
    if (!isValidMeld(melds[i], round)) {
      const isBook = melds[i].every(c => c.rank === 0 || isWild(c, round) || melds[i].filter(x => !isWild(x, round)).every(x => x.rank === melds[i].find(x => !isWild(x, round))?.rank));
      return { ok: false, err: `Group ${i+1} is not a valid book (same rank) or run (same suit in order)` };
    }
  }

  return { ok: true };
}

// ── SORT HAND ─────────────────────────────────────────────────
function sortHand() {
  const s = _currentPublicState;
  if (!s || _localHand.length === 0) return;
  _localHand.sort((a, b) => {
    if (a.rank === 0 && b.rank !== 0) return -1;
    if (b.rank === 0 && a.rank !== 0) return 1;
    if (a.suit !== b.suit) return (a.suit || 'zzz').localeCompare(b.suit || 'zzz');
    return a.rank - b.rank;
  });
  if (_goOutMode) {
    UI.renderGoOutBuilder(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId,
      handleGoOutCardClick, handleCardReorder);
  } else {
    UI.renderHand(_localHand, s.round, _selectedCards, handleCardClick, handleCardReorder);
  }
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
    if (_goOutMode) cancelGoOut();
  }
  if (e.key === 's' && document.getElementById('screen-game').classList.contains('active')) {
    toggleScoreboard();
  }
});

// ── BOOT ──────────────────────────────────────────────────────
window.addEventListener('load', () => {
  showScreen('screen-splash');
  _refreshAvatarPreview('create', _createAvatar);
  _refreshAvatarPreview('join',   _joinAvatar);

  // Prevent double-tap zoom on mobile
  document.addEventListener('touchend', (e) => {
    if (e.target.classList.contains('btn') || e.target.classList.contains('card') ||
        e.target.classList.contains('pile')) {
      e.preventDefault();
    }
  }, { passive: false });

  console.log('Five Crowns v3 loaded ♛');
});
