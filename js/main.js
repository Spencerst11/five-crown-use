// ============================================================
// main.js — App Controller for Five Crowns (v4)
// NEW: Reconnection support
//   - On disconnect: auto-shows rejoin banner with saved session
//   - Rejoin button appears on splash/menu if session exists
//   - Auto-retries reconnect up to 5 times with backoff
//   - Leaving voluntarily clears the saved session
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
let _goOutMeldGroups    = [];
let _goOutDiscardId     = null;
let _goOutMode          = false;

// Reconnect state
let _rejoinAttempts     = 0;
let _rejoinTimer        = null;

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
    onError: (err) => {
      if (err === 'disconnected') {
        _handleSelfDisconnect();
      } else {
        UI.showToast('⚠️ ' + err, 4000);
        console.error(err);
      }
    },
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
    onError: (err) => {
      if (err === 'disconnected') {
        _handleSelfDisconnect();
      } else {
        UI.showToast('⚠️ ' + err, 4000);
        console.error(err);
      }
    },
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
  // Voluntary leave — clear saved session so rejoin banner doesn't show
  Network.clearSession();
  Network.destroy();
  _selectedCards.clear();
  _currentPublicState = null;
  _localHand = [];
  _exitGoOutMode();
  clearTimeout(_rejoinTimer);
  _rejoinAttempts = 0;
  _hideBanner();
  showScreen('screen-main-menu');
}

// ── LOBBY HANDLER ─────────────────────────────────────────────
function handleLobbyUpdate(players) {
  UI.renderLobby(players, Network.getLocalPlayerId(), Network.getExpectedPlayers());
}

// ── RECONNECTION SYSTEM ───────────────────────────────────────

// Called when THIS player's connection to host drops
function _handleSelfDisconnect() {
  const session = Network.getSavedSession();
  if (!session) {
    // Nothing to recover — go back to menu
    UI.showToast('Disconnected from game.', 3000);
    showScreen('screen-main-menu');
    return;
  }

  // Show the reconnect screen
  showScreen('screen-reconnect');
  document.getElementById('rc-room-code').textContent = session.roomCode;
  document.getElementById('rc-player-name').textContent = session.name;
  document.getElementById('rc-status').textContent = 'Connection lost. Attempting to reconnect…';
  document.getElementById('rc-attempts').textContent = '';

  // Start auto-reconnect
  _rejoinAttempts = 0;
  _scheduleAutoRejoin();
}

function _scheduleAutoRejoin() {
  const delay = _rejoinAttempts === 0 ? 1500 : Math.min(_rejoinAttempts * 3000, 12000);
  const rc = document.getElementById('rc-attempts');
  if (rc) rc.textContent = `Attempt ${_rejoinAttempts + 1} of 5…`;

  _rejoinTimer = setTimeout(() => {
    Network.destroy();
    _attemptRejoin();
  }, delay);
}

function _attemptRejoin() {
  const session = Network.getSavedSession();
  if (!session) {
    _rejoinFailed('No saved session found.');
    return;
  }

  const statusEl = document.getElementById('rc-status');
  if (statusEl) statusEl.textContent = `Connecting to room ${session.roomCode}…`;

  Network.rejoinRoom({
    onStateUpdate: (pub, result) => {
      // Reconnect succeeded!
      _rejoinAttempts = 0;
      clearTimeout(_rejoinTimer);
      handleStateUpdate(pub, result);
      UI.showToast('✅ Reconnected! Welcome back.', 3000);
    },
    onLobbyUpdate: handleLobbyUpdate,
    onMessage: (msg) => UI.showToast(msg),
    onError: (err) => {
      if (err === 'disconnected') {
        _rejoinAttempts++;
        if (_rejoinAttempts >= 5) {
          _rejoinFailed('Could not reconnect after 5 attempts. The host may have closed the game.');
        } else {
          const statusEl2 = document.getElementById('rc-status');
          if (statusEl2) statusEl2.textContent = `Attempt ${_rejoinAttempts} failed. Retrying…`;
          _scheduleAutoRejoin();
        }
      } else {
        _rejoinFailed(err);
      }
    },
  });
}

function _rejoinFailed(reason) {
  clearTimeout(_rejoinTimer);
  _rejoinAttempts = 0;
  const statusEl = document.getElementById('rc-status');
  if (statusEl) {
    statusEl.textContent = reason;
    statusEl.style.color = '#f87171';
  }
  const attemptsEl = document.getElementById('rc-attempts');
  if (attemptsEl) attemptsEl.textContent = '';
}

// Manual rejoin from reconnect screen
function manualRejoin() {
  clearTimeout(_rejoinTimer);
  _rejoinAttempts = 0;
  const statusEl = document.getElementById('rc-status');
  if (statusEl) {
    statusEl.textContent = 'Reconnecting…';
    statusEl.style.color = '';
  }
  Network.destroy();
  _attemptRejoin();
}

// Give up and go back to menu from reconnect screen
function giveUpRejoin() {
  clearTimeout(_rejoinTimer);
  _rejoinAttempts = 0;
  Network.clearSession();
  Network.destroy();
  _hideBanner();
  showScreen('screen-main-menu');
}

// Rejoin button on the splash/menu (if session exists from a page refresh)
function rejoinFromMenu() {
  const session = Network.getSavedSession();
  if (!session) { UI.showToast('No active session found.', 3000); return; }
  showScreen('screen-reconnect');
  document.getElementById('rc-room-code').textContent = session.roomCode;
  document.getElementById('rc-player-name').textContent = session.name;
  document.getElementById('rc-status').textContent = 'Reconnecting to your game…';
  document.getElementById('rc-attempts').textContent = '';
  _rejoinAttempts = 0;
  _scheduleAutoRejoin();
}

// Show/hide the rejoin banner on the splash screen
function _checkForSavedSession() {
  const session = Network.getSavedSession();
  const banner = document.getElementById('rejoin-banner');
  if (!banner) return;
  if (session) {
    document.getElementById('rejoin-room-label').textContent = `Room ${session.roomCode} · ${session.name}`;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

function _hideBanner() {
  const banner = document.getElementById('rejoin-banner');
  if (banner) banner.style.display = 'none';
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
    Network.clearSession(); // game over — no need to rejoin
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

  // Show game table for active game phases
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

  // Handle rejoin — drop straight into the game
  if (action === 'rejoin') {
    _exitGoOutMode();
    _selectedCards.clear();
    showScreen('screen-game');
    _renderGameTable(publicState);
    return;
  }

  if (action === 'draw-deck' || action === 'draw-discard') {
    UI.animateDraw(action === 'draw-discard');
  }

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
        : `${goingOutName} went out! Draw then discard on your final turn.`,
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

  if (_goOutMode) {
    UI.renderGoOutBuilder(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId,
      handleGoOutCardClick, handleCardReorder);
  } else if (_localHand.length > 0) {
    UI.renderHand(_localHand, s.round, _selectedCards, handleCardClick, handleCardReorder);
  } else if (localPlayer?.hand) {
    UI.renderHand(localPlayer.hand, s.round, _selectedCards, handleCardClick, handleCardReorder);
  }

  if (currentTurnPlayer) {
    const isMe = currentTurnPlayer.id === localId;
    const name = isMe ? 'You' : currentTurnPlayer.name;
    let msg = '';

    // Show disconnected indicator for that player's turn
    const isDisconnected = currentTurnPlayer.disconnected;
    if (s.phase === 'draw') {
      msg = isDisconnected
        ? `⚠️ ${name} is disconnected — their turn will be skipped shortly.`
        : `${name} ${isMe ? 'need to' : 'needs to'} draw a card.`;
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

// ── CARD REORDER ─────────────────────────────────────────────
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

  _goOutMode = true;
  _goOutMeldGroups = [new Set()];
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

function handleGoOutCardClick(card, action) {
  const s = _currentPublicState;
  if (!s) return;

  if (action === 'discard') {
    _goOutDiscardId = _goOutDiscardId === card.id ? null : card.id;
    _goOutMeldGroups.forEach(g => g.delete(card.id));
  } else if (action === 'unassign') {
    _goOutMeldGroups.forEach(g => g.delete(card.id));
    if (_goOutDiscardId === card.id) _goOutDiscardId = null;
  } else if (action.startsWith('group-')) {
    const groupIdx = parseInt(action.split('-')[1]);
    _goOutMeldGroups.forEach(g => g.delete(card.id));
    if (_goOutDiscardId === card.id) _goOutDiscardId = null;
    while (_goOutMeldGroups.length <= groupIdx) _goOutMeldGroups.push(new Set());
    _goOutMeldGroups[groupIdx].add(card.id);
  }

  UI.renderGoOutBuilder(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId,
    handleGoOutCardClick, handleCardReorder);
  UI.updateGoOutStatus(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId);
}

function addGoOutGroup() {
  _goOutMeldGroups.push(new Set());
  const s = _currentPublicState;
  if (s) UI.renderGoOutBuilder(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId,
    handleGoOutCardClick, handleCardReorder);
}

function cancelGoOut() {
  document.getElementById('goout-modal').classList.add('hidden');
  _exitGoOutMode();
  const s = _currentPublicState;
  if (s) _renderGameTable(s);
}

function confirmGoOut() {
  document.getElementById('goout-modal').classList.add('hidden');
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

  const validation = validateGoOutLocal(_localHand, _goOutDiscardId, meldGroupArrays, s.round);
  if (!validation.ok) {
    UI.showToast('⚠️ ' + validation.err + ' — Fix your groups and try again.', 4000);
    return;
  }

  document.getElementById('goout-modal').classList.remove('hidden');
  const preview = document.getElementById('goout-hand-preview');
  preview.innerHTML = '';
  const info = document.createElement('div');
  info.style.cssText = 'font-size:.85rem;color:#a0c0a0;margin-bottom:.5rem;text-align:left;';
  info.textContent = `${meldGroupArrays.length} meld group(s). Discard: ${getCardLabel(_localHand.find(c=>c.id===_goOutDiscardId))}`;
  preview.appendChild(info);
}

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

  // Check for a saved session (e.g. page was refreshed mid-game)
  _checkForSavedSession();

  console.log('Five Crowns v4 loaded ♛');
});
