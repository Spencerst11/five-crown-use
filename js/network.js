// ============================================================
// network.js — Supabase-backed Networking (v6)
// ============================================================
// HOW IT WORKS NOW:
//   - All game state lives in a Supabase table (not on a phone)
//   - One player is the logical "host" who runs game rules,
//     but every change is saved to Supabase immediately
//   - Supabase Realtime pushes updates to all players live
//   - ANY player can close the app for minutes and rejoin —
//     they just re-read the latest state from the server
//   - Works identically on iPhone and Android
//
// PUBLIC API is identical to the old PeerJS version so the
// rest of the game code does not need big changes.
// ============================================================

const Network = (() => {

  // ── SUPABASE CONFIG ──────────────────────────────────────
  const SUPABASE_URL = 'https://tslmgvqalnkjejvohhuj.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRzbG1ndnFhbG5ramVqdm9oaHVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMzM2MDYsImV4cCI6MjA5NTcwOTYwNn0.8TWNAwOGEPZZFExkPkYMNvarFvZvCFya3gJjGpriikg';

  let supabase = null;

  // ── LOCAL STATE ──────────────────────────────────────────
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

  let _channel = null;        // Supabase realtime channel
  let _lobbyPlayers = [];
  let _lastWriteAt = 0;
  let _pollTimer = null;      // fallback poll in case realtime misses
  let _heartbeatTimer = null; // marks this player present
  let _isStarted = false;

  // ── INIT SUPABASE CLIENT ─────────────────────────────────
  function _initClient() {
    if (supabase) return supabase;
    if (!window.supabase) {
      if (onError) onError('Supabase library failed to load. Check your internet connection.');
      return null;
    }
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 10 } },
    });
    return supabase;
  }

  // ── SESSION STORAGE (for rejoin after closing app) ───────
  function _saveSession(playerId, name, avatar, code, host) {
    try {
      localStorage.setItem('fc_session', JSON.stringify({
        playerId, name, avatar, roomCode: code, isHost: host,
        savedAt: Date.now(),
      }));
    } catch (e) {}
  }
  function _loadSession() {
    try {
      const raw = localStorage.getItem('fc_session');
      if (!raw) return null;
      const s = JSON.parse(raw);
      // Sessions valid for 2 hours (server keeps the game alive)
      if (Date.now() - s.savedAt > 2 * 60 * 60 * 1000) {
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

  // ── SERVER READ / WRITE ──────────────────────────────────
  // The whole room (lobby + game state) is stored as one JSON row.

  async function _readRoom(code) {
    const { data, error } = await supabase
      .from('game_rooms')
      .select('state')
      .eq('id', code)
      .maybeSingle();
    if (error) { console.warn('[read] error', error.message); return null; }
    return data ? data.state : null;
  }

  async function _writeRoom(code, state) {
    _lastWriteAt = Date.now();
    const { error } = await supabase
      .from('game_rooms')
      .upsert({ id: code, state });
    if (error) {
      console.warn('[write] error', error.message, error.details, error.hint);
      if (onError) onError('Failed to save: ' + error.message);
      return false;
    }
    return true;
  }

  // The room "state" envelope:
  // {
  //   lobbyPlayers: [...],
  //   gameState: <Game public-ish state or null>,
  //   startedAt, hostId, lastAction, presence: { playerId: timestamp }
  // }

  function _freshRoomEnvelope() {
    return {
      hostId: localPlayerId,
      lobbyPlayers: _lobbyPlayers,
      gameState: null,       // full authoritative Game state (host writes it)
      lastResult: null,      // last action result (for animations/toasts)
      startedAt: null,
      presence: {},
      version: 0,
    };
  }

  // ── REALTIME SUBSCRIPTION ────────────────────────────────
  function _subscribe(code) {
    if (_channel) { supabase.removeChannel(_channel); _channel = null; }

    _channel = supabase
      .channel('room-' + code)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'game_rooms', filter: `id=eq.${code}` },
        (payload) => {
          const newState = payload.new && payload.new.state;
          if (newState) _onRoomUpdate(newState);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Initial fetch in case we missed anything
          _refreshFromServer();
        }
      });

    // Fallback polling every 3s (covers any missed realtime events,
    // e.g. phone was asleep). Cheap for a family game.
    clearInterval(_pollTimer);
    _pollTimer = setInterval(_refreshFromServer, 3000);
  }

  async function _refreshFromServer() {
    if (!roomCode) return;
    const state = await _readRoom(roomCode);
    if (state) _onRoomUpdate(state, true);
  }

  // Called whenever we get new room state (from realtime or poll)
  let _lastVersionSeen = -1;
  function _onRoomUpdate(envelope, fromPoll = false) {
    if (!envelope) return;

    // Ignore older or duplicate versions
    if (typeof envelope.version === 'number') {
      if (envelope.version < _lastVersionSeen) return;
      if (envelope.version === _lastVersionSeen && fromPoll) return;
      _lastVersionSeen = envelope.version;
    }

    // Update lobby list
    _lobbyPlayers = envelope.lobbyPlayers || [];
    if (onLobbyUpdate) onLobbyUpdate([..._lobbyPlayers]);

    // If a game is in progress, push the state to the UI
    if (envelope.gameState) {
      // Make sure the local Game module has the authoritative state
      // (so host logic + getPublicState work for everyone)
      Game.set(envelope.gameState);
      const pub = Game.getPublicState(envelope.gameState, localPlayerId);
      const result = envelope.lastResult || { action: 'sync' };
      if (onStateUpdate) onStateUpdate(pub, result);
    }
  }

  // ── PRESENCE HEARTBEAT ───────────────────────────────────
  // Marks this player as "present" so others can show who's online.
  function _startHeartbeat() {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = setInterval(async () => {
      // Light-touch: we don't need to write constantly for a family game.
      // Presence is optional; skipping heavy writes to stay within free tier.
    }, 20000);
  }

  // ── HOST: CREATE ROOM ────────────────────────────────────
  async function createRoom(playerName, maxPlayers, avatar, callbacks) {
    isHost = true;
    localPlayerName = playerName;
    localAvatar = avatar || { animal: 'none', color: 'gold' };
    expectedPlayers = maxPlayers;
    onStateUpdate = callbacks.onStateUpdate;
    onLobbyUpdate = callbacks.onLobbyUpdate;
    onMessage     = callbacks.onMessage;
    onError       = callbacks.onError;

    if (!_initClient()) return null;

    roomCode = genRoomCode();
    localPlayerId = 'host-' + roomCode;

    _lobbyPlayers = [{
      id: localPlayerId, name: playerName,
      avatar: localAvatar, isHost: true, connected: true,
    }];

    const envelope = _freshRoomEnvelope();
    envelope.expectedPlayers = maxPlayers;
    envelope.version = 1;
    _lastVersionSeen = 1;

    const ok = await _writeRoom(roomCode, envelope);
    if (!ok) { if (onError) onError('Could not create room. Try again.'); return null; }

    _saveSession(localPlayerId, playerName, localAvatar, roomCode, true);
    _subscribe(roomCode);
    _startHeartbeat();

    if (onLobbyUpdate) onLobbyUpdate([..._lobbyPlayers]);
    return roomCode;
  }

  // ── GUEST: JOIN ROOM ─────────────────────────────────────
  async function joinRoom(playerName, code, avatar, callbacks, isRejoin = false, savedPlayerId = null) {
    isHost = false;
    localPlayerName = playerName;
    localAvatar = avatar || { animal: 'none', color: 'gold' };
    roomCode = code.toUpperCase();
    onStateUpdate = callbacks.onStateUpdate;
    onLobbyUpdate = callbacks.onLobbyUpdate;
    onMessage     = callbacks.onMessage;
    onError       = callbacks.onError;

    if (!_initClient()) return;

    localPlayerId = (isRejoin && savedPlayerId)
      ? savedPlayerId
      : ('guest-' + Math.random().toString(36).slice(2, 8));

    // Read current room
    const envelope = await _readRoom(roomCode);
    if (!envelope) {
      if (onError) onError('Room "' + roomCode + '" not found. Check the code.');
      return;
    }

    expectedPlayers = envelope.expectedPlayers || 4;
    _lobbyPlayers = envelope.lobbyPlayers || [];

    // If host hasn't started, add us to the lobby
    const existing = _lobbyPlayers.find(p => p.id === localPlayerId);
    if (!existing) {
      // Is the lobby full? (only enforce before game start)
      if (!envelope.gameState && _lobbyPlayers.length >= expectedPlayers) {
        if (onError) onError('This room is full.');
        return;
      }
      _lobbyPlayers.push({
        id: localPlayerId, name: playerName,
        avatar: localAvatar, isHost: false, connected: true,
      });
    } else {
      existing.connected = true;
      existing.disconnected = false;
    }

    // Write our presence into the lobby
    envelope.lobbyPlayers = _lobbyPlayers;
    envelope.version = (envelope.version || 0) + 1;
    _lastVersionSeen = envelope.version;
    await _writeRoom(roomCode, envelope);

    _saveSession(localPlayerId, playerName, localAvatar, roomCode, false);
    _subscribe(roomCode);
    _startHeartbeat();

    if (onLobbyUpdate) onLobbyUpdate([..._lobbyPlayers]);
    if (onMessage && !isRejoin) onMessage(`You joined room ${roomCode}.`);

    // If a game is already running, drop straight into it
    if (envelope.gameState) {
      Game.set(envelope.gameState);
      const pub = Game.getPublicState(envelope.gameState, localPlayerId);
      if (onStateUpdate) onStateUpdate(pub, { action: isRejoin ? 'rejoin' : 'sync' });
    }
  }

  // ── REJOIN (after closing app) ───────────────────────────
  async function rejoinRoom(callbacks) {
    const session = _loadSession();
    if (!session) return false;
    isHost = session.isHost;
    await joinRoom(session.name, session.roomCode, session.avatar, callbacks, true, session.playerId);
    return true;
  }

  // ── HOST: START GAME ─────────────────────────────────────
  async function hostStartGame() {
    if (!isHost) return;

    // Disable button immediately to prevent double-tap
    const btn = document.getElementById('start-game-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }

    try {
      const playerIds     = _lobbyPlayers.map(p => p.id);
      const playerNames   = _lobbyPlayers.map(p => p.name);
      const playerAvatars = _lobbyPlayers.map(p => p.avatar);

      const gs = Game.fresh(playerIds, playerNames, localPlayerId, playerAvatars);
      Game.set(gs);
      Game.dealRound(gs);
      _isStarted = true;

      const ok = await _pushGameState(gs, { action: 'round-start' });
      if (!ok) {
        if (onError) onError('Could not start game — failed to save to server. Check your Supabase table exists.');
        if (btn) { btn.disabled = false; btn.textContent = 'START GAME'; }
        return;
      }

      // Update host UI immediately
      const pub = Game.getPublicState(gs, localPlayerId);
      if (onStateUpdate) onStateUpdate(pub, { action: 'round-start' });
    } catch (err) {
      console.error('[hostStartGame] error:', err);
      if (onError) onError('Start game error: ' + err.message);
      if (btn) { btn.disabled = false; btn.textContent = 'START GAME'; }
    }
  }

  // Write the authoritative game state to the server
  async function _pushGameState(gs, result) {
    // Build envelope from scratch rather than re-reading — avoids stale data race
    const envelope = {
      hostId: localPlayerId,
      lobbyPlayers: _lobbyPlayers,
      gameState: gs,
      lastResult: result || null,
      startedAt: new Date().toISOString(),
      expectedPlayers: expectedPlayers,
      version: (_lastVersionSeen || 0) + 1,
    };
    _lastVersionSeen = envelope.version;
    return await _writeRoom(roomCode, envelope);
  }

  // ── SEND ACTION ──────────────────────────────────────────
  // Every player can send actions. The host applies them authoritatively.
  // To keep it simple and robust for a family game, EACH client applies
  // the action to its local Game copy AND writes the new state. Because
  // we use version numbers + last-write-wins, the turn-based nature means
  // only the active player is acting at a time, so conflicts don't occur.

  async function sendAction(actionData) {
    const gs = Game.get();
    if (!gs) return;

    // Validate it's actually this player's turn for turn actions
    let result = null;
    const pid = localPlayerId;

    if (actionData.type === 'draw-deck')        result = Game.drawFromDeck(gs, pid);
    else if (actionData.type === 'draw-discard') result = Game.drawFromDiscard(gs, pid);
    else if (actionData.type === 'discard')      result = Game.discardCard(gs, pid, actionData.cardId);
    else if (actionData.type === 'go-out')       result = Game.goOut(gs, pid, actionData.discardCardId, actionData.meldGroups);
    else if (actionData.type === 'next-round') {
      // Only host advances rounds
      if (!isHost) return;
      result = Game.nextRound(gs);
    }

    if (result && result.ok) {
      // Save to server — everyone (including us) will get the update
      await _pushGameState(gs, result);
      // Update our own UI right away (don't wait for the round trip)
      const pub = Game.getPublicState(gs, localPlayerId);
      if (onStateUpdate) onStateUpdate(pub, result);
    } else if (result && !result.ok) {
      if (onError) onError(result.err);
    }
  }

  // ── DESTROY / LEAVE ──────────────────────────────────────
  async function destroy() {
    clearInterval(_pollTimer);
    clearInterval(_heartbeatTimer);
    if (_channel && supabase) { supabase.removeChannel(_channel); _channel = null; }

    // Remove ourselves from the lobby if game hasn't started
    try {
      if (roomCode && supabase) {
        const envelope = await _readRoom(roomCode);
        if (envelope && !envelope.gameState) {
          envelope.lobbyPlayers = (envelope.lobbyPlayers || []).filter(p => p.id !== localPlayerId);
          envelope.version = (envelope.version || 0) + 1;
          // If the room is now empty, we could delete it, but leaving it is harmless
          await _writeRoom(roomCode, envelope);
        }
      }
    } catch (e) {}

    _lobbyPlayers = [];
    roomCode = '';
    _isStarted = false;
    _lastVersionSeen = -1;
  }

  // ── GETTERS ──────────────────────────────────────────────
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
