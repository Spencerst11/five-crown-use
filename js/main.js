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
  if (goOutBtn) goOutBtn.style.display = (isMyTurn && phase === 'discard') ? 'inline-block' : 'none';
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

function cancelGoOut() {
  _exitGoOutMode();
  const s = _currentPublicState;
  if (s) _renderGameTable(s);
}

function _exitGoOutMode() {
  _goOutMode = false; _goOutMeldGroups = []; _goOutDiscardId = null;
  const bar = document.getElementById('goout-builder-bar');
  if (bar) bar.style.display = 'none';
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
});  if (!previewEl) return;
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
    onMessage: (msg) => UI.showToast(msg),
    onError: (err) => { UI.showToast('⚠️ ' + err, 4000); console.error(err); },
  });
  if (!code) {
    UI.showToast('Could not create the room. Please try again.', 4000);
    showScreen('screen-main-menu');
    return;
  }
  document.getElementById('lobby-room-code').textContent = code;
  document.getElementById('lobby-host-controls').style.display = 'block';
}

async function joinRoom() {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!name) { UI.showToast('Please enter your name.'); return; }
  if (code.length < 4) { UI.showToast('Please enter a valid room code (4 characters).'); return; }
  showScreen('screen-lobby');
  document.getElementById('lobby-room-code').textContent = code;
  document.getElementById('lobby-host-controls').style.display = 'none';
  await Network.joinRoom(name, code, _joinAvatar, {
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
  Network.clearSession();
  Network.destroy();
  _selectedCards.clear();
  _currentPublicState = null;
  _localHand = [];
  _exitGoOutMode();
  _hideRejoinBanner();
  showScreen('screen-main-menu');
}

// ── REJOIN / AUTO-RECONNECT ──────────────────────────────────
// The big mobile fix: when a player returns to the app (or refreshes),
// we silently re-read the latest game state from the server.

let _reconnecting = false;

async function rejoinFromMenu() {
  const session = Network.getSavedSession();
  if (!session) { UI.showToast('No active game to rejoin.', 3000); return; }
  _reconnecting = true;
  UI.showToast('Reconnecting to your game…', 2500);
  await Network.rejoinRoom({
    onStateUpdate: handleStateUpdate,
    onLobbyUpdate: handleLobbyUpdate,
    onMessage: (msg) => UI.showToast(msg),
    onError: (err) => { UI.showToast('⚠️ ' + err, 4000); _reconnecting = false; },
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
  } else {
    banner.style.display = 'none';
  }
}
function _hideRejoinBanner() {
  const banner = document.getElementById('rejoin-banner');
  if (banner) banner.style.display = 'none';
}

// Dismiss the rejoin banner and forget the saved session
function giveUpRejoin() {
  Network.clearSession();
  _hideRejoinBanner();
}

// When the app comes back to the foreground, re-sync from the server.
// This is what fixes "left for a few minutes and got disconnected."
function _setupAutoReconnect() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const code = Network.getRoomCode();
    const inGame = document.getElementById('screen-game').classList.contains('active') ||
                   document.getElementById('screen-lobby').classList.contains('active');
    if (code && inGame && !_reconnecting) {
      // Force a fresh read from the server to catch up on anything missed
      _reconnecting = true;
      Network.rejoinRoom({
        onStateUpdate: handleStateUpdate,
        onLobbyUpdate: handleLobbyUpdate,
        onMessage: () => {},
        onError: () => {},
      }).finally(() => { _reconnecting = false; });
    } else if (!code) {
      const session = Network.getSavedSession();
      if (session && document.getElementById('screen-splash').classList.contains('active')) {
        _showRejoinBanner();
      }
    }
  });

  // iOS restores tabs from cache — re-check session on pageshow
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      const session = Network.getSavedSession();
      if (session && !Network.getRoomCode()) _showRejoinBanner();
    }
  });
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

  // Sync local hand
  const localPlayer = publicState.players.find(p => p.id === localId);
  if (localPlayer?.hand) {
    // Keep local drag order if same cards, otherwise reset
    const sameCards = _localHand.length === localPlayer.hand.length &&
      _localHand.every(c => localPlayer.hand.some(h => h.id === c.id));
    if (!sameCards) {
      _localHand = [...localPlayer.hand];
      // If in go-out mode and hand changed (e.g. a draw happened), exit go-out mode
      if (_goOutMode) _exitGoOutMode();
    }
  }

  // ── GAME OVER ──
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

  // ── ROUND END ──
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

  // Show game table for active phases
  const gameScreen = document.getElementById('screen-game');
  if (!gameScreen.classList.contains('active') &&
      ['draw','discard','going-out'].includes(publicState.phase)) {
    showScreen('screen-game');
  }

  // Deal animation on round start
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

  // Draw animations
  if (action === 'draw-deck' || action === 'draw-discard') {
    UI.animateDraw(action === 'draw-discard');
  }

  // Notify when the draw pile was reshuffled from the discard pile
  if (result && result.reshuffled) {
    UI.showToast('♻️ Draw pile empty — discard pile reshuffled into a new draw pile.', 3500);
  }

  _renderGameTable(publicState);

  // ── TOASTS ──
  if (action === 'going-out') {
    const goingOutName = _getPlayerName(publicState, publicState.goingOutPlayerId);
    const isMe = publicState.goingOutPlayerId === localId;
    UI.showToast(
      isMe
        ? 'You went out! Everyone gets one more turn — draw then discard.'
        : `${goingOutName} went out! See their melds above. Draw one card, then discard one on your final turn.`,
      5000
    );
  } else if (action === 'next-turn') {
    const turnPlayer = publicState.players[publicState.turnIdx];
    if (turnPlayer?.id === localId) {
      if (publicState.phase === 'going-out') {
        UI.showToast('Your final turn! Draw one card, then discard one.', 3000);
      } else {
        UI.showToast('Your turn!', 1500);
      }
    }
  }
}

function _getPlayerName(publicState, id) {
  return publicState.players.find(p => p.id === id)?.name || 'Unknown';
}

// ── YOU-ZONE HELPER ──────────────────────────────────────────
// Populates the you-zone with this player's avatar, name, score, turn glow
function _updateYouZone(localPlayer, isMyTurn, phase, drawnThisTurn) {
  // Avatar
  const avEl = document.getElementById('you-avatar-display');
  if (avEl && localPlayer) {
    const av = Network.getLocalAvatar() || { animal: 'none', color: 'gold' };
    const colorMap = { red:'#e53e3e',pink:'#d53f8c',periwinkle:'#7b8cde',sage:'#68a57a',orange:'#ed8936',gold:'#d4a017' };
    avEl.style.background = colorMap[av.color] || colorMap.gold;
    avEl.textContent = (av.animal && av.animal !== 'none') ? av.animal
      : Network.getLocalPlayerName().split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  }

  // Name
  const nameEl = document.getElementById('you-name-display');
  if (nameEl) nameEl.textContent = Network.getLocalPlayerName();

  // Score
  const scoreEl = document.getElementById('you-score-display');
  if (scoreEl && localPlayer) scoreEl.textContent = localPlayer.score + ' pts';

  // Turn glow on you-zone
  const youZone = document.getElementById('you-zone');
  if (youZone) youZone.classList.toggle('active-turn', isMyTurn && phase !== 'round-end' && phase !== 'game-over');

  // Turn badge + go-out button (these moved into you-zone in HTML)
  const badge = document.getElementById('turn-indicator');
  if (badge) badge.classList.toggle('hidden', !isMyTurn || phase === 'round-end' || phase === 'game-over');
  const goOutBtn = document.getElementById('btn-go-out');
  if (goOutBtn) goOutBtn.style.display = (isMyTurn && phase === 'discard') ? 'inline-block' : 'none';
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

  // Populate the you-zone (avatar, name, score, turn glow)
  _updateYouZone(localPlayer, isMyTurn, s.phase, s.drawnThisTurn);

  // Render hand: go-out builder mode OR normal hand
  if (_goOutMode) {
    UI.renderGoOutBuilder(
      _localHand, s.round,
      _goOutMeldGroups, _goOutDiscardId,
      handleGoOutCardClick, handleCardReorder
    );
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
    if (s.phase === 'draw') {
      msg = `${name} ${isMe ? 'need to' : 'needs to'} draw a card.`;
    } else if (s.phase === 'discard') {
      msg = `${name} ${isMe ? 'need to' : 'needs to'} discard a card.`;
    } else if (s.phase === 'going-out') {
      if (!s.drawnThisTurn) {
        msg = isMe
          ? 'Your final turn — draw one card from the deck or discard pile.'
          : `${name} needs to draw their final card.`;
      } else {
        msg = isMe
          ? 'Now discard one card — your remaining cards will score as points.'
          : `${name} needs to discard their final card.`;
      }
    }
    UI.logAction(msg);
  }
}

// ── CARD DRAG REORDER ─────────────────────────────────────────
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

// ── NORMAL CARD CLICK (select to discard) ────────────────────
function handleCardClick(card, el) {
  const s = _currentPublicState;
  if (!s) return;
  const localId = Network.getLocalPlayerId();
  const isMyTurn = s.players[s.turnIdx]?.id === localId;

  if (!isMyTurn) { UI.showToast("It's not your turn yet."); return; }

  // During going-out phase, player must draw first
  if (s.phase === 'going-out' && !s.drawnThisTurn) {
    UI.showToast('Draw a card first on your final turn!'); return;
  }
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
  if (_selectedCards.size === 1) UI.showToast('Tap the discard pile to discard this card.', 2000);
}

// ── DRAW ACTIONS ─────────────────────────────────────────────
function drawFromDeck() {
  const s = _currentPublicState;
  if (!s) return;
  const localId = Network.getLocalPlayerId();
  if (s.players[s.turnIdx]?.id !== localId) { UI.showToast("It's not your turn!"); return; }
  // Can draw in normal draw phase OR in going-out final turn before drawing
  const canDraw = (s.phase === 'draw') || (s.phase === 'going-out' && !s.drawnThisTurn);
  if (!canDraw) { UI.showToast('You already drew a card.'); return; }
  Network.sendAction({ type: 'draw-deck' });
}

function drawFromDiscard() {
  const s = _currentPublicState;
  if (!s) return;
  const localId = Network.getLocalPlayerId();
  if (s.players[s.turnIdx]?.id !== localId) { UI.showToast("It's not your turn!"); return; }

  // Can draw from discard in normal draw phase OR going-out final turn before drawing
  const canDraw = (s.phase === 'draw') || (s.phase === 'going-out' && !s.drawnThisTurn);
  if (canDraw) {
    if (!s.discardTop) { UI.showToast('Discard pile is empty.'); return; }
    Network.sendAction({ type: 'draw-discard' });
    return;
  }

  // Otherwise treat as a discard action (player taps pile to discard selected card)
  const canDiscard = (s.phase === 'discard') || (s.phase === 'going-out' && s.drawnThisTurn);
  if (canDiscard) {
    if (_selectedCards.size === 0) {
      UI.showToast('Select a card from your hand first, then tap the discard pile.');
      return;
    }
    const cardId = [..._selectedCards][0];
    _selectedCards.clear();
    Network.sendAction({ type: 'discard', cardId });
  }
}

// ── GO OUT — ENTER BUILDER MODE ───────────────────────────────
function goOut() {
  const s = _currentPublicState;
  if (!s) return;
  const localId = Network.getLocalPlayerId();
  if (s.players[s.turnIdx]?.id !== localId) { UI.showToast("It's not your turn!"); return; }
  if (s.phase !== 'discard') { UI.showToast('You must draw a card first.'); return; }
  if (_localHand.length < 3) { UI.showToast('Not enough cards to go out.'); return; }

  // Enter go-out builder mode
  _goOutMode = true;
  _goOutMeldGroups = [new Set()]; // Start with one empty group
  _goOutDiscardId = null;

  // Show the go-out builder controls bar
  document.getElementById('goout-builder-bar').style.display = 'flex';
  document.getElementById('btn-go-out').style.display = 'none';

  _renderGameTable(s);
  UI.showToast('Tap each card → assign to a Group or mark as Discard. When done, tap SUBMIT.', 5000);
}

// ── GO-OUT CARD ASSIGNMENT ────────────────────────────────────
// Called when player taps a card in go-out builder mode
function handleGoOutCardClick(card, action) {
  const s = _currentPublicState;
  if (!s) return;

  if (action === 'discard') {
    // Mark as the one discard card — remove from any group
    _goOutMeldGroups.forEach(g => g.delete(card.id));
    _goOutDiscardId = (_goOutDiscardId === card.id) ? null : card.id;

  } else if (action === 'unassign') {
    _goOutMeldGroups.forEach(g => g.delete(card.id));
    if (_goOutDiscardId === card.id) _goOutDiscardId = null;

  } else if (action.startsWith('group-')) {
    const groupIdx = parseInt(action.split('-')[1]);
    // Remove from all other assignments first
    _goOutMeldGroups.forEach(g => g.delete(card.id));
    if (_goOutDiscardId === card.id) _goOutDiscardId = null;
    // Ensure group exists
    while (_goOutMeldGroups.length <= groupIdx) _goOutMeldGroups.push(new Set());
    _goOutMeldGroups[groupIdx].add(card.id);
  }

  UI.renderGoOutBuilder(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId, handleGoOutCardClick, handleCardReorder);
  UI.updateGoOutStatus(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId);
}

// Add a new empty meld group
function addGoOutGroup() {
  _goOutMeldGroups.push(new Set());
  const s = _currentPublicState;
  if (s) {
    UI.renderGoOutBuilder(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId, handleGoOutCardClick, handleCardReorder);
    UI.updateGoOutStatus(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId);
  }
}

// ── SUBMIT GO OUT ─────────────────────────────────────────────
function submitGoOut() {
  const s = _currentPublicState;
  if (!s) return;

  // Step 1: Check discard is chosen
  if (!_goOutDiscardId) {
    UI.showGoOutError('You must mark one card as your DISCARD before going out.');
    return;
  }

  // Step 2: Build meld group arrays (filter empty groups)
  const meldGroupArrays = _goOutMeldGroups
    .map(g => [...g])
    .filter(g => g.length > 0);

  if (meldGroupArrays.length === 0) {
    UI.showGoOutError('You need at least one meld group. Tap cards and assign them to Group 1.');
    return;
  }

  // Step 3: Check all cards are accounted for (every card in a group or discard)
  const allAssigned = new Set([_goOutDiscardId, ...meldGroupArrays.flat()]);
  const unassigned = _localHand.filter(c => !allAssigned.has(c.id));
  if (unassigned.length > 0) {
    const labels = unassigned.map(c => getCardLabel(c)).join(', ');
    UI.showGoOutError(`These cards are not assigned: ${labels}. Every card must be in a group or marked as Discard.`);
    return;
  }

  // Step 4: Validate each meld group
  for (let i = 0; i < meldGroupArrays.length; i++) {
    const groupCards = meldGroupArrays[i].map(id => _localHand.find(c => c.id === id)).filter(Boolean);
    if (groupCards.length < 3) {
      UI.showGoOutError(`Group ${i + 1} has only ${groupCards.length} card${groupCards.length !== 1 ? 's' : ''} — needs at least 3.`);
      return;
    }
    if (!isValidMeld(groupCards, s.round)) {
      const cardLabels = groupCards.map(c => getCardLabel(c)).join(', ');
      UI.showGoOutError(
        `Group ${i + 1} (${cardLabels}) is not a valid meld.\n` +
        `A Book = 3+ cards of the same rank.\n` +
        `A Run = 3+ consecutive cards of the same suit.`
      );
      return;
    }
  }

  // Step 5: Make sure discard card is not also in a meld group
  if (meldGroupArrays.flat().includes(_goOutDiscardId)) {
    UI.showGoOutError('Your discard card cannot also be in a meld group.');
    return;
  }

  // All valid — send go-out action
  Network.sendAction({
    type: 'go-out',
    discardCardId: _goOutDiscardId,
    meldGroups: meldGroupArrays,
  });
  _exitGoOutMode();
}

// ── CANCEL GO OUT ─────────────────────────────────────────────
function cancelGoOut() {
  _exitGoOutMode();
  const s = _currentPublicState;
  if (s) _renderGameTable(s);
}

function _exitGoOutMode() {
  _goOutMode = false;
  _goOutMeldGroups = [];
  _goOutDiscardId = null;
  const bar = document.getElementById('goout-builder-bar');
  if (bar) bar.style.display = 'none';
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
    UI.renderGoOutBuilder(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId, handleGoOutCardClick, handleCardReorder);
    UI.updateGoOutStatus(_localHand, s.round, _goOutMeldGroups, _goOutDiscardId);
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

  // Set up the auto-reconnect handlers (the mobile backgrounding fix)
  _setupAutoReconnect();

  // If a saved session exists (e.g. the page was refreshed mid-game),
  // offer a one-tap rejoin on the splash screen.
  _showRejoinBanner();

  console.log('Five Crowns v6 (Supabase) loaded ♛');
});
