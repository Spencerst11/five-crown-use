// ============================================================
// ui.js — DOM Rendering for Five Crowns
// ============================================================

const UI = (() => {

  // ── CARD RENDERING ───────────────────────────────────────

  function renderCard(card, opts = {}) {
    const { selected = false, round = 1, showWild = true, onClick = null, onDiscard = null } = opts;

    const el = document.createElement('div');
    el.classList.add('card');
    el.dataset.cardId = card.id;

    const wild = isWild(card, round);
    if (wild && showWild) el.classList.add('wild');
    if (selected) el.classList.add('selected');
    if (opts.inMeld) el.classList.add('in-meld');

    if (card.rank === 0) {
      // Joker
      el.classList.add('joker');
      el.innerHTML = `
        <div class="card-corner">
          <span class="card-value" style="color:#7b2d8b">J</span>
          <span class="card-suit-sm" style="color:#7b2d8b">K</span>
        </div>
        <div class="card-center">
          <div>
            <div class="card-joker-center">🃏</div>
            <div class="card-joker-label">JOKER</div>
          </div>
        </div>
        <div class="card-corner bottom">
          <span class="card-value" style="color:#7b2d8b">J</span>
          <span class="card-suit-sm" style="color:#7b2d8b">K</span>
        </div>`;
    } else {
      const ri = RANK_INFO[card.rank];
      const si = getSuitInfo(card.suit);
      el.innerHTML = `
        <div class="card-corner">
          <span class="card-value ${si.cls}">${ri.label}</span>
          <span class="card-suit-sm ${si.cls}">${si.symbol}</span>
        </div>
        <div class="card-center ${si.cls}" style="font-size:${ri.label==='10'?'1.3rem':'1.6rem'}">${si.symbol}</div>
        <div class="card-corner bottom">
          <span class="card-value ${si.cls}">${ri.label}</span>
          <span class="card-suit-sm ${si.cls}">${si.symbol}</span>
        </div>`;
    }

    if (onClick) el.addEventListener('click', (e) => { e.stopPropagation(); onClick(card, el); });

    return el;
  }

  function renderCardBack() {
    const el = document.createElement('div');
    el.className = 'card-back';
    el.textContent = '👑';
    return el;
  }

  // ── PLAYER HAND ─────────────────────────────────────────

  function renderHand(hand, round, selectedIds, onCardClick) {
    const container = document.getElementById('player-hand');
    container.innerHTML = '';

    // Group into detected melds for visual hint
    const meldResult = tryMeld(hand, round);
    const meldedCardIds = new Set(meldResult.melds.flat().map(c => c.id));

    hand.forEach(card => {
      const el = renderCard(card, {
        selected: selectedIds.has(card.id),
        round,
        inMeld: meldedCardIds.has(card.id),
        onClick: onCardClick,
      });
      container.appendChild(el);
    });
  }

  // ── DISCARD PILE ─────────────────────────────────────────

  function renderDiscardTop(card, round) {
    const container = document.getElementById('discard-top');
    container.innerHTML = '';
    if (!card) {
      const empty = document.createElement('div');
      empty.className = 'card-empty';
      empty.textContent = '—';
      container.appendChild(empty);
      return;
    }
    const el = renderCard(card, { round, showWild: true });
    el.style.position = 'relative';
    el.style.cursor = 'pointer';
    container.appendChild(el);
  }

  // ── OPPONENTS ────────────────────────────────────────────

  function renderOpponents(players, localPlayerId, currentTurnId) {
    const area = document.getElementById('opponents-area');
    area.innerHTML = '';

    players.forEach(p => {
      if (p.id === localPlayerId) return;

      const zone = document.createElement('div');
      zone.className = 'opponent-zone';
      if (p.id === currentTurnId) zone.classList.add('active-turn');
      if (p.wentOut) zone.classList.add('going-out');

      const initials = p.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
      const cardBacks = Math.min(p.handCount, 8);
      let backsHtml = '';
      for (let i = 0; i < cardBacks; i++) backsHtml += `<div class="opp-card-mini">👑</div>`;

      zone.innerHTML = `
        <div class="opp-avatar">${initials}</div>
        <div class="opp-info">
          <div class="opp-name">${escHtml(p.name)}${p.id === currentTurnId ? ' 🎯' : ''}${p.wentOut ? ' ✅' : ''}</div>
          <div class="opp-cards">${p.handCount} card${p.handCount !== 1 ? 's' : ''} · ${p.score}pts</div>
          <div class="opp-card-backs">${backsHtml}</div>
        </div>`;
      area.appendChild(zone);
    });
  }

  // ── LOBBY ────────────────────────────────────────────────

  function renderLobby(players, localPlayerId, maxPlayers) {
    const list = document.getElementById('lobby-players-list');
    list.innerHTML = '';

    for (let i = 0; i < maxPlayers; i++) {
      const p = players[i];
      const row = document.createElement('div');
      row.className = 'lobby-player-row';

      if (p) {
        const initials = p.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
        const isMe = p.id === localPlayerId;
        row.innerHTML = `
          <div class="player-avatar">${initials}</div>
          <div class="player-name-lobby">${escHtml(p.name)}${isMe ? ' (you)' : ''}</div>
          <div class="player-badge">${p.isHost ? '👑 Host' : '✓ Ready'}</div>`;
      } else {
        row.style.opacity = '0.3';
        row.innerHTML = `
          <div class="player-avatar" style="background:#2a2030">?</div>
          <div class="player-name-lobby" style="color:#443322">Waiting for player ${i+1}…</div>`;
      }
      list.appendChild(row);
    }

    const status = document.getElementById('lobby-status');
    const filled = players.length;
    if (filled < maxPlayers) {
      status.textContent = `${filled} / ${maxPlayers} players joined. Waiting for more…`;
    } else {
      status.textContent = `All ${maxPlayers} players have joined! Ready to start.`;
    }

    // Enable start button for host when min 2 players
    const startBtn = document.getElementById('start-game-btn');
    if (startBtn) {
      startBtn.disabled = filled < 2;
      startBtn.textContent = filled < 2 ? 'Need at least 2 players' : `START GAME (${filled} players)`;
    }
  }

  // ── GAME HEADER ──────────────────────────────────────────

  function updateHeader(round, phase, drawnThisTurn) {
    const roundNames = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven'];
    document.getElementById('hdr-round').textContent = `Round ${round} / 11`;
    document.getElementById('hdr-wild').textContent = `Wild: ${getWildLabel(round)}`;

    let phaseText = '';
    if (phase === 'draw') phaseText = drawnThisTurn ? 'Discard a card' : 'Draw a card';
    else if (phase === 'discard') phaseText = 'Discard a card';
    else if (phase === 'going-out') phaseText = 'Final turns!';
    else if (phase === 'round-end') phaseText = 'Round over';
    else if (phase === 'game-over') phaseText = 'Game over!';
    document.getElementById('hdr-phase').textContent = phaseText;
  }

  // ── TURN INDICATOR ────────────────────────────────────────

  function updateTurnIndicator(isMyTurn, phase) {
    const badge = document.getElementById('turn-indicator');
    badge.classList.toggle('hidden', !isMyTurn || phase === 'round-end' || phase === 'game-over');

    const goOutBtn = document.getElementById('btn-go-out');
    // Show GO OUT only on your discard turn
    goOutBtn.style.display = (isMyTurn && phase === 'discard') ? 'inline-block' : 'none';
  }

  // ── DRAW PILE ─────────────────────────────────────────────

  function updateDrawPile(count, isMyTurn, phase, canDraw) {
    document.getElementById('draw-count').textContent = `${count} cards`;
    const pile = document.getElementById('draw-pile');
    pile.style.opacity = (isMyTurn && phase === 'draw') ? '1' : '0.6';
    pile.style.cursor = (isMyTurn && phase === 'draw') ? 'pointer' : 'default';
  }

  // ── ACTION LOG ────────────────────────────────────────────

  function logAction(msg) {
    const log = document.getElementById('action-log');
    log.textContent = msg;
  }

  // ── ROUND RESULTS SCREEN ──────────────────────────────────

  function renderRoundResults(results, round, isGameOver, isHost) {
    const title = document.getElementById('round-result-title');
    title.textContent = isGameOver ? '🏆 Game Over!' : `Round ${round} Complete!`;

    const table = document.getElementById('round-scores-table');
    table.innerHTML = '';

    // Sort by total score ascending
    const sorted = [...results].sort((a, b) => a.totalScore - b.totalScore);

    const t = document.createElement('table');
    t.className = 'round-score-table';
    t.innerHTML = `<tr>
      <th>#</th><th>Player</th><th>This Round</th><th>Total</th>
    </tr>`;

    const localId = Network.getLocalPlayerId();
    sorted.forEach((r, i) => {
      const tr = document.createElement('tr');
      const isMe = r.playerId === localId;
      if (r.roundScore === 0) tr.classList.add('went-out');
      if (isMe) tr.classList.add('local-player');
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${escHtml(r.name)}${isMe ? ' (you)' : ''}${r.roundScore === 0 ? ' ✅' : ''}</td>
        <td class="score-delta">+${r.roundScore}</td>
        <td class="score-total">${r.totalScore}</td>`;
      t.appendChild(tr);
    });
    table.appendChild(t);

    const nextInfo = document.getElementById('round-result-next-info');
    if (isGameOver) {
      nextInfo.textContent = '';
    } else {
      nextInfo.textContent = `Next: Round ${round + 1} of 11 — Wild card: ${getWildLabel(round + 1)}`;
    }

    // Only host sees "Next Round" button
    const nextBtn = document.getElementById('btn-next-round');
    nextBtn.style.display = isHost ? 'inline-block' : 'none';
    nextBtn.textContent = isGameOver ? 'Back to Menu' : 'START NEXT ROUND →';
  }

  // ── GAME OVER SCREEN ──────────────────────────────────────

  function renderGameOver(results, winnerId, winnerName) {
    const localId = Network.getLocalPlayerId();
    const isWinner = winnerId === localId;

    document.getElementById('winner-name').textContent = isWinner ? '🏆 You Win!' : `🏆 ${winnerName} Wins!`;
    document.querySelector('.winner-sub').textContent = isWinner
      ? 'Congratulations! You had the lowest score!'
      : `${winnerName} had the lowest total score. Better luck next time!`;

    const finalTable = document.getElementById('final-scores-table');
    const sorted = [...results].sort((a, b) => a.totalScore - b.totalScore);
    const t = document.createElement('table');
    t.className = 'round-score-table';
    t.innerHTML = `<tr><th>Rank</th><th>Player</th><th>Total Score</th></tr>`;
    sorted.forEach((r, i) => {
      const tr = document.createElement('tr');
      if (r.playerId === localId) tr.classList.add('local-player');
      if (r.playerId === winnerId) tr.classList.add('went-out');
      tr.innerHTML = `<td>${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i+1}</td>
        <td>${escHtml(r.name)}</td>
        <td>${r.totalScore}</td>`;
      t.appendChild(tr);
    });
    finalTable.appendChild(t);
  }

  // ── SCOREBOARD ───────────────────────────────────────────

  function renderScoreboard(players, round) {
    const localId = Network.getLocalPlayerId();
    const content = document.getElementById('scoreboard-content');
    const sorted = [...players].sort((a, b) => a.score - b.score);

    const t = document.createElement('table');
    t.className = 'scoreboard-table';

    // Build header: Player | R1 | R2 | ... | Total
    let headerRow = '<tr><th>Player</th>';
    for (let r = 1; r <= round; r++) headerRow += `<th>R${r}</th>`;
    headerRow += '<th>Total</th></tr>';
    t.innerHTML = headerRow;

    sorted.forEach((p, i) => {
      const tr = document.createElement('tr');
      if (i === 0) tr.classList.add('leading-row');
      if (p.id === localId) tr.classList.add('local-row');
      let cells = `<td>${escHtml(p.name)}</td>`;
      for (let r = 0; r < round; r++) {
        cells += `<td>${p.roundScores[r] !== undefined ? p.roundScores[r] : '-'}</td>`;
      }
      cells += `<td><strong>${p.score}</strong></td>`;
      tr.innerHTML = cells;
      t.appendChild(tr);
    });

    content.innerHTML = '';
    content.appendChild(t);
  }

  // ── TOAST ─────────────────────────────────────────────────

  let _toastTimer = null;
  function showToast(msg, duration = 2800) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.add('hidden'), duration);
  }

  // ── UTIL ─────────────────────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return {
    renderCard, renderCardBack, renderHand, renderDiscardTop,
    renderOpponents, renderLobby, updateHeader, updateTurnIndicator,
    updateDrawPile, logAction, renderRoundResults, renderGameOver,
    renderScoreboard, showToast,
  };
})();
