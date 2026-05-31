// ============================================================
// ui.js — Five Crowns UI (v8)
// Major changes:
//   - Scoreboard: left side-panel tab, totals only
//   - Final cards panel: right side-panel tab, shows melds + leftovers
//   - Circular opponents around table-area
//   - No gone-out display on table (moved to right panel)
//   - Game over: ranked rows with avatars
// ============================================================

const UI = (() => {

  // ── AVATAR HELPERS ───────────────────────────────────────
  const COLOR_MAP = { red:'#e53e3e',pink:'#d53f8c',periwinkle:'#7b8cde',sage:'#68a57a',orange:'#ed8936',gold:'#d4a017' };
  function avatarBg(av)      { return COLOR_MAP[av?.color] || COLOR_MAP.gold; }
  function avatarEmoji(av)   { return (!av || av.animal === 'none') ? null : av.animal; }

  function renderAvatarEl(avatar, size = 34) {
    const el = document.createElement('div');
    el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${avatarBg(avatar)};display:flex;align-items:center;justify-content:center;font-size:${Math.round(size*.55)}px;border:2px solid rgba(255,255,255,.2);flex-shrink:0;`;
    const em = avatarEmoji(avatar);
    if (em) { el.textContent = em; } else { el.classList.add('initials-av'); }
    return el;
  }

  // ── CARD RENDERING ───────────────────────────────────────
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
      el.innerHTML = `<div class="card-corner"><span class="card-value" style="color:#7b2d8b">J</span><span class="card-suit-sm" style="color:#7b2d8b">K</span></div><div class="card-center"><div><div class="card-joker-center">🃏</div><div class="card-joker-label">JOKER</div></div></div><div class="card-corner bottom"><span class="card-value" style="color:#7b2d8b">J</span><span class="card-suit-sm" style="color:#7b2d8b">K</span></div>`;
    } else {
      const ri = RANK_INFO[card.rank];
      const si = getSuitInfo(card.suit);
      el.innerHTML = `<div class="card-corner"><span class="card-value ${si.cls}">${ri.label}</span><span class="card-suit-sm ${si.cls}">${si.symbol}</span></div><div class="card-center ${si.cls}" style="font-size:${ri.label==='10'?'1.1rem':'1.4rem'}">${si.symbol}</div><div class="card-corner bottom"><span class="card-value ${si.cls}">${ri.label}</span><span class="card-suit-sm ${si.cls}">${si.symbol}</span></div>`;
    }
    if (onClick) el.addEventListener('click', e => { e.stopPropagation(); onClick(card, el); });
    return el;
  }

  // Mini card for panel display
  function renderCardMini(card, leftover = false) {
    const el = document.createElement('div');
    el.className = 'card-mini' + (card.rank === 0 ? ' joker-mini' : '') + (leftover ? ' leftover' : '');
    if (card.rank === 0) {
      el.innerHTML = `<div style="font-size:.9rem">🃏</div>`;
    } else {
      const ri = RANK_INFO[card.rank];
      const si = getSuitInfo(card.suit);
      el.innerHTML = `<div class="cm-val ${si.cls}">${ri.label}</div><div class="cm-suit ${si.cls}">${si.symbol}</div>`;
    }
    return el;
  }

  // ── HAND ─────────────────────────────────────────────────
  function renderHand(hand, round, selectedIds, onCardClick, onReorder) {
    const container = document.getElementById('player-hand');
    container.innerHTML = '';
    container.className = 'hand-container';
    hand.forEach((card, idx) => {
      const el = renderCard(card, { selected: selectedIds.has(card.id), onClick: onCardClick });
      el.setAttribute('draggable', true);
      el.dataset.idx = idx;
      _attachDrag(el, idx, container, onReorder);
      _attachTouchDrag(el, idx, container, onReorder);
      container.appendChild(el);
    });
  }

  // ── GO-OUT BUILDER ────────────────────────────────────────
  function renderGoOutBuilder(hand, round, meldGroups, discardId, onCardAction, onReorder) {
    const container = document.getElementById('player-hand');
    container.innerHTML = '';
    container.className = 'hand-container goout-builder';

    const assigned = {};
    meldGroups.forEach((g, gi) => g.forEach(id => { assigned[id] = { type:'group', groupIdx:gi }; }));
    if (discardId) assigned[discardId] = { type:'discard' };

    hand.forEach((card, idx) => {
      const assign = assigned[card.id];
      const wrapper = document.createElement('div');
      wrapper.className = 'goout-card-wrapper';

      const badge = document.createElement('div');
      badge.className = 'goout-badge';
      if (assign?.type === 'group') {
        badge.textContent = `G${assign.groupIdx + 1}`;
        badge.classList.add('badge-group');
        badge.style.background = _groupColor(assign.groupIdx);
      } else if (assign?.type === 'discard') {
        badge.textContent = 'DISC';
        badge.classList.add('badge-discard');
      } else {
        badge.textContent = '?';
        badge.classList.add('badge-unset');
      }
      wrapper.appendChild(badge);

      const cardEl = renderCard(card);
      if (assign?.type === 'group') {
        cardEl.classList.add('goout-in-group');
        cardEl.style.borderColor = _groupColor(assign.groupIdx);
        cardEl.style.boxShadow = `0 0 0 2px ${_groupColor(assign.groupIdx)}55`;
      }
      if (assign?.type === 'discard') cardEl.classList.add('goout-is-discard');
      if (!assign) cardEl.classList.add('goout-unset');

      cardEl.addEventListener('click', e => { e.stopPropagation(); _showCardActionPicker(card, meldGroups.length, assign, onCardAction); });
      cardEl.setAttribute('draggable', true);
      cardEl.dataset.idx = idx;
      _attachDrag(cardEl, idx, container, onReorder);
      _attachTouchDrag(cardEl, idx, container, onReorder);
      wrapper.appendChild(cardEl);
      container.appendChild(wrapper);
    });

    updateGoOutStatus(hand, round, meldGroups, discardId);
  }

  function _groupColor(idx) {
    return ['#2563eb','#16a34a','#9333ea','#ea580c','#0891b2','#be185d'][idx % 6];
  }

  let _pickerEl = null;
  function _showCardActionPicker(card, numGroups, currentAssign, onCardAction) {
    if (_pickerEl) { _pickerEl.remove(); _pickerEl = null; }
    const picker = document.createElement('div');
    picker.className = 'card-action-picker';
    _pickerEl = picker;

    const label = document.createElement('div');
    label.className = 'picker-label';
    label.textContent = `Assign: ${getCardLabel(card)}`;
    picker.appendChild(label);

    const discBtn = document.createElement('button');
    discBtn.className = 'picker-btn picker-discard' + (currentAssign?.type==='discard'?' active':'');
    discBtn.textContent = '🗑️  Discard';
    discBtn.onclick = () => { onCardAction(card,'discard'); picker.remove(); _pickerEl=null; };
    picker.appendChild(discBtn);

    const sep = document.createElement('div');
    sep.style.cssText = 'font-size:.65rem;color:#6a8a6a;padding:.15rem 0;text-align:center;';
    sep.textContent = '— meld group —';
    picker.appendChild(sep);

    for (let g = 0; g < numGroups; g++) {
      const isActive = currentAssign?.type==='group' && currentAssign.groupIdx===g;
      const gBtn = document.createElement('button');
      gBtn.className = 'picker-btn picker-group' + (isActive?' active':'');
      gBtn.style.borderColor = _groupColor(g);
      gBtn.style.color = isActive ? 'white' : _groupColor(g);
      if (isActive) gBtn.style.background = _groupColor(g);
      gBtn.textContent = `Group ${g+1}`;
      const gi = g;
      gBtn.onclick = () => { onCardAction(card,`group-${gi}`); picker.remove(); _pickerEl=null; };
      picker.appendChild(gBtn);
    }
    if (currentAssign) {
      const unBtn = document.createElement('button');
      unBtn.className = 'picker-btn picker-unassign';
      unBtn.textContent = '✕  Remove';
      unBtn.onclick = () => { onCardAction(card,'unassign'); picker.remove(); _pickerEl=null; };
      picker.appendChild(unBtn);
    }
    const closeBtn = document.createElement('button');
    closeBtn.className = 'picker-btn picker-close';
    closeBtn.textContent = 'Cancel';
    closeBtn.onclick = () => { picker.remove(); _pickerEl=null; };
    picker.appendChild(closeBtn);

    document.getElementById('player-area').appendChild(picker);
    setTimeout(() => {
      document.addEventListener('click', function outsideClick(e) {
        if (!picker.contains(e.target)) { picker.remove(); _pickerEl=null; document.removeEventListener('click',outsideClick); }
      });
    }, 80);
  }

  function updateGoOutStatus(hand, round, meldGroups, discardId) {
    const statusEl = document.getElementById('goout-status-bar');
    if (!statusEl) return;
    const assigned = new Set();
    meldGroups.forEach(g => g.forEach(id => assigned.add(id)));
    if (discardId) assigned.add(discardId);
    const unassigned = hand.filter(c => !assigned.has(c.id)).length;
    if (unassigned > 0) {
      statusEl.textContent = `⚠️ ${unassigned} card${unassigned>1?'s':''} unassigned`;
      statusEl.className = 'goout-status-bar status-warn';
    } else if (!discardId) {
      statusEl.textContent = '⚠️ Mark one card as Discard';
      statusEl.className = 'goout-status-bar status-warn';
    } else {
      statusEl.textContent = '✅ All assigned — tap SUBMIT to go out';
      statusEl.className = 'goout-status-bar status-ok';
    }
  }

  // ── DRAG HELPERS ─────────────────────────────────────────
  function _attachDrag(el, idx, container, onReorder) {
    el.addEventListener('dragstart', e => { e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain',String(idx)); setTimeout(()=>el.classList.add('dragging'),0); });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); container.querySelectorAll('.card').forEach(c=>c.classList.remove('drag-over')); });
    el.addEventListener('dragover', e => { e.preventDefault(); container.querySelectorAll('.card').forEach(c=>c.classList.remove('drag-over')); el.classList.add('drag-over'); });
    el.addEventListener('drop', e => { e.preventDefault(); const from=parseInt(e.dataTransfer.getData('text/plain')); const to=parseInt(el.dataset.idx); if(from!==to&&onReorder) onReorder(from,to); });
  }
  function _attachTouchDrag(el, idx, container, onReorder) {
    let startX=0, isDragging=false;
    el.addEventListener('touchstart', e => { startX=e.touches[0].clientX; isDragging=false; }, {passive:true});
    el.addEventListener('touchmove', e => {
      const dx=e.touches[0].clientX-startX;
      if(!isDragging&&Math.abs(dx)>10){isDragging=true;el.classList.add('dragging');}
      if(!isDragging)return;
      e.preventDefault();
      const x=e.touches[0].clientX;
      const cards=[...container.querySelectorAll('.card:not(.dragging)')];
      cards.forEach(c=>c.classList.remove('drag-over'));
      const target=cards.find(c=>{const r=c.getBoundingClientRect();return x>=r.left&&x<=r.right;});
      if(target)target.classList.add('drag-over');
    }, {passive:false});
    el.addEventListener('touchend', () => {
      if(!isDragging)return;
      el.classList.remove('dragging');
      const overEl=container.querySelector('.card.drag-over');
      container.querySelectorAll('.card').forEach(c=>c.classList.remove('drag-over'));
      if(overEl&&onReorder){const toIdx=parseInt(overEl.dataset.idx);if(toIdx!==idx)onReorder(idx,toIdx);}
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
    const el = renderCard(card, {});
    el.style.position = 'relative';
    el.style.cursor = 'pointer';
    container.appendChild(el);
  }

  // ── CIRCULAR OPPONENTS ────────────────────────────────────
  function renderOpponents(players, localPlayerId, currentTurnId) {
    const area = document.getElementById('opponents-area');
    area.innerHTML = '';

    const opponents = players.filter(p => p.id !== localPlayerId);
    const count = opponents.length;
    if (count === 0) return;

    const areaW = area.offsetWidth || window.innerWidth;
    const areaH = area.offsetHeight || 260;

    // Oval parameters — opponents arc across the top
    const rx = Math.min(areaW * 0.42, 290);
    const ry = Math.min(areaH * 0.44, 115);
    const cx = areaW / 2;
    const cy = areaH * 0.52;

    opponents.forEach((p, i) => {
      // Spread from ~210° to ~330° (top arc, left→right)
      const angle = count === 1 ? 270 : 210 + (i / (count - 1)) * 120;
      const rad = angle * Math.PI / 180;
      const x = cx + rx * Math.cos(rad);
      const y = cy + ry * Math.sin(rad);

      const zone = document.createElement('div');
      zone.className = 'opponent-zone';
      if (p.id === currentTurnId) zone.classList.add('active-turn');
      if (p.wentOut)              zone.classList.add('going-out');
      if (p.disconnected)         zone.classList.add('disconnected');
      zone.style.left = `${x}px`;
      zone.style.top  = `${y}px`;

      const avEl = renderAvatarEl(p.avatar, 34);
      if (!avatarEmoji(p.avatar))
        avEl.textContent = p.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);

      const cardBacks = Math.min(p.handCount, 8);
      let backsHtml = '';
      for (let b = 0; b < cardBacks; b++) backsHtml += `<div class="opp-card-mini"></div>`;

      const info = document.createElement('div');
      info.className = 'opp-info';
      info.innerHTML =
        `<div class="opp-name">${escHtml(p.name)}${p.id===currentTurnId?' 🎯':''}${p.wentOut?' ✅':''}</div>` +
        `<div class="opp-cards">${p.handCount} card${p.handCount!==1?'s':''} · ${p.score}pts</div>` +
        `<div class="opp-card-backs">${backsHtml}</div>`;

      zone.appendChild(avEl);
      zone.appendChild(info);
      area.appendChild(zone);
    });
  }

  // ── YOU-ZONE GLOW ─────────────────────────────────────────
  function updateYouZoneGlow(isMyTurn, phase) {
    const youZone = document.getElementById('you-zone');
    if (!youZone) return;
    const active = isMyTurn && phase !== 'round-end' && phase !== 'game-over';
    if (active) {
      youZone.style.boxShadow = '0 0 0 3px rgba(240,192,64,.45), 0 0 18px rgba(240,192,64,.3)';
      youZone.style.borderColor = 'var(--gold)';
    } else {
      youZone.style.boxShadow = '';
      youZone.style.borderColor = '';
    }
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
        const avEl = renderAvatarEl(p.avatar, 38);
        if (!avatarEmoji(p.avatar)) avEl.textContent = p.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
        const nameDiv = document.createElement('div');
        nameDiv.className = 'player-name-lobby';
        nameDiv.textContent = p.name + (isMe ? ' (you)' : '');
        const badge = document.createElement('div');
        badge.className = 'player-badge';
        badge.textContent = p.isHost ? '👑 Host' : '✓ Ready';
        row.appendChild(avEl); row.appendChild(nameDiv); row.appendChild(badge);
      } else {
        row.style.opacity = '0.3';
        row.innerHTML = `<div style="width:38px;height:38px;border-radius:50%;background:#2a2030;display:flex;align-items:center;justify-content:center;color:#443322">?</div><div style="color:#443322;font-family:var(--font-heading)">Waiting for player ${i+1}…</div>`;
      }
      list.appendChild(row);
    }
    const status = document.getElementById('lobby-status');
    const filled = players.length;
    status.textContent = filled < maxPlayers
      ? `${filled} / ${maxPlayers} players joined. Waiting…`
      : `All ${maxPlayers} players joined! Ready to start.`;
    const startBtn = document.getElementById('start-game-btn');
    if (startBtn) {
      startBtn.disabled = filled < 2;
      startBtn.textContent = filled < 2 ? 'Need at least 2 players' : `START GAME (${filled} players)`;
    }
  }

  // ── HEADER ───────────────────────────────────────────────
  function updateHeader(round, phase, drawnThisTurn) {
    document.getElementById('hdr-round').textContent = `Round ${round} / 11`;
    let phaseText = '';
    if (phase === 'draw')       phaseText = 'Draw a card';
    else if (phase === 'discard')    phaseText = 'Discard a card';
    else if (phase === 'going-out')  phaseText = drawnThisTurn ? '⚡ Final discard' : '⚡ Final draw';
    else if (phase === 'round-end')  phaseText = 'Round over';
    else if (phase === 'game-over')  phaseText = 'Game over!';
    document.getElementById('hdr-phase').textContent = phaseText;
  }

  // ── TURN CONTROLS ────────────────────────────────────────
  function updateTurnIndicator(isMyTurn, phase, drawnThisTurn) {
    const badge = document.getElementById('turn-indicator');
    if (badge) badge.classList.toggle('hidden', !isMyTurn || phase === 'round-end' || phase === 'game-over');
    const goOutBtn = document.getElementById('btn-go-out');
    if (goOutBtn) goOutBtn.style.display = (isMyTurn && phase === 'discard') ? 'inline-block' : 'none';
  }

  // ── DRAW PILE ────────────────────────────────────────────
  function updateDrawPile(count, isMyTurn, phase, drawnThisTurn) {
    document.getElementById('draw-count').textContent = `${count} cards`;
    const pile = document.getElementById('draw-pile');
    const canDraw = isMyTurn && (phase === 'draw' || (phase === 'going-out' && !drawnThisTurn));
    pile.style.opacity = canDraw ? '1' : '0.55';
    pile.style.cursor  = canDraw ? 'pointer' : 'default';
  }

  // ── ACTION LOG ───────────────────────────────────────────
  function logAction(msg) {
    const el = document.getElementById('action-log');
    if (el) el.textContent = msg;
  }

  // ── SCOREBOARD (left panel) ───────────────────────────────
  function renderScoreboard(players, round) {
    const localId = Network.getLocalPlayerId();
    const content  = document.getElementById('scoreboard-content');
    if (!content) return;
    const sorted = [...players].sort((a,b) => a.score - b.score);

    const caption = document.createElement('div');
    caption.className = 'score-caption';
    const done = round - 1;
    caption.textContent = done === 0 ? 'No rounds completed yet' : `After ${done} of 11 rounds · lowest wins`;

    const t = document.createElement('table');
    t.className = 'scoreboard-table';
    t.innerHTML = '<tr><th>#</th><th>Player</th><th>Total</th></tr>';
    sorted.forEach((p, i) => {
      const tr = document.createElement('tr');
      if (i === 0) tr.classList.add('leading-row');
      if (p.id === localId) tr.classList.add('local-row');
      const rank = i===0?'🥇':i===1?'🥈':i===2?'🥉':(i+1);
      tr.innerHTML = `<td>${rank}</td><td>${escHtml(p.name)}${p.id===localId?' <em style="opacity:.6;font-size:.75em">(you)</em>':''}</td><td><strong>${p.score}</strong></td>`;
      t.appendChild(tr);
    });

    content.innerHTML = '';
    content.appendChild(caption);
    content.appendChild(t);
  }

  // ── FINAL CARDS PANEL (right panel) ──────────────────────
  // Shows each player's laid-down melds + leftover (point) cards.
  function renderFinalCardsPanel(players, localPlayerId) {
    const content = document.getElementById('final-cards-content');
    if (!content) return;
    content.innerHTML = '';

    // Players who have submitted their final cards (wentOut OR have revealedMelds)
    const submitted = players.filter(p => p.wentOut || (p.revealedMelds && p.revealedMelds.length > 0));
    if (submitted.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'panel-empty-msg';
      empty.textContent = 'Cards will appear here when players go out or end their final turn.';
      content.appendChild(empty);
      return;
    }

    submitted.forEach(p => {
      const block = document.createElement('div');
      block.className = 'final-player-block';

      // Header row: avatar + name + score
      const header = document.createElement('div');
      header.className = 'final-player-header';
      const avEl = document.createElement('div');
      avEl.className = 'final-player-avatar';
      avEl.style.background = (COLOR_MAP[p.avatar?.color] || COLOR_MAP.gold);
      const em = avatarEmoji(p.avatar);
      if (em) {
        avEl.textContent = em;
      } else {
        avEl.style.fontSize = '.65rem';
        avEl.style.fontFamily = 'var(--font-heading)';
        avEl.textContent = p.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
      }
      header.appendChild(avEl);

      const nameEl = document.createElement('div');
      nameEl.className = 'final-player-name';
      nameEl.textContent = p.name + (p.id === localPlayerId ? ' (you)' : '');
      header.appendChild(nameEl);

      const scoreEl = document.createElement('div');
      scoreEl.className = 'final-player-score' + (p.wentOut ? ' went-out' : ' scoring');
      scoreEl.textContent = p.wentOut ? '0 pts ✅' : (p.roundScore !== undefined ? `+${p.roundScore} pts` : '');
      header.appendChild(scoreEl);
      block.appendChild(header);

      // Melds
      if (p.revealedMelds && p.revealedMelds.length > 0) {
        p.revealedMelds.forEach((meld, mi) => {
          const row = document.createElement('div');
          row.className = 'final-meld-row';
          const lbl = document.createElement('div');
          lbl.className = 'final-meld-label';
          lbl.textContent = `Meld ${mi + 1}`;
          row.appendChild(lbl);
          meld.forEach(card => row.appendChild(renderCardMini(card, false)));
          block.appendChild(row);
        });
      }

      // Leftover unmelded cards
      if (p.revealedLeftover && p.revealedLeftover.length > 0) {
        const row = document.createElement('div');
        row.className = 'final-meld-row';
        const lbl = document.createElement('div');
        lbl.className = 'final-leftover-label';
        lbl.textContent = `Points (${p.revealedLeftover.reduce((s,c) => s + cardScore(c, p.roundForScore || 1), 0)} pts)`;
        row.appendChild(lbl);
        p.revealedLeftover.forEach(card => row.appendChild(renderCardMini(card, true)));
        block.appendChild(row);
      }

      content.appendChild(block);
    });
  }

  // ── ROUND RESULTS ────────────────────────────────────────
  function renderRoundResults(results, round, isGameOver, isHost, autoAdvanceSecs) {
    document.getElementById('round-result-title').textContent =
      isGameOver ? '🏆 Game Over!' : `Round ${round} Complete!`;

    const table = document.getElementById('round-scores-table');
    table.innerHTML = '';
    const sorted = [...results].sort((a, b) => a.totalScore - b.totalScore);

    const t = document.createElement('table');
    t.className = 'round-score-table';
    t.innerHTML = `<tr><th>#</th><th>Player</th><th>Round</th><th>Total</th></tr>`;
    const localId = Network.getLocalPlayerId();
    sorted.forEach((r, i) => {
      const tr = document.createElement('tr');
      if (r.roundScore === 0) tr.classList.add('went-out');
      if (r.playerId === localId) tr.classList.add('local-player');
      tr.innerHTML = `<td>${i+1}</td><td>${escHtml(r.name)}${r.playerId===localId?' (you)':''}${r.roundScore===0?' ✅':''}</td><td class="score-delta">+${r.roundScore}</td><td class="score-total">${r.totalScore}</td>`;
      t.appendChild(tr);
    });
    table.appendChild(t);

    document.getElementById('round-result-next-info').textContent =
      isGameOver ? '' : `Next: Round ${round + 1} of 11`;

    const nextBtn = document.getElementById('btn-next-round');
    const waitArea = document.getElementById('waiting-host-area');

    if (isGameOver) {
      nextBtn.style.display = 'none';
      if (waitArea) waitArea.style.display = 'none';
    } else if (isHost) {
      nextBtn.style.display = 'inline-block';
      nextBtn.textContent = 'START NEXT ROUND →';
      if (waitArea) waitArea.style.display = 'none';

      // Auto-advance countdown if provided
      if (autoAdvanceSecs > 0) {
        const bar = document.getElementById('round-countdown-bar');
        const fill = document.getElementById('round-countdown-fill');
        if (bar && fill) {
          bar.style.display = 'block';
          fill.style.transition = 'none';
          fill.style.width = '100%';
          setTimeout(() => {
            fill.style.transition = `width ${autoAdvanceSecs}s linear`;
            fill.style.width = '0%';
          }, 50);
        }
      }
    } else {
      nextBtn.style.display = 'none';
      if (waitArea) waitArea.style.display = 'block';
    }
  }

  // ── GAME OVER — ranked with avatars ──────────────────────
  function renderGameOver(results, winnerId, winnerName, players) {
    const localId = Network.getLocalPlayerId();
    const isWinner = winnerId === localId;

    document.getElementById('winner-name').textContent =
      isWinner ? '🏆 You Win!' : `🏆 ${winnerName} Wins!`;
    document.querySelector('.winner-sub').textContent = 'Final Standings';

    const finalTable = document.getElementById('final-scores-table');
    finalTable.innerHTML = '';

    const sorted = [...results].sort((a, b) => a.totalScore - b.totalScore);
    sorted.forEach((r, i) => {
      const rankClass = ['rank-1','rank-2','rank-3'][i] || '';
      const row = document.createElement('div');
      row.className = `final-rank-row ${rankClass}` + (r.playerId === localId ? ' local-player' : '');

      const rankEl = document.createElement('div');
      rankEl.className = 'fr-rank';
      rankEl.textContent = i===0?'🥇':i===1?'🥈':i===2?'🥉':(i+1)+'.';
      row.appendChild(rankEl);

      // Avatar from players array
      const pInfo = players ? players.find(p => p.id === r.playerId) : null;
      const avEl = document.createElement('div');
      avEl.className = 'fr-avatar';
      avEl.style.background = COLOR_MAP[pInfo?.avatar?.color] || COLOR_MAP.gold;
      const em = pInfo ? avatarEmoji(pInfo.avatar) : null;
      if (em) {
        avEl.textContent = em;
      } else {
        avEl.style.fontSize = '.7rem';
        avEl.style.fontFamily = 'var(--font-heading)';
        avEl.textContent = r.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
      }
      row.appendChild(avEl);

      const nameEl = document.createElement('div');
      nameEl.className = 'fr-name';
      nameEl.textContent = r.name + (r.playerId === localId ? ' (you)' : '');
      row.appendChild(nameEl);

      const scoreEl = document.createElement('div');
      scoreEl.className = 'fr-score';
      scoreEl.textContent = r.totalScore;
      row.appendChild(scoreEl);

      finalTable.appendChild(row);
    });
  }

  // ── DEAL ANIMATION ───────────────────────────────────────
  function playDealAnimation(numCards, onComplete) {
    const overlay = document.getElementById('deal-overlay');
    overlay.classList.remove('hidden');
    overlay.innerHTML = '';

    const drawPileEl   = document.getElementById('draw-pile');
    const playerAreaEl = document.getElementById('player-hand');
    const tableAreaEl  = document.getElementById('table-area');

    if (!drawPileEl || !playerAreaEl || !tableAreaEl) {
      if (onComplete) onComplete();
      return;
    }

    const dpRect  = drawPileEl.getBoundingClientRect();
    const paRect  = playerAreaEl.getBoundingClientRect();
    const taRect  = tableAreaEl.getBoundingClientRect();

    const sx = dpRect.left + dpRect.width/2  - taRect.left - 24;
    const sy = dpRect.top  + dpRect.height/2 - taRect.top  - 32;
    const handW   = paRect.width;
    const ex_base = paRect.left - taRect.left;
    const ey      = paRect.top  - taRect.top + 8;

    const cardDelay = Math.min(110, 700 / numCards);
    for (let i = 0; i < numCards; i++) {
      const cardEl = document.createElement('div');
      cardEl.className = 'deal-card-anim';
      cardEl.textContent = '👑';
      const spread = numCards <= 1 ? 0 : (i/(numCards-1)) * Math.min(handW-56, numCards*58);
      cardEl.style.setProperty('--sx', `${sx}px`);
      cardEl.style.setProperty('--sy', `${sy}px`);
      cardEl.style.setProperty('--ex', `${ex_base + spread}px`);
      cardEl.style.setProperty('--ey', `${ey}px`);
      cardEl.style.setProperty('--sr', '0deg');
      cardEl.style.setProperty('--er', `${(Math.random()-.5)*12}deg`);
      cardEl.style.setProperty('--deal-dur', '430ms');
      cardEl.style.setProperty('--deal-delay', `${i * cardDelay}ms`);
      overlay.appendChild(cardEl);
    }
    setTimeout(() => { overlay.classList.add('hidden'); overlay.innerHTML = ''; if (onComplete) onComplete(); }, numCards * cardDelay + 380);
  }

  function animateDraw(fromDiscard) {
    const pileEl = document.getElementById(fromDiscard ? 'discard-pile' : 'draw-pile');
    if (!pileEl) return;
    pileEl.style.transform = 'scale(1.08)';
    setTimeout(() => { pileEl.style.transform = ''; }, 180);
    setTimeout(() => {
      const handCards = document.querySelectorAll('#player-hand .card');
      if (handCards.length > 0) {
        const last = handCards[handCards.length - 1];
        last.classList.add('just-drawn');
        setTimeout(() => last.classList.remove('just-drawn'), 500);
      }
    }, 100);
  }

  // ── GO-OUT ERROR ─────────────────────────────────────────
  function showGoOutError(message) {
    const existing = document.getElementById('goout-error-modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'goout-error-modal';
    modal.className = 'goout-error-overlay';
    modal.innerHTML = `<div class="goout-error-box"><div class="goout-error-icon">⚠️</div><div class="goout-error-title">Invalid Go-Out</div><div class="goout-error-msg">${escHtml(message)}</div><div class="goout-error-hint">Fix your groups and try again.</div><button class="btn btn-primary goout-error-btn" onclick="document.getElementById('goout-error-modal').remove()">OK, Fix It</button></div>`;
    document.body.appendChild(modal);
    setTimeout(() => { if (document.getElementById('goout-error-modal')) modal.remove(); }, 6000);
  }

  // ── TOAST ─────────────────────────────────────────────────
  let _toastTimer = null;
  function showToast(msg, duration = 2800) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.add('hidden'), duration);
  }

  function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return {
    renderCard, renderCardMini, renderHand, renderGoOutBuilder,
    renderDiscardTop, renderOpponents, renderLobby,
    updateHeader, updateTurnIndicator, updateDrawPile, updateYouZoneGlow, logAction,
    renderScoreboard, renderFinalCardsPanel,
    renderRoundResults, renderGameOver,
    showToast, showGoOutError, updateGoOutStatus,
    playDealAnimation, animateDraw,
  };
})();
    if (card.rank === 0) {
      el.classList.add('joker');
      el.innerHTML = `
        <div class="card-corner"><span class="card-value" style="color:#7b2d8b">J</span><span class="card-suit-sm" style="color:#7b2d8b">K</span></div>
        <div class="card-center"><div><div class="card-joker-center">🃏</div><div class="card-joker-label">JOKER</div></div></div>
        <div class="card-corner bottom"><span class="card-value" style="color:#7b2d8b">J</span><span class="card-suit-sm" style="color:#7b2d8b">K</span></div>`;
    } else {
      const ri = RANK_INFO[card.rank];
      const si = getSuitInfo(card.suit);
      el.innerHTML = `
        <div class="card-corner"><span class="card-value ${si.cls}">${ri.label}</span><span class="card-suit-sm ${si.cls}">${si.symbol}</span></div>
        <div class="card-center ${si.cls}" style="font-size:${ri.label==='10'?'1.2rem':'1.5rem'}">${si.symbol}</div>
        <div class="card-corner bottom"><span class="card-value ${si.cls}">${ri.label}</span><span class="card-suit-sm ${si.cls}">${si.symbol}</span></div>`;
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

  // ── PLAYER HAND (normal mode) ────────────────────────────
  function renderHand(hand, round, selectedIds, onCardClick, onReorder) {
    const container = document.getElementById('player-hand');
    container.innerHTML = '';
    container.className = 'hand-container';
    hand.forEach((card, idx) => {
      const el = renderCard(card, { selected: selectedIds.has(card.id), round, onClick: onCardClick });
      el.setAttribute('draggable', true);
      el.dataset.idx = idx;
      _attachDrag(el, idx, container, onReorder);
      _attachTouchDrag(el, idx, container, onReorder);
      container.appendChild(el);
    });
  }

  // ── GO-OUT BUILDER ────────────────────────────────────────
  // Each card gets a badge showing its assignment, and a tap opens a picker
  function renderGoOutBuilder(hand, round, meldGroups, discardId, onCardAction, onReorder) {
    const container = document.getElementById('player-hand');
    container.innerHTML = '';
    container.className = 'hand-container goout-builder';

    // Build assignment map
    const assigned = {};
    meldGroups.forEach((group, gi) => { group.forEach(id => { assigned[id] = { type: 'group', groupIdx: gi }; }); });
    if (discardId) assigned[discardId] = { type: 'discard' };

    hand.forEach((card, idx) => {
      const assign = assigned[card.id];
      const wrapper = document.createElement('div');
      wrapper.className = 'goout-card-wrapper';

      // Badge above card showing assignment
      const badge = document.createElement('div');
      badge.className = 'goout-badge';
      if (assign?.type === 'group') {
        badge.textContent = `G${assign.groupIdx + 1}`;
        badge.classList.add('badge-group');
        badge.style.background = _groupColor(assign.groupIdx);
      } else if (assign?.type === 'discard') {
        badge.textContent = 'DISCARD';
        badge.classList.add('badge-discard');
      } else {
        badge.textContent = '?';
        badge.classList.add('badge-unset');
      }
      wrapper.appendChild(badge);

      const cardEl = renderCard(card, { round });
      if (assign?.type === 'group') {
        cardEl.classList.add('goout-in-group');
        cardEl.style.borderColor = _groupColor(assign.groupIdx);
        cardEl.style.boxShadow = `0 0 0 2px ${_groupColor(assign.groupIdx)}55`;
      }
      if (assign?.type === 'discard') cardEl.classList.add('goout-is-discard');
      if (!assign) cardEl.classList.add('goout-unset');

      // Tap opens the action picker
      cardEl.addEventListener('click', (e) => {
        e.stopPropagation();
        _showCardActionPicker(card, meldGroups.length, assign, onCardAction);
      });

      // Drag reorder still works
      cardEl.setAttribute('draggable', true);
      cardEl.dataset.idx = idx;
      _attachDrag(cardEl, idx, container, onReorder);
      _attachTouchDrag(cardEl, idx, container, onReorder);

      wrapper.appendChild(cardEl);
      container.appendChild(wrapper);
    });
  }

  function _groupColor(idx) {
    const colors = ['#2563eb','#16a34a','#9333ea','#ea580c','#0891b2','#be185d'];
    return colors[idx % colors.length];
  }

  // Popup picker when a card is tapped in go-out builder mode
  let _pickerEl = null;
  function _showCardActionPicker(card, numGroups, currentAssign, onCardAction) {
    if (_pickerEl) { _pickerEl.remove(); _pickerEl = null; }

    const picker = document.createElement('div');
    picker.className = 'card-action-picker';
    _pickerEl = picker;

    // Card label at top
    const label = document.createElement('div');
    label.className = 'picker-label';
    label.textContent = `Assign: ${getCardLabel(card)}`;
    picker.appendChild(label);

    // Discard button
    const discBtn = document.createElement('button');
    discBtn.className = 'picker-btn picker-discard' + (currentAssign?.type === 'discard' ? ' active' : '');
    discBtn.textContent = '🗑️  Mark as Discard';
    discBtn.onclick = () => { onCardAction(card, 'discard'); picker.remove(); _pickerEl = null; };
    picker.appendChild(discBtn);

    // Separator
    const sep = document.createElement('div');
    sep.style.cssText = 'font-size:.7rem;color:#6a8a6a;padding:.2rem 0;text-align:center;letter-spacing:.1em;text-transform:uppercase;';
    sep.textContent = '— or add to meld group —';
    picker.appendChild(sep);

    // Group buttons (one per existing group)
    for (let g = 0; g < numGroups; g++) {
      const isActive = currentAssign?.type === 'group' && currentAssign.groupIdx === g;
      const gBtn = document.createElement('button');
      gBtn.className = 'picker-btn picker-group' + (isActive ? ' active' : '');
      gBtn.style.borderColor = _groupColor(g);
      gBtn.style.color = isActive ? 'white' : _groupColor(g);
      if (isActive) gBtn.style.background = _groupColor(g);
      gBtn.textContent = `Group ${g + 1}`;
      const gi = g;
      gBtn.onclick = () => { onCardAction(card, `group-${gi}`); picker.remove(); _pickerEl = null; };
      picker.appendChild(gBtn);
    }

    // Unassign button (only if currently assigned)
    if (currentAssign) {
      const unBtn = document.createElement('button');
      unBtn.className = 'picker-btn picker-unassign';
      unBtn.textContent = '✕  Remove Assignment';
      unBtn.onclick = () => { onCardAction(card, 'unassign'); picker.remove(); _pickerEl = null; };
      picker.appendChild(unBtn);
    }

    // Cancel
    const closeBtn = document.createElement('button');
    closeBtn.className = 'picker-btn picker-close';
    closeBtn.textContent = 'Cancel';
    closeBtn.onclick = () => { picker.remove(); _pickerEl = null; };
    picker.appendChild(closeBtn);

    document.getElementById('player-area').appendChild(picker);

    // Dismiss on outside click
    setTimeout(() => {
      document.addEventListener('click', function outsideClick(e) {
        if (!picker.contains(e.target)) {
          picker.remove(); _pickerEl = null;
          document.removeEventListener('click', outsideClick);
        }
      });
    }, 80);
  }

  // Live status bar for go-out builder
  function updateGoOutStatus(hand, round, meldGroups, discardId) {
    const statusEl = document.getElementById('goout-status-bar');
    if (!statusEl) return;

    const assigned = new Set();
    meldGroups.forEach(g => g.forEach(id => assigned.add(id)));
    if (discardId) assigned.add(discardId);

    const unassigned = hand.filter(c => !assigned.has(c.id)).length;
    const hasDiscard = !!discardId;
    const groupsFilled = meldGroups.some(g => g.size > 0);

    if (unassigned > 0) {
      statusEl.textContent = `⚠️ ${unassigned} card${unassigned > 1 ? 's' : ''} not yet assigned — tap a card to assign it`;
      statusEl.className = 'goout-status-bar status-warn';
    } else if (!hasDiscard) {
      statusEl.textContent = '⚠️ Mark one card as your Discard';
      statusEl.className = 'goout-status-bar status-warn';
    } else if (!groupsFilled) {
      statusEl.textContent = '⚠️ Assign cards to at least one meld Group';
      statusEl.className = 'goout-status-bar status-warn';
    } else {
      statusEl.textContent = '✅ All cards assigned! Tap SUBMIT GO OUT to validate your melds.';
      statusEl.className = 'goout-status-bar status-ok';
    }
  }

  // ── GO-OUT ERROR MODAL ────────────────────────────────────
  // Shows a clear error when submitted melds are invalid
  function showGoOutError(message) {
    // Remove any existing error
    const existing = document.getElementById('goout-error-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'goout-error-modal';
    modal.className = 'goout-error-overlay';
    modal.innerHTML = `
      <div class="goout-error-box">
        <div class="goout-error-icon">⚠️</div>
        <div class="goout-error-title">Invalid Go-Out</div>
        <div class="goout-error-msg">${escHtml(message)}</div>
        <div class="goout-error-hint">Fix your groups and try again.</div>
        <button class="btn btn-primary goout-error-btn" onclick="document.getElementById('goout-error-modal').remove()">OK, Fix It</button>
      </div>`;
    document.body.appendChild(modal);

    // Auto-dismiss after 6s
    setTimeout(() => { modal.remove(); }, 6000);
  }

  // ── DRAG HELPERS ─────────────────────────────────────────
  function _attachDrag(el, idx, container, onReorder) {
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
      setTimeout(() => el.classList.add('dragging'), 0);
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      container.querySelectorAll('.card').forEach(c => c.classList.remove('drag-over'));
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      container.querySelectorAll('.card').forEach(c => c.classList.remove('drag-over'));
      el.classList.add('drag-over');
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
      const toIdx = parseInt(el.dataset.idx);
      if (fromIdx !== toIdx && onReorder) onReorder(fromIdx, toIdx);
    });
  }

  function _attachTouchDrag(el, idx, container, onReorder) {
    let startX = 0, isDragging = false;
    el.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; isDragging = false; }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      const dx = e.touches[0].clientX - startX;
      if (!isDragging && Math.abs(dx) > 10) { isDragging = true; el.classList.add('dragging'); }
      if (!isDragging) return;
      e.preventDefault();
      const x = e.touches[0].clientX;
      const cards = [...container.querySelectorAll('.card:not(.dragging)')];
      cards.forEach(c => c.classList.remove('drag-over'));
      const target = cards.find(c => { const r = c.getBoundingClientRect(); return x >= r.left && x <= r.right; });
      if (target) target.classList.add('drag-over');
    }, { passive: false });
    el.addEventListener('touchend', () => {
      if (!isDragging) return;
      el.classList.remove('dragging');
      const overEl = container.querySelector('.card.drag-over');
      container.querySelectorAll('.card').forEach(c => c.classList.remove('drag-over'));
      if (overEl && onReorder) { const toIdx = parseInt(overEl.dataset.idx); if (toIdx !== idx) onReorder(idx, toIdx); }
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
  function renderGoneOutDisplay(players, localPlayerId) {
    const displayEl = document.getElementById('gone-out-display');
    const labelEl   = document.getElementById('gone-out-label');
    const meldsEl   = document.getElementById('gone-out-melds');
    const goingOutPlayer = players.find(p => p.wentOut && p.revealedMelds && p.revealedMelds.length > 0);
    if (!goingOutPlayer) { displayEl.style.display = 'none'; return; }

    displayEl.style.display = 'block';
    const isMe = goingOutPlayer.id === localPlayerId;
    labelEl.textContent = isMe
      ? '✅ Your melds (you went out!)'
      : `✅ ${escHtml(goingOutPlayer.name)} went out — their melds:`;
    meldsEl.innerHTML = '';

    goingOutPlayer.revealedMelds.forEach((meld, i) => {
      if (i > 0) {
        const sep = document.createElement('div');
        sep.className = 'gone-out-separator';
        meldsEl.appendChild(sep);
      }
      const group = document.createElement('div');
      group.className = 'gone-out-meld-group';
      // Label the meld type
      const meldLabel = document.createElement('div');
      meldLabel.className = 'gone-out-meld-label';
      meldLabel.textContent = `Meld ${i + 1}`;
      group.appendChild(meldLabel);
      meld.forEach(card => { group.appendChild(renderCard(card, {})); });
      meldsEl.appendChild(group);
    });
  }

  // ── OPPONENTS — Circular card-table layout ───────────────
  // Opponents sit around the top arc so everyone looks seated at a table.
  function renderOpponents(players, localPlayerId, currentTurnId) {
    const area = document.getElementById('opponents-area');
    area.innerHTML = '';

    const opponents = players.filter(p => p.id !== localPlayerId);
    const count = opponents.length;
    if (count === 0) { area.style.minHeight = '0'; area.style.height = '0'; return; }

    const areaW = area.offsetWidth || window.innerWidth;
    const rx = Math.min(areaW * 0.43, 300);
    const ry = Math.min(rx * 0.5, 120);
    const cx = areaW / 2;
    const cy = ry + 14;
    area.style.height = (cy + 82) + 'px';

    // Spread across top arc 205°→335° (top semicircle, left to right)
    opponents.forEach((p, i) => {
      const angle = count === 1 ? 270 : 205 + (i / (count - 1)) * 130;
      const rad = (angle * Math.PI) / 180;
      const x = cx + rx * Math.cos(rad);
      const y = cy + ry * Math.sin(rad);

      const zone = document.createElement('div');
      zone.className = 'opponent-zone';
      if (p.id === currentTurnId) zone.classList.add('active-turn');
      if (p.wentOut)              zone.classList.add('going-out');
      if (p.disconnected)         zone.classList.add('disconnected');
      zone.style.left = x + 'px';
      zone.style.top  = y + 'px';

      const avEl = renderAvatarEl(p.avatar, 38);
      if (!avatarContent(p.avatar))
        avEl.textContent = p.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);

      const cardBacks = Math.min(p.handCount, 8);
      let backsHtml = '';
      for (let b = 0; b < cardBacks; b++) backsHtml += '<div class="opp-card-mini">👑</div>';

      const info = document.createElement('div');
      info.className = 'opp-info';
      info.innerHTML =
        '<div class="opp-name">' + escHtml(p.name) +
        (p.id===currentTurnId?' 🎯':'') + (p.wentOut?' ✅':'') + '</div>' +
        '<div class="opp-cards">' + p.handCount + ' card' + (p.handCount!==1?'s':'') +
        ' · ' + p.score + 'pts</div>' +
        '<div class="opp-card-backs">' + backsHtml + '</div>';

      zone.appendChild(avEl);
      zone.appendChild(info);
      area.appendChild(zone);
    });

    // Glow the you-zone too when it is the local player's turn
    const youZone = document.getElementById('you-zone');
    if (youZone) {
      const localP = players.find(p => p.id === localPlayerId);
      youZone.classList.toggle('active-turn', localP && localP.id === currentTurnId);
    }
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
        if (!avatarContent(p.avatar)) avEl.textContent = p.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
        const nameDiv = document.createElement('div');
        nameDiv.className = 'player-name-lobby';
        nameDiv.textContent = p.name + (isMe ? ' (you)' : '');
        const badge = document.createElement('div');
        badge.className = 'player-badge';
        badge.textContent = p.isHost ? '👑 Host' : '✓ Ready';
        row.appendChild(avEl); row.appendChild(nameDiv); row.appendChild(badge);
      } else {
        row.style.opacity = '0.3';
        row.innerHTML = `<div style="width:42px;height:42px;border-radius:50%;background:#2a2030;display:flex;align-items:center;justify-content:center;color:#443322">?</div><div style="color:#443322;font-family:var(--font-heading)">Waiting for player ${i+1}…</div>`;
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
    let phaseText = '';
    if (phase === 'draw') phaseText = 'Draw a card';
    else if (phase === 'discard') phaseText = 'Discard a card';
    else if (phase === 'going-out') phaseText = drawnThisTurn ? '⚡ Final discard' : '⚡ Final draw';
    else if (phase === 'round-end') phaseText = 'Round over';
    else if (phase === 'game-over') phaseText = 'Game over!';
    document.getElementById('hdr-phase').textContent = phaseText;
  }

  // ── TURN INDICATOR ───────────────────────────────────────
  function updateTurnIndicator(isMyTurn, phase, drawnThisTurn) {
    const badge = document.getElementById('turn-indicator');
    badge.classList.toggle('hidden', !isMyTurn || phase === 'round-end' || phase === 'game-over');

    // Show GO OUT button only in normal discard phase (not final turns)
    const goOutBtn = document.getElementById('btn-go-out');
    goOutBtn.style.display = (isMyTurn && phase === 'discard') ? 'inline-block' : 'none';
  }

  // ── DRAW PILE ────────────────────────────────────────────
  function updateDrawPile(count, isMyTurn, phase, drawnThisTurn) {
    document.getElementById('draw-count').textContent = `${count} cards`;
    const pile = document.getElementById('draw-pile');
    const canDraw = isMyTurn && (phase === 'draw' || (phase === 'going-out' && !drawnThisTurn));
    pile.style.opacity = canDraw ? '1' : '0.55';
    pile.style.cursor  = canDraw ? 'pointer' : 'default';
  }

  // ── ACTION LOG ───────────────────────────────────────────
  function logAction(msg) {
    document.getElementById('action-log').textContent = msg;
  }

  // ── DEAL ANIMATION ───────────────────────────────────────
  function playDealAnimation(numCards, onComplete) {
    const overlay = document.getElementById('deal-overlay');
    overlay.classList.remove('hidden');
    overlay.innerHTML = '';
    const drawPileEl  = document.getElementById('draw-pile');
    const playerAreaEl = document.getElementById('player-hand');
    const gameEl      = document.getElementById('screen-game');
    const dpRect  = drawPileEl.getBoundingClientRect();
    const paRect  = playerAreaEl.getBoundingClientRect();
    const gameRect = gameEl.getBoundingClientRect();
    const sx = dpRect.left + dpRect.width/2  - gameRect.left - 28;
    const sy = dpRect.top  + dpRect.height/2 - gameRect.top  - 39;
    const handW   = paRect.width;
    const ex_base = paRect.left - gameRect.left;
    const ey      = paRect.top  - gameRect.top + 10;
    const cardDelay = Math.min(120, 800 / numCards);
    for (let i = 0; i < numCards; i++) {
      const cardEl = document.createElement('div');
      cardEl.className = 'deal-card-anim';
      cardEl.textContent = '👑';
      const spread = numCards <= 1 ? 0 : (i/(numCards-1)) * Math.min(handW-60, numCards*62);
      const ex = ex_base + spread;
      const rotation = (Math.random()-0.5)*10;
      cardEl.style.setProperty('--sx', `${sx}px`);
      cardEl.style.setProperty('--sy', `${sy}px`);
      cardEl.style.setProperty('--ex', `${ex}px`);
      cardEl.style.setProperty('--ey', `${ey}px`);
      cardEl.style.setProperty('--sr', '0deg');
      cardEl.style.setProperty('--er', `${rotation}deg`);
      cardEl.style.setProperty('--deal-dur', '450ms'); // medium-speed spin
      cardEl.style.setProperty('--deal-delay', `${i * cardDelay}ms`);
      cardEl.style.left = '0'; cardEl.style.top = '0';
      overlay.appendChild(cardEl);
    }
    setTimeout(() => {
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
      if (onComplete) onComplete();
    }, numCards * cardDelay + 350);
  }

  function animateDraw(fromDiscard) {
    const pileEl = document.getElementById(fromDiscard ? 'discard-pile' : 'draw-pile');
    pileEl.style.transform = 'scale(1.08)';
    setTimeout(() => { pileEl.style.transform = ''; }, 180);
    setTimeout(() => {
      const handCards = document.querySelectorAll('#player-hand .card');
      if (handCards.length > 0) {
        const last = handCards[handCards.length - 1];
        last.classList.add('just-drawn');
        setTimeout(() => last.classList.remove('just-drawn'), 500);
      }
    }, 100);
  }

  // ── ROUND RESULTS ────────────────────────────────────────
  // Shows just the running TOTAL score for each player after the round.
  function renderRoundResults(results, round, isGameOver, isHost) {
    document.getElementById('round-result-title').textContent = isGameOver ? '🏆 Game Over!' : `Round ${round} Complete!`;
    const table = document.getElementById('round-scores-table');
    table.innerHTML = '';
    const sorted = [...results].sort((a, b) => a.totalScore - b.totalScore);
    const t = document.createElement('table');
    t.className = 'round-score-table';
    t.innerHTML = `<tr><th>#</th><th>Player</th><th>Total Score</th></tr>`;
    const localId = Network.getLocalPlayerId();
    sorted.forEach((r, i) => {
      const tr = document.createElement('tr');
      if (r.playerId === localId) tr.classList.add('local-player');
      // Mark current leader
      if (i === 0) tr.classList.add('went-out');
      tr.innerHTML = `<td>${i+1}</td><td>${escHtml(r.name)}${r.playerId===localId?' (you)':''}</td><td class="score-total">${r.totalScore}</td>`;
      t.appendChild(tr);
    });
    table.appendChild(t);
    document.getElementById('round-result-next-info').textContent = isGameOver ? '' : `Next: Round ${round+1} of 11`;

    const nextBtn = document.getElementById('btn-next-round');
    // Remove any previous waiting message
    const oldWait = document.getElementById('waiting-host-msg-el');
    if (oldWait) oldWait.remove();

    if (isHost) {
      nextBtn.style.display = 'inline-block';
      nextBtn.textContent = isGameOver ? 'Back to Menu' : 'START NEXT ROUND →';
    } else {
      // Non-host players don't control the round flow — show a clear message
      nextBtn.style.display = 'none';
      if (!isGameOver) {
        const wait = document.createElement('div');
        wait.id = 'waiting-host-msg-el';
        wait.className = 'waiting-host-msg';
        wait.textContent = '⏳ Waiting for the host to start the next round…';
        document.getElementById('round-result-next-info').after(wait);
      }
    }
  }

  // ── GAME OVER ────────────────────────────────────────────
  function renderGameOver(results, winnerId, winnerName) {
    const localId = Network.getLocalPlayerId();
    const isWinner = winnerId === localId;
    document.getElementById('winner-name').textContent = isWinner ? '🏆 You Win!' : `🏆 ${winnerName} Wins!`;
    document.querySelector('.winner-sub').textContent = isWinner
      ? 'Congratulations! You had the lowest score!'
      : `${winnerName} had the lowest total score. Better luck next time!`;
    const finalTable = document.getElementById('final-scores-table');
    finalTable.innerHTML = '';
    const sorted = [...results].sort((a,b) => a.totalScore - b.totalScore);
    const t = document.createElement('table');
    t.className = 'round-score-table';
    t.innerHTML = `<tr><th>Rank</th><th>Player</th><th>Total Score</th></tr>`;
    sorted.forEach((r,i) => {
      const tr = document.createElement('tr');
      if (r.playerId === localId) tr.classList.add('local-player');
      if (r.playerId === winnerId) tr.classList.add('went-out');
      tr.innerHTML = `<td>${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}</td><td>${escHtml(r.name)}</td><td>${r.totalScore}</td>`;
      t.appendChild(tr);
    });
    finalTable.appendChild(t);
  }

  // ── SCOREBOARD ───────────────────────────────────────────
  // Shows just each player's current TOTAL score, ranked.
  function renderScoreboard(players, round) {
    const localId = Network.getLocalPlayerId();
    const content = document.getElementById('scoreboard-content');
    const sorted = [...players].sort((a,b) => a.score-b.score);
    const t = document.createElement('table');
    t.className = 'scoreboard-table';
    t.innerHTML = `<tr><th>#</th><th>Player</th><th>Total Score</th></tr>`;
    sorted.forEach((p,i) => {
      const tr = document.createElement('tr');
      if (i===0) tr.classList.add('leading-row');
      if (p.id===localId) tr.classList.add('local-row');
      const rankIcon = i===0?'🥇':i===1?'🥈':i===2?'🥉':(i+1);
      tr.innerHTML = `<td>${rankIcon}</td><td>${escHtml(p.name)}${p.id===localId?' (you)':''}</td><td><strong>${p.score}</strong></td>`;
      t.appendChild(tr);
    });
    content.innerHTML = '';
    const caption = document.createElement('div');
    caption.style.cssText = 'font-size:.8rem;color:#7a8a9a;margin-bottom:.8rem;font-style:italic;';
    caption.textContent = `After ${round - 1} of 11 round${round - 1 !== 1 ? 's' : ''} · lowest score wins`;
    content.appendChild(caption);
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

  function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return {
    renderCard, renderCardBack, renderHand, renderGoOutBuilder,
    renderDiscardTop, renderOpponents, renderGoneOutDisplay, renderLobby,
    updateHeader, updateTurnIndicator, updateDrawPile, logAction,
    renderRoundResults, renderGameOver, renderScoreboard,
    showToast, showGoOutError, updateGoOutStatus,
    playDealAnimation, animateDraw,
  };
})();
