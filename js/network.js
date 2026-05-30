// ============================================================
// network.js — P2P Networking via PeerJS (v4)
// NEW: Reconnection support
//   - Host keeps disconnected player slots warm for 3 minutes
//   - Guest saves session to localStorage on connect
//   - Guest can rejoin with same name+code and get state restored
//   - Host broadcasts "player-reconnected" to all when slot filled
// ============================================================

const Network = (() => {

  let peer = null;
  let connections = {};     // peerId → DataConnection (host only)
  let hostConn = null;      // Connection to host (guest only)
  let isHost = false;
  let localPlayerId = null;
  let localPlayerName = '';
  let localAvatar = { animal: 'none', color: 'gold' };
  let roomCode = '';
  let expectedPlayers = 4;
  let onStateUpdate = null;
  let onLobbyUpdate = null;
  let onMessage = null;
  let onError = null;
  let _lobbyPlayers = [];

  // ── RECONNECTION STATE (host only) ───────────────────────
  // Stores disconnected players waiting to rejoin
  // { playerId, name, avatar, peerId, disconnectedAt, timeoutHandle }
  let _disconnectedSlots = {};

  const RECONNECT_WINDOW_MS = 3 * 60 * 1000; // 3 minutes

  // ── SESSION STORAGE ──────────────────────────────────────
  // Guest saves their session so they can rejoin after a refresh/drop

  function _saveSession(playerId, name, avatar, code) {
    try {
      localStorage.setItem('fc_session', JSON.stringify({
        playerId, name, avatar, roomCode: code,
        savedAt: Date.now(),
      }));
    } catch (e) { /* storage may be blocked */ }
  }

  function _loadSession() {
    try {
      const raw = localStorage.getItem('fc_session');
      if (!raw) return null;
      const s = JSON.parse(raw);
      // Expire sessions older than 3 minutes
      if (Date.now() - s.savedAt > RECONNECT_WINDOW_MS) {
        localStorage.removeItem('fc_session');
        return null;
      }
      return s;
    } catch (e) { return null; }
  }

  function _clearSession() {
    try { localStorage.removeItem('fc_session'); } catch (e) {}
  }

  function getSavedSession() { return _loadSession(); }

  // ── ROOM CODE ────────────────────────────────────────────
  function genRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  // ── HOST: CREATE ROOM ────────────────────────────────────
  function createRoom(playerName, maxPlayers, avatar, callbacks) {
    isHost = true;
    localPlayerName = playerName;
    localAvatar = avatar || { animal: 'none', color: 'gold' };
    expectedPlayers = maxPlayers;
    onStateUpdate = callbacks.onStateUpdate;
    onLobbyUpdate = callbacks.onLobbyUpdate;
    onMessage     = callbacks.onMessage;
    onError       = callbacks.onError;

    roomCode = genRoomCode();
    localPlayerId = 'host-' + roomCode;

    // Host also saves a session so they can be identified as host on reload
    _saveSession(localPlayerId, playerName, avatar, roomCode);

    peer = new Peer('fivecrowns-' + roomCode, {
      debug: 0,
      config: { iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ]}
    });

    peer.on('open', () => {
      _lobbyPlayers = [{ id: localPlayerId, name: playerName, avatar: localAvatar, isHost: true, connected: true }];
      onLobbyUpdate([..._lobbyPlayers]);
    });

    peer.on('connection', (conn) => {
      conn.on('open', () => {
        connections[conn.peer] = conn;
        conn.on('data', (data) => _handleHostReceive(conn.peer, data));
        conn.on('close', () => _handleDisconnect(conn.peer));
        conn.on('error', (e) => console.warn('[Host] Conn error', e));
      });
    });

    peer.on('error', (err) => { if (onError) onError('Connection error: ' + err.type); });
    return roomCode;
  }

  // ── GUEST: JOIN ROOM ─────────────────────────────────────
  function joinRoom(playerName, code, avatar, callbacks, isRejoin = false, savedPlayerId = null) {
    isHost = false;
    localPlayerName = playerName;
    localAvatar = avatar || { animal: 'none', color: 'gold' };
    roomCode = code.toUpperCase();
    onStateUpdate = callbacks.onStateUpdate;
    onLobbyUpdate = callbacks.onLobbyUpdate;
    onMessage     = callbacks.onMessage;
    onError       = callbacks.onError;

    // On rejoin, reuse the saved playerId so host can match the slot
    localPlayerId = (isRejoin && savedPlayerId) ? savedPlayerId : ('guest-' + Math.random().toString(36).slice(2, 8));

    peer = new Peer(localPlayerId, {
      debug: 0,
      config: { iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ]}
    });

    peer.on('open', () => {
      hostConn = peer.connect('fivecrowns-' + roomCode, { reliable: true });

      hostConn.on('open', () => {
        // Send join or rejoin message
        hostConn.send({
          type: isRejoin ? 'rejoin' : 'join',
          playerId: localPlayerId,
          name: playerName,
          avatar: localAvatar,
        });
        // Save session for future reconnects
        _saveSession(localPlayerId, playerName, localAvatar, roomCode);
      });

      hostConn.on('data', (data) => _handleGuestReceive(data));

      hostConn.on('close', () => {
        if (onError) onError('disconnected');
      });

      hostConn.on('error', (e) => {
        if (onError) onError('Host connection error: ' + e.type);
      });
    });

    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') {
        if (onError) onError('Room "' + roomCode + '" not found. Check the code.');
      } else {
        if (onError) onError('Connection error: ' + err.type);
      }
    });
  }

  // ── GUEST: REJOIN (called from main.js) ──────────────────
  function rejoinRoom(callbacks) {
    const session = _loadSession();
    if (!session) return false;
    joinRoom(session.name, session.roomCode, session.avatar, callbacks, true, session.playerId);
    return true;
  }

  // ── HOST: RECEIVE FROM GUEST ─────────────────────────────
  function _handleHostReceive(fromPeerId, data) {
    const gs = Game.get();

    // ── NEW JOIN ────────────────────────────────────────────
    if (data.type === 'join') {
      if (_lobbyPlayers.find(p => p.id === data.playerId)) return;
      _lobbyPlayers.push({
        id: data.playerId, name: data.name,
        avatar: data.avatar || { animal: 'none', color: 'gold' },
        peerId: fromPeerId, isHost: false, connected: true,
      });
      _broadcastAll({ type: 'lobby-update', players: _lobbyPlayers });
      connections[fromPeerId].send({ type: 'join-ack', playerId: data.playerId, roomCode });
      onLobbyUpdate([..._lobbyPlayers]);
      if (onMessage) onMessage(`${data.name} joined the room.`);
      return;
    }

    // ── REJOIN ──────────────────────────────────────────────
    if (data.type === 'rejoin') {
      const slot = _disconnectedSlots[data.playerId];

      if (slot) {
        // Clear the expiry timer
        clearTimeout(slot.timeoutHandle);
        delete _disconnectedSlots[data.playerId];

        // Restore player in lobby list with new peerId
        const existingIdx = _lobbyPlayers.findIndex(p => p.id === data.playerId);
        if (existingIdx !== -1) {
          _lobbyPlayers[existingIdx].peerId = fromPeerId;
          _lobbyPlayers[existingIdx].connected = true;
          _lobbyPlayers[existingIdx].disconnected = false;
        } else {
          _lobbyPlayers.push({
            id: data.playerId, name: slot.name,
            avatar: slot.avatar,
            peerId: fromPeerId, isHost: false, connected: true,
          });
        }

        connections[fromPeerId] = connections[fromPeerId] || peer.connections[fromPeerId]?.[0];

        // Send them their full game state back
        if (gs) {
          const pub = Game.getPublicState(gs, data.playerId);
          connections[fromPeerId].send({
            type: 'rejoin-ack',
            playerId: data.playerId,
            roomCode,
            publicState: pub,
            result: { action: 'rejoin' },
          });
        } else {
          connections[fromPeerId].send({ type: 'join-ack', playerId: data.playerId, roomCode });
        }

        // Tell everyone
        _broadcastAll({ type: 'lobby-update', players: _lobbyPlayers });
        onLobbyUpdate([..._lobbyPlayers]);
        if (onMessage) onMessage(`${slot.name} reconnected! 🎉`);

      } else {
        // No waiting slot — treat as a fresh join if game hasn't started
        if (!gs) {
          if (_lobbyPlayers.find(p => p.id === data.playerId)) return;
          _lobbyPlayers.push({
            id: data.playerId, name: data.name,
            avatar: data.avatar || { animal: 'none', color: 'gold' },
            peerId: fromPeerId, isHost: false, connected: true,
          });
          _broadcastAll({ type: 'lobby-update', players: _lobbyPlayers });
          connections[fromPeerId].send({ type: 'join-ack', playerId: data.playerId, roomCode });
          onLobbyUpdate([..._lobbyPlayers]);
        } else {
          // Game in progress, slot expired or never existed
          connections[fromPeerId].send({ type: 'error', msg: 'Reconnect window expired. Game is still in progress — ask the host to wait.' });
        }
      }
      return;
    }

    if (!gs) return;

    // ── GAME ACTIONS ────────────────────────────────────────
    let result = null;
    if (data.type === 'draw-deck')         result = Game.drawFromDeck(gs, data.playerId);
    else if (data.type === 'draw-discard') result = Game.drawFromDiscard(gs, data.playerId);
    else if (data.type === 'discard')      result = Game.discardCard(gs, data.playerId, data.cardId);
    else if (data.type === 'go-out')       result = Game.goOut(gs, data.playerId, data.discardCardId, data.meldGroups);
    else if (data.type === 'next-round')   result = Game.nextRound(gs);

    if (result && result.ok) {
      _broadcastState(gs, result);
      if (onStateUpdate) onStateUpdate(Game.getPublicState(gs, localPlayerId), result);
    } else if (result && !result.ok) {
      const conn = connections[fromPeerId];
      if (conn) conn.send({ type: 'error', msg: result.err });
    }
  }

  // ── GUEST: RECEIVE FROM HOST ──────────────────────────────
  function _handleGuestReceive(data) {
    if (data.type === 'join-ack') {
      localPlayerId = data.playerId;
      return;
    }
    if (data.type === 'rejoin-ack') {
      localPlayerId = data.playerId;
      // Restore full game state
      if (onStateUpdate) onStateUpdate(data.publicState, data.result);
      return;
    }
    if (data.type === 'lobby-update') {
      _lobbyPlayers = data.players;
      if (onLobbyUpdate) onLobbyUpdate([...data.players]);
      return;
    }
    if (data.type === 'game-start')   { if (onStateUpdate) onStateUpdate(data.publicState, { action: 'round-start' }); return; }
    if (data.type === 'state-update') { if (onStateUpdate) onStateUpdate(data.publicState, data.result); return; }
    if (data.type === 'message')      { if (onMessage) onMessage(data.msg); return; }
    if (data.type === 'error')        { if (onError) onError(data.msg); return; }
  }

  // ── HOST: START GAME ─────────────────────────────────────
  function hostStartGame() {
    if (!isHost) return;
    const playerIds     = _lobbyPlayers.map(p => p.id);
    const playerNames   = _lobbyPlayers.map(p => p.name);
    const playerAvatars = _lobbyPlayers.map(p => p.avatar);

    const gs = Game.fresh(playerIds, playerNames, localPlayerId, playerAvatars);
    Game.set(gs);
    Game.dealRound(gs);
    _broadcastState(gs, { action: 'round-start' }, true);
    const pub = Game.getPublicState(gs, localPlayerId);
    if (onStateUpdate) onStateUpdate(pub, { action: 'round-start' });
  }

  // ── HOST: HANDLE DISCONNECT ──────────────────────────────
  function _handleDisconnect(peerId) {
    delete connections[peerId];

    const idx = _lobbyPlayers.findIndex(p => p.peerId === peerId);
    if (idx === -1) return;

    const player = _lobbyPlayers[idx];
    const gs = Game.get();

    if (gs) {
      // Game in progress — keep the slot warm, mark as disconnected
      player.connected = false;
      player.disconnected = true;

      // Store in waiting slots with a 3-minute expiry
      const timeoutHandle = setTimeout(() => {
        _expireDisconnectedSlot(player.id);
      }, RECONNECT_WINDOW_MS);

      _disconnectedSlots[player.id] = {
        playerId: player.id,
        name: player.name,
        avatar: player.avatar,
        peerId,
        disconnectedAt: Date.now(),
        timeoutHandle,
      };

      // Notify everyone the player dropped but can come back
      _broadcastAll({ type: 'lobby-update', players: _lobbyPlayers });
      if (onLobbyUpdate) onLobbyUpdate([..._lobbyPlayers]);
      if (onMessage) onMessage(`⚠️ ${player.name} disconnected. They have 3 minutes to rejoin.`);

      // If it was their turn, skip it after 30 seconds so the game doesn't freeze
      const isTheirTurn = gs.players[gs.turnIdx]?.id === player.id;
      if (isTheirTurn) {
        if (onMessage) onMessage(`⏳ ${player.name}'s turn will be skipped in 30 seconds if they don't return.`);
        setTimeout(() => {
          // Only skip if still disconnected
          if (_disconnectedSlots[player.id]) {
            const currentGs = Game.get();
            if (!currentGs) return;
            if (currentGs.players[currentGs.turnIdx]?.id === player.id) {
              // Auto-discard their first card to advance the turn
              const disconnectedPlayer = currentGs.players.find(p => p.id === player.id);
              if (disconnectedPlayer?.hand?.length > 0) {
                // Draw a card for them first if needed
                if (currentGs.phase === 'draw' || (currentGs.phase === 'going-out' && !currentGs.drawnThisTurn)) {
                  Game.drawFromDeck(currentGs, player.id);
                }
                // Then discard first card
                if (disconnectedPlayer.hand.length > 0) {
                  const result = Game.discardCard(currentGs, player.id, disconnectedPlayer.hand[0].id);
                  if (result?.ok) {
                    _broadcastState(currentGs, result);
                    if (onStateUpdate) onStateUpdate(Game.getPublicState(currentGs, localPlayerId), result);
                    if (onMessage) onMessage(`⏭ ${player.name}'s turn was skipped (disconnected).`);
                  }
                }
              }
            }
          }
        }, 30000);
      }

    } else {
      // Still in lobby — just remove them
      _lobbyPlayers.splice(idx, 1);
      _broadcastAll({ type: 'lobby-update', players: _lobbyPlayers });
      if (onLobbyUpdate) onLobbyUpdate([..._lobbyPlayers]);
      if (onMessage) onMessage(`${player.name} left the lobby.`);
    }
  }

  // Remove disconnected slot after timeout expires
  function _expireDisconnectedSlot(playerId) {
    const slot = _disconnectedSlots[playerId];
    if (!slot) return;
    delete _disconnectedSlots[playerId];

    // Remove from lobby list entirely
    const idx = _lobbyPlayers.findIndex(p => p.id === playerId);
    if (idx !== -1) {
      const name = _lobbyPlayers[idx].name;
      _lobbyPlayers.splice(idx, 1);
      _broadcastAll({ type: 'lobby-update', players: _lobbyPlayers });
      if (onLobbyUpdate) onLobbyUpdate([..._lobbyPlayers]);
      if (onMessage) onMessage(`${name}'s reconnect window expired. They have been removed.`);
    }
  }

  // ── BROADCAST ────────────────────────────────────────────
  function _broadcastState(gs, result, isStart = false) {
    for (const [peerId, conn] of Object.entries(connections)) {
      const guestPlayer = _lobbyPlayers.find(p => p.peerId === peerId && p.connected);
      if (!guestPlayer) continue;
      const pub = Game.getPublicState(gs, guestPlayer.id);
      conn.send({ type: isStart ? 'game-start' : 'state-update', publicState: pub, result });
    }
  }

  function _broadcastAll(msg) {
    for (const conn of Object.values(connections)) {
      try { conn.send(msg); } catch (e) {}
    }
  }

  // ── GUEST: SEND ACTION ────────────────────────────────────
  function sendAction(actionData) {
    if (isHost) {
      const gs = Game.get();
      if (!gs) return;
      let result = null;
      if (actionData.type === 'draw-deck')    result = Game.drawFromDeck(gs, localPlayerId);
      if (actionData.type === 'draw-discard') result = Game.drawFromDiscard(gs, localPlayerId);
      if (actionData.type === 'discard')      result = Game.discardCard(gs, localPlayerId, actionData.cardId);
      if (actionData.type === 'go-out')       result = Game.goOut(gs, localPlayerId, actionData.discardCardId, actionData.meldGroups);
      if (actionData.type === 'next-round')   result = Game.nextRound(gs);
      if (result && result.ok) {
        _broadcastState(gs, result);
        const pub = Game.getPublicState(gs, localPlayerId);
        if (onStateUpdate) onStateUpdate(pub, result);
      } else if (result && !result.ok) {
        if (onError) onError(result.err);
      }
    } else {
      if (hostConn && hostConn.open) {
        hostConn.send({ ...actionData, playerId: localPlayerId });
      }
    }
  }

  function destroy() {
    // Clear all reconnect timers
    Object.values(_disconnectedSlots).forEach(s => clearTimeout(s.timeoutHandle));
    _disconnectedSlots = {};
    if (peer) { peer.destroy(); peer = null; }
    connections = {}; hostConn = null; _lobbyPlayers = [];
  }

  function getLobbyPlayers()    { return [..._lobbyPlayers]; }
  function getLocalPlayerId()   { return localPlayerId; }
  function getLocalPlayerName() { return localPlayerName; }
  function getLocalAvatar()     { return localAvatar; }
  function getIsHost()          { return isHost; }
  function getRoomCode()        { return roomCode; }
  function getExpectedPlayers() { return expectedPlayers; }

  return {
    createRoom, joinRoom, rejoinRoom, hostStartGame, sendAction, destroy,
    getLobbyPlayers, getLocalPlayerId, getLocalPlayerName, getLocalAvatar,
    getIsHost, getRoomCode, getExpectedPlayers,
    getSavedSession, clearSession: _clearSession,
  };
})();
