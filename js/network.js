// ============================================================
// network.js — P2P Networking via PeerJS
// ============================================================
// Architecture:
//   HOST: One player creates a room. They run the authoritative
//         Game state. They connect to all other peers.
//   GUESTS: Connect to host's PeerID (= the room code).
//         They send actions; host processes & broadcasts state.
// ============================================================

const Network = (() => {

  let peer = null;          // Our PeerJS instance
  let connections = {};     // peerId → DataConnection (host only)
  let hostConn = null;      // Connection to host (guest only)
  let isHost = false;
  let localPlayerId = null;
  let localPlayerName = '';
  let roomCode = '';
  let expectedPlayers = 4;
  let onStateUpdate = null; // callback(publicState)
  let onLobbyUpdate = null; // callback(playerList)
  let onMessage = null;     // callback(msg)
  let onError = null;       // callback(err)

  // ── ROOM CODE ────────────────────────────────────────────
  function genRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  // ── HOST: CREATE ROOM ────────────────────────────────────
  function createRoom(playerName, maxPlayers, callbacks) {
    isHost = true;
    localPlayerName = playerName;
    expectedPlayers = maxPlayers;
    onStateUpdate = callbacks.onStateUpdate;
    onLobbyUpdate = callbacks.onLobbyUpdate;
    onMessage     = callbacks.onMessage;
    onError       = callbacks.onError;

    roomCode = genRoomCode();
    localPlayerId = 'host-' + roomCode;

    peer = new Peer('fivecrowns-' + roomCode, {
      debug: 0,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ]
      }
    });

    peer.on('open', () => {
      console.log('[Host] Peer open, room:', roomCode);
      // Init lobby with just host
      _lobbyPlayers = [{ id: localPlayerId, name: playerName, isHost: true }];
      onLobbyUpdate([..._lobbyPlayers]);
    });

    peer.on('connection', (conn) => {
      console.log('[Host] Incoming connection from', conn.peer);
      conn.on('open', () => {
        connections[conn.peer] = conn;
        conn.on('data', (data) => _handleHostReceive(conn.peer, data));
        conn.on('close', () => _handleDisconnect(conn.peer));
        conn.on('error', (e) => console.warn('[Host] Conn error', e));
      });
    });

    peer.on('error', (err) => {
      console.error('[Peer error]', err);
      if (onError) onError('Connection error: ' + err.type);
    });

    return roomCode;
  }

  // ── GUEST: JOIN ROOM ─────────────────────────────────────
  function joinRoom(playerName, code, callbacks) {
    isHost = false;
    localPlayerName = playerName;
    roomCode = code.toUpperCase();
    onStateUpdate = callbacks.onStateUpdate;
    onLobbyUpdate = callbacks.onLobbyUpdate;
    onMessage     = callbacks.onMessage;
    onError       = callbacks.onError;

    localPlayerId = 'guest-' + Math.random().toString(36).slice(2, 8);

    peer = new Peer(localPlayerId, {
      debug: 0,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ]
      }
    });

    peer.on('open', () => {
      console.log('[Guest] Peer open, joining room', roomCode);
      hostConn = peer.connect('fivecrowns-' + roomCode, { reliable: true });

      hostConn.on('open', () => {
        console.log('[Guest] Connected to host');
        // Send join request
        hostConn.send({ type: 'join', playerId: localPlayerId, name: playerName });
      });

      hostConn.on('data', (data) => _handleGuestReceive(data));

      hostConn.on('close', () => {
        if (onError) onError('Disconnected from host.');
      });

      hostConn.on('error', (e) => {
        if (onError) onError('Host connection error: ' + e.type);
      });
    });

    peer.on('error', (err) => {
      console.error('[Peer error]', err);
      if (err.type === 'peer-unavailable') {
        if (onError) onError('Room "' + roomCode + '" not found. Check the code.');
      } else {
        if (onError) onError('Connection error: ' + err.type);
      }
    });
  }

  // ── HOST: RECEIVE FROM GUEST ─────────────────────────────
  let _lobbyPlayers = [];

  function _handleHostReceive(fromPeerId, data) {
    const gs = Game.get();

    if (data.type === 'join') {
      // Add to lobby
      if (_lobbyPlayers.find(p => p.id === data.playerId)) return; // duplicate
      _lobbyPlayers.push({ id: data.playerId, name: data.name, peerId: fromPeerId, isHost: false });

      // Send lobby update to all
      _broadcastAll({ type: 'lobby-update', players: _lobbyPlayers });

      // Also send back to new joiner directly
      connections[fromPeerId].send({ type: 'join-ack', playerId: data.playerId, roomCode });
      onLobbyUpdate([..._lobbyPlayers]);
      if (onMessage) onMessage(`${data.name} joined the room.`);
      return;
    }

    if (!gs) return;

    // Game actions — host processes & rebroadcasts state
    let result = null;

    if (data.type === 'draw-deck') {
      result = Game.drawFromDeck(gs, data.playerId);
    } else if (data.type === 'draw-discard') {
      result = Game.drawFromDiscard(gs, data.playerId);
    } else if (data.type === 'discard') {
      result = Game.discardCard(gs, data.playerId, data.cardId);
    } else if (data.type === 'go-out') {
      result = Game.goOut(gs, data.playerId);
    } else if (data.type === 'next-round') {
      if (data.playerId === localPlayerId || isHost) {
        result = Game.nextRound(gs);
      }
    }

    if (result && result.ok) {
      _broadcastState(gs, result);
      // Update local UI too
      if (onStateUpdate) {
        const pub = Game.getPublicState(gs, localPlayerId);
        onStateUpdate(pub, result);
      }
    } else if (result && !result.ok) {
      // Send error back to sender
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
    if (data.type === 'lobby-update') {
      _lobbyPlayers = data.players;
      if (onLobbyUpdate) onLobbyUpdate([...data.players]);
      return;
    }
    if (data.type === 'game-start') {
      // Host sent us our initial game state
      const pub = data.publicState;
      if (onStateUpdate) onStateUpdate(pub, { action: 'round-start' });
      return;
    }
    if (data.type === 'state-update') {
      if (onStateUpdate) onStateUpdate(data.publicState, data.result);
      return;
    }
    if (data.type === 'message') {
      if (onMessage) onMessage(data.msg);
      return;
    }
    if (data.type === 'error') {
      if (onError) onError(data.msg);
      return;
    }
  }

  // ── HOST: START GAME ─────────────────────────────────────
  function hostStartGame() {
    if (!isHost) return;
    const playerIds   = _lobbyPlayers.map(p => p.id);
    const playerNames = _lobbyPlayers.map(p => p.name);

    const gs = Game.fresh(playerIds, playerNames, localPlayerId);
    Game.set(gs);
    Game.dealRound(gs);

    // Send each player their own view of the state
    _broadcastState(gs, { action: 'round-start' }, true);

    // Update host's own UI
    const pub = Game.getPublicState(gs, localPlayerId);
    if (onStateUpdate) onStateUpdate(pub, { action: 'round-start' });
  }

  // ── HOST: BROADCAST STATE ────────────────────────────────
  function _broadcastState(gs, result, isStart = false) {
    // Send personalised state to each guest
    for (const [peerId, conn] of Object.entries(connections)) {
      const guestPlayer = _lobbyPlayers.find(p => p.peerId === peerId);
      if (!guestPlayer) continue;
      const pub = Game.getPublicState(gs, guestPlayer.id);
      conn.send({
        type: isStart ? 'game-start' : 'state-update',
        publicState: pub,
        result,
      });
    }
  }

  function _broadcastAll(msg) {
    for (const conn of Object.values(connections)) {
      conn.send(msg);
    }
  }

  // ── GUEST: SEND ACTION ────────────────────────────────────
  function sendAction(actionData) {
    if (isHost) {
      // Process locally as host
      const gs = Game.get();
      if (!gs) return;
      let result = null;
      if (actionData.type === 'draw-deck')    result = Game.drawFromDeck(gs, localPlayerId);
      if (actionData.type === 'draw-discard') result = Game.drawFromDiscard(gs, localPlayerId);
      if (actionData.type === 'discard')      result = Game.discardCard(gs, localPlayerId, actionData.cardId);
      if (actionData.type === 'go-out')       result = Game.goOut(gs, localPlayerId);
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

  // ── DISCONNECT ───────────────────────────────────────────
  function _handleDisconnect(peerId) {
    delete connections[peerId];
    const idx = _lobbyPlayers.findIndex(p => p.peerId === peerId);
    if (idx !== -1) {
      const name = _lobbyPlayers[idx].name;
      _lobbyPlayers.splice(idx, 1);
      _broadcastAll({ type: 'lobby-update', players: _lobbyPlayers });
      if (onLobbyUpdate) onLobbyUpdate([..._lobbyPlayers]);
      if (onMessage) onMessage(`${name} disconnected.`);
    }
  }

  function destroy() {
    if (peer) { peer.destroy(); peer = null; }
    connections = {};
    hostConn = null;
  }

  function getLobbyPlayers() { return [..._lobbyPlayers]; }
  function getLocalPlayerId() { return localPlayerId; }
  function getLocalPlayerName() { return localPlayerName; }
  function getIsHost() { return isHost; }
  function getRoomCode() { return roomCode; }
  function getExpectedPlayers() { return expectedPlayers; }

  return {
    createRoom, joinRoom, hostStartGame, sendAction, destroy,
    getLobbyPlayers, getLocalPlayerId, getLocalPlayerName,
    getIsHost, getRoomCode, getExpectedPlayers,
  };
})();
