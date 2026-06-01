// ============================================================
// main.js — Five Crowns App Controller (v8)
// Changes:
//   - Scoreboard: left side-panel tab (no overlay, no header btn)
//   - Final cards panel: right side-panel tab
//   - Round results: 10s auto-advance countdown + manual button
//   - Game over: ranked rows with avatars
//   - Circular opponents + you-zone at bottom
// ============================================================

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
  window.scrollTo(0, 0);
}

// ── STATE ─────────────────────────────────────────────────
let _selectedCards      = new Set();
let _currentPublicState = null;
let _localHand          = [];
let _goOutMode          = false;
let _goOutMeldGroups    = [];
let _goOutDiscardId     = null;
let _layDownMode        = false;   // final-turn manual meld lay-down (after an opponent went out)
let _reconnecting       = false;
let _roundCountdownTimer = null;

// ── AVATAR SELECTION ──────────────────────────────────────
let _createAvatar = { animal:'none', color:'gold' };
let _joinAvatar   = { animal:'none', color:'gold' };

const COLOR_NAMES  = { red:'Red', pink:'Berry Pink', periwinkle:'Periwinkle', sage:'Sage', orange:'Orange', gold:'Gold' };
const ANIMAL_NAMES = { '🐧':'Penguin','🐉':'Dragon','🦫':'Capybara','🐢':'Turtle','🦕':'Dinosaur','🐩':'Poodle','🪼':'Jellyfish','none':'None' };

function _refreshAvatarPreview(prefix, avatar) {
  const previewEl = document.getElementById(`${prefix}-avatar-preview`);
  const labelEl   = document.getElementById(`${prefix}-avatar-label`);
  if (!previewEl) return;
  const colorMap = { red:'#e53e3e',pink:'#d53f8c',periwinkle:'#7b8cde',sage:'#68a57a',orange:'#ed8936',gold:'#d4a017' };
  previewEl.style.background = colorMap[avatar.color] || colorMap.gold;
  previewEl.textContent = avatar.animal === 'none' ? '' : avatar.animal;
  const animalLabel = ANIMAL_NAMES[avatar.animal] || 'None';
  labelEl.textContent = avatar.animal === 'none'
    ? `No Avatar · ${COLOR_NAMES[avatar.color] || 'Gold'}`
    : `${animalLabel} · ${COLOR_NAMES[avatar.color] || 'Gold'}`;
}

function selectAnimal(el, animal) {
  document.querySelectorAll('#create-avatar-picker .avatar-opt').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected'); _createAvatar.animal = animal;
  _refreshAvatarPreview('create', _createAvatar);
}
function selectColor(el, color) {
  document.querySelectorAll('#create-avatar-picker .color-opt').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected'); _createAvatar.color = color;
  _refreshAvatarPreview('create', _createAvatar);
}
function selectAnimalJoin(el, animal) {
  document.querySelectorAll('#join-avatar-picker .avatar-opt').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected'); _joinAvatar.animal = animal;
  _refreshAvatarPreview('join', _joinAvatar);
}
function selectColorJoin(el, color) {
  document.querySelectorAll('#join-avatar-picker .color-opt').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected'); _joinAvatar.color = color;
  _refreshAvatarPreview('join', _joinAvatar);
}

// ── ROOM CREATION ─────────────────────────────────────────
async function createRoom() {
  const name = document.getElementById('create-name').value.trim();
  const maxPlayers = parseInt(document.getElementById('create-players').value);
  if (!name) { UI.showToast('Please enter your name.'); return; }
  showScreen('screen-lobby');
  document.getElementById('lobby-room-code').textContent = '…';
  document.getElementById('lobby-host-controls').style.display = 'none';
  const code = await Network.createRoom(name, maxPlayers, _createAvatar, {
    onStateUpdate: handleStateUpdate,
    onLobbyUpdate: handleLobbyUpdate,
    onMessage: msg => UI.showToast(msg),
    onError: err => { UI.showToast('⚠️ ' + err, 4000); console.error(err); },
  });
  if (!code) { UI.showToast('Could not create the room. Please try again.', 4000); showScreen('screen-main-menu'); return; }
  document.getElementById('lobby-room-code').textContent = code;
  document.getElementById('lobby-host-controls').style.display = 'block';
}

async function joinRoom() {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!name) { UI.showToast('Please enter your name.'); return; }
  if (code.length < 4) { UI.showToast('Please enter a valid 4-character room code.'); return; }
  showScreen('screen-lobby');
  document.getElementById('lobby-room-code').textContent = code;
  document.getElementById('lobby-host-controls').style.display = 'none';
  await Network.joinRoom(name, code, _joinAvatar, {
    onStateUpdate: handleStateUpdate,
    onLobbyUpdate: handleLobbyUpdate,
    onMessage: msg => UI.showToast(msg),
    onError: err => { UI.showToast('⚠️ ' + err, 4000); console.error(err); },
  });
}

function copyRoomCode() {
  const code = document.getElementById('lobby-room-code').textContent;
  navigator.clipboard.writeText(code)
    .then(() => UI.showToast('Room code copied! Share it with family.'))
    .catch(() => UI.showToast(`Room code: ${code}`, 4000));
}

function hostStartGame() { Network.hostStartGame(); }

function leaveRoom() {
  Network.clearSession();
  Network.destroy();
  _selectedCards.clear();
  _currentPublicState = null;
  _localHand = [];
  _exitGoOutMode();
  _hideRejoinBanner();
  clearTimeout(_roundCountdownTimer);
  showScreen('screen-main-menu');
}

// ── LOBBY ─────────────────────────────────────────────────
function handleLobbyUpdate(players) {
  UI.renderLobby(players, Network.getLocalPlayerId(), Network.getExpectedPlayers());
}

// ── REJOIN / AUTO-RECONNECT ───────────────────────────────
async function rejoinFromMenu() {
  const session = Network.getSavedSession();
  if (!session) { UI.showToast('No active game to rejoin.', 3000); return; }
  _reconnecting = true;
  UI.showToast('Reconnecting…', 2500);
  await Network.rejoinRoom({
    onStateUpdate: handleStateUpdate,
    onLobbyUpdate: handleLobbyUpdate,
    onMessage: msg => UI.showToast(msg),
    onError: err => { UI.showToast('⚠️ ' + err, 4000); _reconnecting = false; },
  });
  _reconnecting = false;
}

function _showRejoinBanner() {
  const session = Network.getSavedSession();
  const banner = document.getElementById('rejoin-banner');
  if (!banner) return;
  if (session) {
    const label = document.getElementById('rejoin-room-label');
    if (label) label.textContent = `Room ${session.roomCode} · ${session.name}`;
    banner.style.display = 'flex';
  } else { banner.style.display = 'none'; }
}
function _hideRejoinBanner() {
  const banner = document.getElementById('rejoin-banner');
  if (banner) banner.style.display = 'none';
}
function giveUpRejoin() { Network.clearSession(); _hideRejoinBanner(); }

function _setupAutoReconnect() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const code = Network.getRoomCode();
    const inGame = document.getElementById('screen-game').classList.contains('active') ||
                   document.getElementById('screen-lobby').classList.contains('active');
    if (code && inGame && !_reconnecting) {
      _reconnecting = true;
      Network.rejoinRoom({
        onStateUpdate: handleStateUpdate,
        onLobbyUpdate: handleLobbyUpdate,
        onMessage: () => {},
        onError: () => {},
      }).finally(() => { _reconnecting = false; });
    } else if (!code) {
      const session = Network.getSavedSession();
      if (session && document.getElementById('screen-splash').classList.contains('active'))
        _showRejoinBanner();
    }
  });
  window.addEventListener('pageshow', e => {
    if (e.persisted) {
      const session = Network.getSavedSession();
      if (session && !Network.getRoomCode()) _showRejoinBanner();
    }
  });
}

// ── SIDE PANELS ───────────────────────────────────────────
function toggleScoreboard() {
  const panel = document.getElementById('score-panel');
  const isOpen = panel.classList.contains('open');
  // Close cards panel if open
  document.getElementById('cards-panel').classList.remove('open');
  if (!isOpen && _currentPublicState) {
    UI.renderScoreboard(_currentPublicState.players, _currentPublicState.round);
  }
  panel.classList.toggle('open', !isOpen);
}

function toggleCardsPanel() {
  const panel = document.getElementById('cards-panel');
  const isOpen = panel.classList.contains('open');
  // Close score panel if open
  document.getElementById('score-panel').classList.remove('open');
  if (!isOpen && _currentPublicState) {
    UI.renderFinalCardsPanel(_currentPublicState.players, Network.getLocalPlayerId());
  }
  panel.classList.toggle('open', !isOpen);
}

function _closeAllPanels() {
  document.getElementById('score-panel')?.classList.remove('open');
  document.getElementById('cards-panel')?.classList.remove('open');
}

// ── GAME STATE HANDLER ────────────────────────────────────
function handleStateUpdate(publicState, result) {
  _currentPublicState = publicState;
  const localId = Network.getLocalPlayerId();
  const { action } = result || {};

  // Sync local hand
  const localPlayer = publicState.players.find(p => p.id === localId);
  if (localPlayer?.hand) {
    const sameCards = _localHand.length === localPlayer.hand.length &&
      _localHand.every(c => localPlayer.hand.some(h => h.id === c.id));
    if (!sameCards) {
      _localHand = [...localPlayer.hand];
      if (_goOutMode) _exitGoOutMode();
    }
  }

  // ── GAME OVER ──
  if (publicState.phase === 'game-over') {
    _exitGoOutMode();
    _closeAllPanels();
    clearTimeout(_roundCountdownTimer);
    setTimeout(() => {
      const results = publicState.players.map(p => ({
        playerId: p.id, name: p.name,
        totalScore: p.score,
        roundScore: p.roundScores[p.roundScores.length - 1] || 0,
      }));
      UI.renderGameOver(results, publicState.winner,
        publicState.players.find(p => p.id === publicState.winner)?.name || 'Unknown',
        publicState.players);
      showScreen('screen-game-over');
    }, 600);
    return;
  }

  // ── ROUND END ──
  if (publicState.phase === 'round-end') {
    _exitGoOutMode();
    clearTimeout(_roundCountdownTimer);

    // Refresh the final-cards panel if it was open
    if (document.getElementById('cards-panel')?.classList.contains('open')) {
      UI.renderFinalCardsPanel(publicState.players, localId);
    }

    setTimeout(() => {
      const results = publicState.players.map(p => ({
        playerId: p.id, name: p.name,
        roundScore: p.roundScores[p.roundScores.length - 1] || 0,
        totalScore: p.score,
      }));
      const isHost = Network.getIsHost();
      UI.renderRoundResults(results, publicState.round, false, isHost, isHost ? 10 : 0);
      showScreen('screen-round-results');

      // Host auto-advances after 10 seconds
      if (isHost) {
        _roundCountdownTimer = setTimeout(() => {
          const s = _currentPublicState;
          if (s && s.phase === 'round-end') nextRound();
        }, 10000);
      }
    }, 500);
    return;
  }

  // Show game table for active phases
  const gameScreen = document.getElementById('screen-game');
  if (!gameScreen.classList.contains('active') &&
      ['draw','discard','going-out'].includes(publicState.phase)) {
    showScreen('screen-game');
    _closeAllPanels();
  }

  // Deal animation on round start
  if (action === 'round-start' && localPlayer?.hand) {
    _exitGoOutMode();
    _selectedCards.clear();
    // Clear final cards panel for new round
    const fcContent = document.getElementById('final-cards-content');
    if (fcContent) { fcContent.innerHTML = '<p class="panel-empty-msg">Cards will appear here when players go out or end their final turn.</p>'; }
    const handSize = publicState.round + 2;
    UI.playDealAnimation(handSize, () => _renderGameTable(publicState));
    _renderGameTable(publicState);
    UI.showToast(`Round ${publicState.round} of 11 begins!`, 2500);
    return;
  }

  if (action === 'draw-deck' || action === 'draw-discard') UI.animateDraw(action === 'draw-discard');
  if (result?.reshuffled) UI.showToast('♻️ Draw pile reshuffled from discards.', 3000);

  _renderGameTable(publicState);

  // Update open panels live
  if (document.getElementById('score-panel')?.classList.contains('open')) {
    UI.renderScoreboard(publicState.players, publicState.round);
  }
  if (document.getElementById('cards-panel')?.classList.contains('open')) {
    UI.renderFinalCardsPanel(publicState.players, localId);
  }

  // ── TOASTS ──
  if (action === 'going-out') {
    const goerName = publicState.players.find(p => p.id === publicState.goingOutPlayerId)?.name || '';
    const isMe = publicState.goingOutPlayerId === localId;
    UI.showToast(
      isMe ? 'You went out! Everyone gets one final turn — draw then discard.' :
             `${goerName} went out! Tap 📋 to see their melds. Your final turn: draw then discard.`,
      5000
    );
    // Auto-open the cards panel so everyone sees the melds
    setTimeout(() => {
      document.getElementById('score-panel')?.classList.remove('open');
      UI.renderFinalCardsPanel(publicState.players, localId);
      document.getElementById('cards-panel')?.classList.add('open');
    }, 800);
  } else if (action === 'next-turn') {
    const turnPlayer = publicState.players[publicState.turnIdx];
    if (turnPlayer?.id === localId) {
      UI.showToast(publicState.phase === 'going-out'
        ? 'Your final turn! Draw one card, then discard one.' : 'Your turn!', 1800);
    }
  }
}

// ── RENDER GAME TABLE ─────────────────────────────────────
function _renderGameTable(s) {
  const localId = Network.getLocalPlayerId();
  const localPlayer = s.players.find(p => p.id === localId);
  const currentTurnPlayer = s.players[s.turnIdx];
  const isMyTurn = currentTurnPlayer?.id === localId;

  UI.updateHeader(s.round, s.phase, s.drawnThisTurn);
  UI.renderOpponents(s.players, localId, currentTurnPlayer?.id);
  UI.updateDrawPile(s.drawPileCount, isMyTurn, s.phase, s.drawnThisTurn);
  UI.renderDiscardTop(s.discardTop, s.round);

  // You-zone
  _updateYouZone(localPlayer, isMyTurn, s.phase, s.drawnThisTurn);
  UI.updateYouZoneGlow(isMyTurn, s.phase);

  // Hand
  if (_goOutMode) {
    UI.renderGoOutBuilder(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId, handleGoOutCardClick, handleCardReorder);
    UI.updateGoOutStatus(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId);
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
    if (s.phase === 'draw') msg = `${name} ${isMe?'need to':'needs to'} draw.`;
    else if (s.phase === 'discard') msg = `${name} ${isMe?'need to':'needs to'} discard.`;
    else if (s.phase === 'going-out') {
      msg = isMe
        ? (s.drawnThisTurn ? 'Discard one card — remaining cards score as points.' : 'Final turn — draw one card.')
        : `${name} ${s.drawnThisTurn?'needs to discard':'needs to draw'} (final turn).`;
    }
    UI.logAction(msg);
  }
}

// ── YOU-ZONE ──────────────────────────────────────────────
function _updateYouZone(localPlayer, isMyTurn, phase, drawnThisTurn) {
  const avEl    = document.getElementById('you-avatar-display');
  const nameEl  = document.getElementById('you-name-display');
  const scoreEl = document.getElementById('you-score-display');
  const badge   = document.getElementById('turn-indicator');
  const goOutBtn = document.getElementById('btn-go-out');

  if (avEl) {
    const av = Network.getLocalAvatar() || { animal:'none', color:'gold' };
    const colorMap = { red:'#e53e3e',pink:'#d53f8c',periwinkle:'#7b8cde',sage:'#68a57a',orange:'#ed8936',gold:'#d4a017' };
    avEl.style.background = colorMap[av.color] || colorMap.gold;
    avEl.textContent = (av.animal && av.animal !== 'none')
      ? av.animal
      : Network.getLocalPlayerName().split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  }
  if (nameEl) nameEl.textContent = Network.getLocalPlayerName();
  if (scoreEl && localPlayer) scoreEl.textContent = localPlayer.score + ' pts';
  if (badge) badge.classList.toggle('hidden', !isMyTurn || phase === 'round-end' || phase === 'game-over');
  if (goOutBtn) goOutBtn.style.display = (isMyTurn && phase === 'discard' && !_goOutMode && !_layDownMode) ? 'inline-block' : 'none';
  // LAY DOWN appears on your final turn (an opponent already went out) once you've drawn
  const layBtn = document.getElementById('btn-lay-down');
  if (layBtn) layBtn.style.display = (isMyTurn && phase === 'going-out' && drawnThisTurn && !_layDownMode && !_goOutMode) ? 'inline-block' : 'none';
}

// ── CARD INTERACTIONS ─────────────────────────────────────
function handleCardReorder(fromIdx, toIdx) {
  if (fromIdx === toIdx) return;
  if (fromIdx < 0 || toIdx < 0 || fromIdx >= _localHand.length || toIdx >= _localHand.length) return;
  const moved = _localHand.splice(fromIdx, 1)[0];
  _localHand.splice(toIdx, 0, moved);
  const s = _currentPublicState;
  if (!s) return;
  if (_goOutMode) {
    UI.renderGoOutBuilder(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId, handleGoOutCardClick, handleCardReorder);
    UI.updateGoOutStatus(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId);
  } else {
    UI.renderHand(_localHand, s.round, _selectedCards, handleCardClick, handleCardReorder);
  }
}

function handleCardClick(card, el) {
  const s = _currentPublicState;
  if (!s) return;
  const localId = Network.getLocalPlayerId();
  if (s.players[s.turnIdx]?.id !== localId) { UI.showToast("It's not your turn yet."); return; }
  if (s.phase === 'going-out' && !s.drawnThisTurn) { UI.showToast('Draw a card first!'); return; }
  if (s.phase !== 'discard' && s.phase !== 'going-out') { UI.showToast('Draw a card first!'); return; }

  if (_selectedCards.has(card.id)) { _selectedCards.delete(card.id); }
  else { _selectedCards.clear(); _selectedCards.add(card.id); }

  UI.renderHand(_localHand, s.round, _selectedCards, handleCardClick, handleCardReorder);
  if (_selectedCards.size === 1) UI.showToast('Tap the discard pile to discard.', 2000);
}

// ── DRAW ─────────────────────────────────────────────────
function drawFromDeck() {
  const s = _currentPublicState;
  if (!s) return;
  const localId = Network.getLocalPlayerId();
  if (s.players[s.turnIdx]?.id !== localId) { UI.showToast("It's not your turn!"); return; }
  const canDraw = s.phase === 'draw' || (s.phase === 'going-out' && !s.drawnThisTurn);
  if (!canDraw) { UI.showToast('You already drew.'); return; }
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
  const canDiscard = s.phase === 'discard' || (s.phase === 'going-out' && s.drawnThisTurn);
  if (canDiscard) {
    if (_selectedCards.size === 0) { UI.showToast('Select a card from your hand first.'); return; }
    const cardId = [..._selectedCards][0];
    _selectedCards.clear();
    Network.sendAction({ type: 'discard', cardId });
  }
}

// ── GO OUT BUILDER ────────────────────────────────────────
function goOut() {
  const s = _currentPublicState;
  if (!s) return;
  const localId = Network.getLocalPlayerId();
  if (s.players[s.turnIdx]?.id !== localId) { UI.showToast("It's not your turn!"); return; }
  if (s.phase !== 'discard') { UI.showToast('Draw a card first.'); return; }
  if (_localHand.length < 3) { UI.showToast('Not enough cards to go out.'); return; }

  _goOutMode = true;
  _goOutMeldGroups = [new Set()];
  _goOutDiscardId = null;
  document.getElementById('goout-builder-bar').style.display = 'flex';
  document.getElementById('btn-go-out').style.display = 'none';
  _renderGameTable(s);
  UI.showToast('Tap each card → assign to Group or Discard, then tap SUBMIT.', 5000);
}

function handleGoOutCardClick(card, action) {
  const s = _currentPublicState;
  if (!s) return;
  if (action === 'discard') {
    _goOutMeldGroups.forEach(g => g.delete(card.id));
    _goOutDiscardId = (_goOutDiscardId === card.id) ? null : card.id;
  } else if (action === 'unassign') {
    _goOutMeldGroups.forEach(g => g.delete(card.id));
    if (_goOutDiscardId === card.id) _goOutDiscardId = null;
  } else if (action.startsWith('group-')) {
    const gi = parseInt(action.split('-')[1]);
    _goOutMeldGroups.forEach(g => g.delete(card.id));
    if (_goOutDiscardId === card.id) _goOutDiscardId = null;
    while (_goOutMeldGroups.length <= gi) _goOutMeldGroups.push(new Set());
    _goOutMeldGroups[gi].add(card.id);
  }
  UI.renderGoOutBuilder(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId, handleGoOutCardClick, handleCardReorder);
  UI.updateGoOutStatus(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId);
}

function addGoOutGroup() {
  _goOutMeldGroups.push(new Set());
  const s = _currentPublicState;
  if (s) {
    UI.renderGoOutBuilder(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId, handleGoOutCardClick, handleCardReorder);
    UI.updateGoOutStatus(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId);
  }
}

function submitGoOut() {
  const s = _currentPublicState;
  if (!s) return;

  if (!_goOutDiscardId) { UI.showGoOutError('Mark one card as your DISCARD before going out.'); return; }

  const meldGroupArrays = _goOutMeldGroups.map(g => [...g]).filter(g => g.length > 0);
  if (meldGroupArrays.length === 0) { UI.showGoOutError('Add at least one meld Group.'); return; }

  const allAssigned = new Set([_goOutDiscardId, ...meldGroupArrays.flat()]);
  const unassigned = _localHand.filter(c => !allAssigned.has(c.id));
  if (unassigned.length > 0) {
    UI.showGoOutError(`${unassigned.map(c => getCardLabel(c)).join(', ')} not assigned. Every card must be in a group or marked Discard.`);
    return;
  }

  for (let i = 0; i < meldGroupArrays.length; i++) {
    const groupCards = meldGroupArrays[i].map(id => _localHand.find(c => c.id === id)).filter(Boolean);
    if (groupCards.length < 3) { UI.showGoOutError(`Group ${i+1} needs at least 3 cards.`); return; }
    if (!isValidMeld(groupCards, s.round)) {
      UI.showGoOutError(`Group ${i+1} (${groupCards.map(c => getCardLabel(c)).join(', ')}) is not a valid Book or Run.`);
      return;
    }
  }
  if (meldGroupArrays.flat().includes(_goOutDiscardId)) { UI.showGoOutError('Your discard cannot be in a meld group.'); return; }

  Network.sendAction({ type:'go-out', discardCardId:_goOutDiscardId, meldGroups:meldGroupArrays });
  _exitGoOutMode();
}

// ── FINAL-TURN LAY DOWN (after an opponent has gone out) ──
// Reuses the same builder UI/state as go-out, BUT leftover (un-melded)
// cards are allowed — they simply count as points. Only requirement:
// exactly one card marked as the discard.
function startLayDown() {
  const s = _currentPublicState;
  if (!s) return;
  const localId = Network.getLocalPlayerId();
  if (s.players[s.turnIdx]?.id !== localId) { UI.showToast("It's not your turn!"); return; }
  if (s.phase !== 'going-out') { UI.showToast('Lay down is only on your final turn.'); return; }
  if (!s.drawnThisTurn) { UI.showToast('Draw a card first.'); return; }

  _layDownMode = true;
  _goOutMode = true;            // reuse the builder rendering/state
  _goOutMeldGroups = [new Set()];
  _goOutDiscardId = null;
  document.getElementById('goout-builder-bar').style.display = 'flex';
  document.getElementById('btn-go-out').style.display = 'none';
  document.getElementById('btn-lay-down').style.display = 'none';
  // Update the status hint to reflect lay-down rules
  const statusEl = document.getElementById('goout-status-bar');
  if (statusEl) statusEl.textContent = 'Group any melds (3+), mark ONE card as Discard. Un-melded cards count as points.';
  _renderGameTable(s);
  UI.showToast('Group your melds to reduce points, mark one Discard, then SUBMIT.', 5000);
}

// Router: the builder's SUBMIT button calls this; it dispatches based on mode
function submitBuilder() {
  if (_layDownMode) submitFinalLayDown();
  else submitGoOut();
}

function submitFinalLayDown() {
  const s = _currentPublicState;
  if (!s) return;

  // Must mark exactly one discard
  if (!_goOutDiscardId) { UI.showGoOutError('Mark ONE card as your Discard to end your final turn.'); return; }
  if (!_localHand.find(c => c.id === _goOutDiscardId)) { UI.showGoOutError('Discard card not found in your hand.'); return; }

  // Build groups; leftovers are allowed (they score), but any group that
  // exists must be a valid book/run of 3+.
  const meldGroupArrays = _goOutMeldGroups.map(g => [...g]).filter(g => g.length > 0);
  for (let i = 0; i < meldGroupArrays.length; i++) {
    const groupCards = meldGroupArrays[i].map(id => _localHand.find(c => c.id === id)).filter(Boolean);
    if (groupCards.length < 3) {
      UI.showGoOutError(`Group ${i+1} needs at least 3 cards, or remove those cards to count them as points.`);
      return;
    }
    if (!isValidMeld(groupCards, s.round)) {
      UI.showGoOutError(`Group ${i+1} (${groupCards.map(c => getCardLabel(c)).join(', ')}) is not a valid Book or Run.`);
      return;
    }
  }
  if (meldGroupArrays.flat().includes(_goOutDiscardId)) { UI.showGoOutError('Your discard cannot be in a meld group.'); return; }

  Network.sendAction({ type:'final-laydown', discardCardId:_goOutDiscardId, meldGroups:meldGroupArrays });
  _exitGoOutMode();
}

function cancelGoOut() {
  _exitGoOutMode();
  const s = _currentPublicState;
  if (s) _renderGameTable(s);
}

function _exitGoOutMode() {
  _goOutMode = false; _layDownMode = false; _goOutMeldGroups = []; _goOutDiscardId = null;
  const bar = document.getElementById('goout-builder-bar');
  if (bar) bar.style.display = 'none';
  const assignBar = document.getElementById('card-assign-bar');
  if (assignBar) { assignBar.style.display = 'none'; assignBar.innerHTML = ''; }
}

// ── SORT HAND ─────────────────────────────────────────────
function sortHand() {
  const s = _currentPublicState;
  if (!s || _localHand.length === 0) return;
  _localHand.sort((a, b) => {
    if (a.rank === 0 && b.rank !== 0) return -1;
    if (b.rank === 0 && a.rank !== 0) return 1;
    if (a.suit !== b.suit) return (a.suit||'zzz').localeCompare(b.suit||'zzz');
    return a.rank - b.rank;
  });
  if (_goOutMode) {
    UI.renderGoOutBuilder(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId, handleGoOutCardClick, handleCardReorder);
  } else {
    UI.renderHand(_localHand, s.round, _selectedCards, handleCardClick, handleCardReorder);
  }
}

// ── NEXT ROUND ────────────────────────────────────────────
function nextRound() {
  clearTimeout(_roundCountdownTimer);
  const s = _currentPublicState;
  if (s && s.phase === 'game-over') { showScreen('screen-main-menu'); return; }
  if (Network.getIsHost()) Network.sendAction({ type:'next-round' });
}

// ── KEYBOARD ──────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    _closeAllPanels();
    if (_goOutMode) cancelGoOut();
  }
  if (e.key === 's' && document.getElementById('screen-game').classList.contains('active')) toggleScoreboard();
  if (e.key === 'f' && document.getElementById('screen-game').classList.contains('active')) toggleCardsPanel();
});

// ── BOOT ──────────────────────────────────────────────────
window.addEventListener('load', () => {
  showScreen('screen-splash');
  _refreshAvatarPreview('create', _createAvatar);
  _refreshAvatarPreview('join',   _joinAvatar);
  _setupAutoReconnect();
  _showRejoinBanner();
  console.log('Five Crowns v8 loaded ♛');
});
