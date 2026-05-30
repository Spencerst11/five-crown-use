// ============================================================
// ui.js — DOM Rendering for Five Crowns (v2)
// Changes:
//   - No wild labels/glow on cards (look like normal cards)
//   - Avatar rendered in lobby & opponent zones
//   - Gone-out player melds displayed on table for all
//   - Drag-to-reorder hand
//   - Casino deal animation
// ============================================================

const UI = (() => {

  // ── AVATAR HELPERS ───────────────────────────────────────

  const COLOR_MAP = {
    red:        '#e53e3e',
    pink:       '#d53f8c',
    periwinkle: '#7b8cde',
    sage:       '#68a57a',
    orange:     '#ed8936',
    gold:       '#d4a017',
  };

  function avatarBg(avatar) {
    return COLOR_MAP[avatar?.color] || COLOR_MAP.gold;
  }

  function avatarContent(avatar) {
    if (!avatar || avatar.animal === 'none') return null;
    return avatar.animal; // emoji
  }

  function renderAvatarEl(avatar, size = 34) {
    const el = document.createElement('div');
    el.style.cssText = `
      width:${size}px; height:${size}px; border-radius:50%;
      background:${avatarBg(avatar)};
      display:flex; align-items:center; justify-content:center;
      font-size:${Math.round(size * 0.55)}px;
      border:2px solid rgba(255,255,255,0.2);
      flex-shrink:0;
    `;
    const content = avatarContent(avatar);
    el.textContent = content || '';
    if (!content) {
      // initials fallback — caller sets text
      el.classList.add('initials-av');
    }
    return el;
  }

  // ── CARD RENDERING ───────────────────────────────────────
  // NOTE: No wild glow/label — cards look normal per request

  function renderCard(card, opts = {}) {
    const { selected = false, onClick = null } = opts;

    const el = document.createElement('div');
    el.classList.add('card');
    el.dataset.cardId = card.id;

    if (selected) el.classList.add('selected');
    if (opts.inMeld) el.classList.add('in-meld');
    if (opts.justDrawn) el.classList.add('just-drawn');

    if (card.rank === 0) {
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
    el.className = 'card-back stack-1';
    el.textContent = '👑';
    return el;
  }

  // ── PLAYER HAND (with drag-to-reorder) ──────────────────

  function renderHand(hand, round, selectedIds, onCardClick, onReorder) {
    const container = document.getElementById('player-hand');
    // Save scroll position
    const scrollLeft = container.scrollLeft;
    container.innerHTML = '';

    hand.forEach((card, idx) => {
      const el = renderCard(card, {
        selected: selectedIds.has(card.id),
        round,
        onClick: onCardClick,
      });

      // ── DRAG TO REORDER ──
      el.setAttribute('draggable', true);
      el.dataset.idx = idx;

      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', idx);
        setTimeout(() => el.classList.add('dragging'), 0);
        _dragSrcIdx = idx;
      });

      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        container.querySelectorAll('.card').forEach(c => c.classList.remove('drag-over'));
      });

      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        container.querySelectorAll('.card').forEach(c => c.classList.remove('drag-over'));
        el.classList.add('drag-over');
      });

      el.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
        const toIdx = parseInt(el.dataset.idx);
        if (fromIdx !== toIdx && onReorder) {
          onReorder(fromIdx, toIdx);
        }
      });

      // Touch drag support
      _addTouchDrag(el, idx, container, onReorder);

      container.appendChild(el);
    });

    container.scrollLeft = scrollLeft;
  }

  let _dragSrcIdx = -1;

  function _addTouchDrag(el, idx, container, onReorder) {
    let touchStartX = 0, touchStartY = 0;
    let isDragging = false;
    let ghost = null;

    el.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      isDragging = false;
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      const dx = e.touches[0].clientX - touchStartX;
      const dy = e.touches[0].clientY - touchStartY;
      if (!isDragging && Math.abs(dx) > 8) {
        isDragging = true;
        el.classList.add('dragging');
      }
      if (!isDragging) return;
      e.preventDefault();

      const x = e.touches[0].clientX;
      const cards = [...container.querySelectorAll('.card:not(.dragging)')];
      cards.forEach(c => c.classList.remove('drag-over'));
      const target = cards.find(c => {
        const r = c.getBoundingClientRect();
        return x >= r.left && x <= r.right;
      });
      if (target) target.classList.add('drag-over');
    }, { passive: false });

    el.addEventListener('touchend', (e) => {
      if (!isDragging) return;
      el.classList.remove('dragging');
      const cards = [...container.querySelectorAll('.card')];
      const overEl = container.querySelector('.card.drag-over');
      cards.forEach(c => c.classList.remove('drag-over'));
      if (overEl && onReorder) {
        const toIdx = parseInt(overEl.dataset.idx);
        if (toIdx !== idx) onReorder(idx, toIdx);
      }
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
    const el = renderCard(card, { round });
    el.style.position = 'relative';
    el.style.cursor = 'pointer';
    container.appendChild(el);
  }

  // ── GONE-OUT DISPLAY ─────────────────────────────────────
  // Shows the going-out player's melds face-up on the table for all players

  function renderGoneOutDisplay(players, localPlayerId) {
    const displayEl = document.getElementById('gone-out-display');
    const labelEl   = document.getElementById('gone-out-label');
    const meldsEl   = document.getElementById('gone-out-melds');

    // Find player who went out and has revealed melds
    const goingOutPlayer = players.find(p => p.wentOut && p.revealedMelds && p.revealedMelds.length > 0);

    if (!goingOutPlayer) {
      displayEl.style.display = 'none';
      return;
    }

    displayEl.style.display = 'block';
    const isMe = goingOutPlayer.id === localPlayerId;
    labelEl.textContent = isMe
      ? '✅ Your melds (you went out!)'
      : `✅ ${escHtml(goingOutPlayer.name)} went out — their cards:`;

    meldsEl.innerHTML = '';

    goingOutPlayer.revealedMelds.forEach((meld, i) => {
      if (i > 0) {
        const sep = document.createElement('div');
        sep.className = 'gone-out-separator';
        meldsEl.appendChild(sep);
      }
      const group = document.createElement('div');
      group.className = 'gone-out-meld-group';
      meld.forEach(card => {
        const cardEl = renderCard(card, { round: 1 }); // round arg unused since no wild labels
        group.appendChild(cardEl);
      });
      meldsEl.appendChild(group);
    });
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

      // Avatar
      const avEl = renderAvatarEl(p.avatar, 34);
      const content = avatarContent(p.avatar);
      if (!content) {
        const initials = p.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
        avEl.textContent = initials;
      }

      const cardBacks = Math.min(p.handCount, 8);
      let backsHtml = '';
      for (let i = 0; i < cardBacks; i++) backsHtml += `<div class="opp-card-mini">👑</div>`;

      const info = document.createElement('div');
      info.className = 'opp-info';
      info.innerHTML = `
        <div class="opp-name">${escHtml(p.name)}${p.id === currentTurnId ? ' 🎯' : ''}${p.wentOut ? ' ✅' : ''}</div>
        <div class="opp-cards">${p.handCount} card${p.handCount !== 1 ? 's' : ''} · ${p.score}pts</div>
        <div class="opp-card-backs">${backsHtml}</div>`;

      zone.appendChild(avEl);
      zone.appendChild(info);
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
        const isMe = p.id === localPlayerId;
        const avEl = renderAvatarEl(p.avatar, 42);
        const content = avatarContent(p.avatar);
        if (!content) {
          const initials = p.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
          avEl.textContent = initials;
        }

        const nameDiv = document.createElement('div');
        nameDiv.className = 'player-name-lobby';
        nameDiv.textContent = p.name + (isMe ? ' (you)' : '');

        const badge = document.createElement('div');
        badge.className = 'player-badge';
        badge.textContent = p.isHost ? '👑 Host' : '✓ Ready';

        row.appendChild(avEl);
        row.appendChild(nameDiv);
        row.appendChild(badge);
      } else {
        row.style.opacity = '0.3';
        row.innerHTML = `
          <div style="width:42px;height:42px;border-radius:50%;background:#2a2030;display:flex;align-items:center;justify-content:center;color:#443322">?</div>
          <div style="color:#443322;font-family:var(--font-heading)">Waiting for player ${i + 1}…</div>`;
      }
      list.appendChild(row);
    }

    const status = document.getElementById('lobby-status');
    const filled = players.length;
    status.textContent = filled < maxPlayers
      ? `${filled} / ${maxPlayers} players joined. Waiting for more…`
      : `All ${maxPlayers} players have joined! Ready to start.`;

    const startBtn = document.getElementById('start-game-btn');
    if (startBtn) {
      startBtn.disabled = filled < 2;
      startBtn.textContent = filled < 2 ? 'Need at least 2 players' : `START GAME (${filled} players)`;
    }
  }

  // ── GAME HEADER ──────────────────────────────────────────

  function updateHeader(round, phase, drawnThisTurn) {
    document.getElementById('hdr-round').textContent = `Round ${round} / 11`;
    // Wild badge removed per request — no wild labeling

    let phaseText = '';
    if (phase === 'draw') phaseText = 'Draw a card';
    else if (phase === 'discard') phaseText = 'Discard a card';
    else if (phase === 'going-out') phaseText = 'Final turns!';
    else if (phase === 'round-end') phaseText = 'Round over';
    else if (phase === 'game-over') phaseText = 'Game over!';
    document.getElementById('hdr-phase').textContent = phaseText;
  }

  // ── TURN INDICATOR ───────────────────────────────────────

  function updateTurnIndicator(isMyTurn, phase) {
    const badge = document.getElementById('turn-indicator');
    badge.classList.toggle('hidden', !isMyTurn || phase === 'round-end' || phase === 'game-over');
    const goOutBtn = document.getElementById('btn-go-out');
    goOutBtn.style.display = (isMyTurn && phase === 'discard') ? 'inline-block' : 'none';
  }

  // ── DRAW PILE ────────────────────────────────────────────

  function updateDrawPile(count, isMyTurn, phase) {
    document.getElementById('draw-count').textContent = `${count} cards`;
    const pile = document.getElementById('draw-pile');
    pile.style.opacity = (isMyTurn && phase === 'draw') ? '1' : '0.6';
    pile.style.cursor  = (isMyTurn && phase === 'draw') ? 'pointer' : 'default';
  }

  // ── ACTION LOG ───────────────────────────────────────────

  function logAction(msg) {
    document.getElementById('action-log').textContent = msg;
  }

  // ── CASINO DEAL ANIMATION ────────────────────────────────
  // Animates cards flying from draw pile to player area at round start

  function playDealAnimation(numCards, onComplete) {
    const overlay = document.getElementById('deal-overlay');
    overlay.classList.remove('hidden');
    overlay.innerHTML = '';

    const drawPileEl = document.getElementById('draw-pile');
    const playerAreaEl = document.getElementById('player-hand');
    const gameEl = document.getElementById('screen-game');

    const dpRect = drawPileEl.getBoundingClientRect();
    const paRect = playerAreaEl.getBoundingClientRect();
    const gameRect = gameEl.getBoundingClientRect();

    // Start position = center of draw pile (relative to game)
    const sx = dpRect.left + dpRect.width / 2  - gameRect.left - 28;
    const sy = dpRect.top  + dpRect.height / 2 - gameRect.top  - 39;

    // End positions spread across player hand area
    const handW = paRect.width;
    const ex_base = paRect.left - gameRect.left;
    const ey = paRect.top  - gameRect.top  + 10;

    const totalDur  = Math.min(numCards * 120, 1200); // max 1.2s
    const cardDelay = totalDur / numCards;

    for (let i = 0; i < numCards; i++) {
      const cardEl = document.createElement('div');
      cardEl.className = 'deal-card-anim';
      cardEl.textContent = '👑';

      const spread = numCards <= 1 ? 0 : (i / (numCards - 1)) * Math.min(handW - 60, numCards * 68);
      const ex = ex_base + spread;
      const rotation = (Math.random() - 0.5) * 10;

      cardEl.style.setProperty('--sx', `${sx}px`);
      cardEl.style.setProperty('--sy', `${sy}px`);
      cardEl.style.setProperty('--ex', `${ex}px`);
      cardEl.style.setProperty('--ey', `${ey}px`);
      cardEl.style.setProperty('--sr', '0deg');
      cardEl.style.setProperty('--er', `${rotation}deg`);
      cardEl.style.setProperty('--deal-dur',   `${250}ms`);
      cardEl.style.setProperty('--deal-delay', `${i * cardDelay}ms`);
      cardEl.style.left = '0';
      cardEl.style.top  = '0';

      overlay.appendChild(cardEl);
    }

    const totalTime = numCards * cardDelay + 300;
    setTimeout(() => {
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
      if (onComplete) onComplete();
    }, totalTime);
  }

  // Draw animation: flash the draw pile and new card
  function animateDraw(fromDiscard) {
    const pileEl = document.getElementById(fromDiscard ? 'discard-pile' : 'draw-pile');
    pileEl.style.transform = 'scale(1.1)';
    setTimeout(() => { pileEl.style.transform = ''; }, 200);

    // Mark last card in hand as just-drawn briefly
    setTimeout(() => {
      const handCards = document.querySelectorAll('#player-hand .card');
      if (handCards.length > 0) {
        const last = handCards[handCards.length - 1];
        last.classList.add('just-drawn');
        setTimeout(() => last.classList.remove('just-drawn'), 500);
      }
    }, 120);
  }

  // ── ROUND RESULTS ────────────────────────────────────────

  function renderRoundResults(results, round, isGameOver, isHost) {
    document.getElementById('round-result-title').textContent =
      isGameOver ? '🏆 Game Over!' : `Round ${round} Complete!`;

    const table = document.getElementById('round-scores-table');
    table.innerHTML = '';
    const sorted = [...results].sort((a, b) => a.totalScore - b.totalScore);

    const t = document.createElement('table');
    t.className = 'round-score-table';
    t.innerHTML = `<tr><th>#</th><th>Player</th><th>This Round</th><th>Total</th></tr>`;

    const localId = Network.getLocalPlayerId();
    sorted.forEach((r, i) => {
      const tr = document.createElement('tr');
      if (r.roundScore === 0) tr.classList.add('went-out');
      if (r.playerId === localId) tr.classList.add('local-player');
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${escHtml(r.name)}${r.playerId === localId ? ' (you)' : ''}${r.roundScore === 0 ? ' ✅' : ''}</td>
        <td class="score-delta">+${r.roundScore}</td>
        <td class="score-total">${r.totalScore}</td>`;
      t.appendChild(tr);
    });
    table.appendChild(t);

    const nextInfo = document.getElementById('round-result-next-info');
    nextInfo.textContent = isGameOver ? '' : `Next: Round ${round + 1} of 11`;

    const nextBtn = document.getElementById('btn-next-round');
    nextBtn.style.display = isHost ? 'inline-block' : 'none';
    nextBtn.textContent = isGameOver ? 'Back to Menu' : 'START NEXT ROUND →';
  }

  // ── GAME OVER ────────────────────────────────────────────

  function renderGameOver(results, winnerId, winnerName) {
    const localId = Network.getLocalPlayerId();
    const isWinner = winnerId === localId;

    document.getElementById('winner-name').textContent =
      isWinner ? '🏆 You Win!' : `🏆 ${winnerName} Wins!`;
    document.querySelector('.winner-sub').textContent = isWinner
      ? 'Congratulations! You had the lowest score!'
      : `${winnerName} had the lowest total score. Better luck next time!`;

    const finalTable = document.getElementById('final-scores-table');
    finalTable.innerHTML = '';
    const sorted = [...results].sort((a, b) => a.totalScore - b.totalScore);
    const t = document.createElement('table');
    t.className = 'round-score-table';
    t.innerHTML = `<tr><th>Rank</th><th>Player</th><th>Total Score</th></tr>`;
    sorted.forEach((r, i) => {
      const tr = document.createElement('tr');
      if (r.playerId === localId) tr.classList.add('local-player');
      if (r.playerId === winnerId) tr.classList.add('went-out');
      tr.innerHTML = `<td>${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}</td>
        <td>${escHtml(r.name)}</td><td>${r.totalScore}</td>`;
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
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return {
    renderCard, renderCardBack, renderHand, renderDiscardTop,
    renderOpponents, renderGoneOutDisplay, renderLobby,
    updateHeader, updateTurnIndicator, updateDrawPile, logAction,
    renderRoundResults, renderGameOver, renderScoreboard,
    showToast, playDealAnimation, animateDraw,
  };
})();
