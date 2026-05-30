// ============================================================
// network.js — P2P Networking via PeerJS (v2)
// ============================================================

const Network = (() => {

  let peer = null;
  let connections = {};
  let hostConn = null;
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

    peer = new Peer('fivecrowns-' + roomCode, {
      debug: 0,
      config: { iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ]}
    });

    peer.on('open', () => {
      _lobbyPlayers = [{ id: localPlayerId, name: playerName, avatar: localAvatar, isHost: true }];
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

    peer.on('error', (err) => {
      if (onError) onError('Connection error: ' + err.type);
    });

    return roomCode;
  }

  // ── GUEST: JOIN ROOM ─────────────────────────────────────
  function joinRoom(playerName, code, avatar, callbacks) {
    isHost = false;
    localPlayerName = playerName;
    localAvatar = avatar || { animal: 'none', color: 'gold' };
    roomCode = code.toUpperCase();
    onStateUpdate = callbacks.onStateUpdate;
    onLobbyUpdate = callbacks.onLobbyUpdate;
    onMessage     = callbacks.onMessage;
    onError       = callbacks.onError;

    localPlayerId = 'guest-' + Math.random().toString(36).slice(2, 8);

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
        hostConn.send({ type: 'join', playerId: localPlayerId, name: playerName, avatar: localAvatar });
      });
      hostConn.on('data', (data) => _handleGuestReceive(data));
      hostConn.on('close', () => { if (onError) onError('Disconnected from host.'); });
      hostConn.on('error', (e) => { if (onError) onError('Host connection error: ' + e.type); });
    });

    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') {
        if (onError) onError('Room "' + roomCode + '" not found. Check the code.');
      } else {
        if (onError) onError('Connection error: ' + err.type);
      }
    });
  }

  // ── HOST: RECEIVE FROM GUEST ─────────────────────────────
  function _handleHostReceive(fromPeerId, data) {
    const gs = Game.get();

    if (data.type === 'join') {
      if (_lobbyPlayers.find(p => p.id === data.playerId)) return;
      _lobbyPlayers.push({ id: data.playerId, name: data.name, avatar: data.avatar || { animal: 'none', color: 'gold' }, peerId: fromPeerId, isHost: false });
      _broadcastAll({ type: 'lobby-update', players: _lobbyPlayers });
      connections[fromPeerId].send({ type: 'join-ack', playerId: data.playerId, roomCode });
      onLobbyUpdate([..._lobbyPlayers]);
      if (onMessage) onMessage(`${data.name} joined the room.`);
      return;
    }

    if (!gs) return;

    let result = null;
    if (data.type === 'draw-deck')    result = Game.drawFromDeck(gs, data.playerId);
    else if (data.type === 'draw-discard') result = Game.drawFromDiscard(gs, data.playerId);
    else if (data.type === 'discard')      result = Game.discardCard(gs, data.playerId, data.cardId);
    else if (data.type === 'go-out')       result = Game.goOut(gs, data.playerId);
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
    if (data.type === 'join-ack') { localPlayerId = data.playerId; return; }
    if (data.type === 'lobby-update') {
      _lobbyPlayers = data.players;
      if (onLobbyUpdate) onLobbyUpdate([...data.players]);
      return;
    }
    if (data.type === 'game-start') {
      if (onStateUpdate) onStateUpdate(data.publicState, { action: 'round-start' });
      return;
    }
    if (data.type === 'state-update') {
      if (onStateUpdate) onStateUpdate(data.publicState, data.result);
      return;
    }
    if (data.type === 'message') { if (onMessage) onMessage(data.msg); return; }
    if (data.type === 'error')   { if (onError)   onError(data.msg);   return; }
  }

  // ── HOST: START GAME ─────────────────────────────────────
  function hostStartGame() {
    if (!isHost) return;
    const playerIds    = _lobbyPlayers.map(p => p.id);
    const playerNames  = _lobbyPlayers.map(p => p.name);
    const playerAvatars= _lobbyPlayers.map(p => p.avatar);

    const gs = Game.fresh(playerIds, playerNames, localPlayerId, playerAvatars);
    Game.set(gs);
    Game.dealRound(gs);

    _broadcastState(gs, { action: 'round-start' }, true);
    const pub = Game.getPublicState(gs, localPlayerId);
    if (onStateUpdate) onStateUpdate(pub, { action: 'round-start' });
  }

  // ── BROADCAST ────────────────────────────────────────────
  function _broadcastState(gs, result, isStart = false) {
    for (const [peerId, conn] of Object.entries(connections)) {
      const guestPlayer = _lobbyPlayers.find(p => p.peerId === peerId);
      if (!guestPlayer) continue;
      const pub = Game.getPublicState(gs, guestPlayer.id);
      conn.send({ type: isStart ? 'game-start' : 'state-update', publicState: pub, result });
    }
  }

  function _broadcastAll(msg) {
    for (const conn of Object.values(connections)) conn.send(msg);
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
      if (hostConn && hostConn.open) hostConn.send({ ...actionData, playerId: localPlayerId });
    }
  }

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
    _lobbyPlayers = [];
  }

  function getLobbyPlayers()    { return [..._lobbyPlayers]; }
  function getLocalPlayerId()   { return localPlayerId; }
  function getLocalPlayerName() { return localPlayerName; }
  function getLocalAvatar()     { return localAvatar; }
  function getIsHost()          { return isHost; }
  function getRoomCode()        { return roomCode; }
  function getExpectedPlayers() { return expectedPlayers; }

  return {
    createRoom, joinRoom, hostStartGame, sendAction, destroy,
    getLobbyPlayers, getLocalPlayerId, getLocalPlayerName, getLocalAvatar,
    getIsHost, getRoomCode, getExpectedPlayers,
  };
})();
