(() => {
  'use strict';

  const els = {
    networkStatus: document.getElementById('networkStatus'),
    roomCode: document.getElementById('roomCode'),
    copyLinkButton: document.getElementById('copyLinkButton'),
    qrCanvas: document.getElementById('qrCanvas'),
    joinUrl: document.getElementById('joinUrl'),
    finishDistance: document.getElementById('finishDistance'),
    finishDistanceValue: document.getElementById('finishDistanceValue'),
    sensitivity: document.getElementById('sensitivity'),
    sensitivityValue: document.getElementById('sensitivityValue'),
    startButton: document.getElementById('startButton'),
    resetButton: document.getElementById('resetButton'),
    demoButton: document.getElementById('demoButton'),
    playerCount: document.getElementById('playerCount'),
    raceTitle: document.getElementById('raceTitle'),
    raceState: document.getElementById('raceState'),
    countdown: document.getElementById('countdown'),
    winnerOverlay: document.getElementById('winnerOverlay'),
    winnerName: document.getElementById('winnerName'),
    playAgainButton: document.getElementById('playAgainButton'),
    emptyState: document.getElementById('emptyState'),
    raceTracks: document.getElementById('raceTracks'),
    toast: document.getElementById('toast')
  };

  const carEmojis = ['🏎️', '🚙', '🚗', '🚕', '🛻', '🚓', '🚑', '🚒'];
  const playerColors = ['#ff3b77', '#7c5cff', '#22d3a7', '#ffc857', '#4db5ff', '#ff8a4c', '#c85cff', '#74e05d'];
  const players = new Map();
  let peer = null;
  let roomCode = '';
  let raceStatus = 'lobby';
  let winnerId = null;
  let demoTimer = null;
  let renderRequested = false;

  function makeRoomCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    return code;
  }

  function sanitizeName(value) {
    return String(value || 'Игрок').replace(/[<>]/g, '').trim().slice(0, 18) || 'Игрок';
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2200);
  }

  function getJoinUrl() {
    const base = new URL('player.html', window.location.href);
    base.searchParams.set('room', roomCode);
    return base.toString();
  }

  function setupQr() {
    const url = getJoinUrl();
    els.joinUrl.textContent = url;
    if (window.QRCode) {
      QRCode.toCanvas(els.qrCanvas, url, {
        width: 220,
        margin: 1,
        color: { dark: '#090b17', light: '#ffffff' }
      }, (error) => {
        if (error) showToast('Не удалось создать QR-код');
      });
    }
  }

  function setNetworkStatus(text, good = false) {
    els.networkStatus.textContent = text;
    els.networkStatus.style.color = good ? '#22d3a7' : '#ffc857';
    els.networkStatus.style.background = good ? 'rgba(34,211,167,.12)' : 'rgba(255,200,87,.12)';
  }

  function initPeer() {
    roomCode = makeRoomCode();
    els.roomCode.textContent = roomCode;
    setupQr();

    const peerId = `screamrace-${roomCode.toLowerCase()}`;
    peer = new Peer(peerId, { debug: 1 });

    peer.on('open', () => {
      setNetworkStatus('Комната онлайн', true);
    });

    peer.on('connection', (conn) => {
      conn.on('data', (data) => handleMessage(conn, data));
      conn.on('close', () => removePlayerByConnection(conn));
      conn.on('error', () => removePlayerByConnection(conn));
    });

    peer.on('error', (error) => {
      console.error(error);
      if (error.type === 'unavailable-id') {
        showToast('Код комнаты занят. Перезагрузите страницу.');
      } else {
        setNetworkStatus('Ошибка сети');
        showToast('Ошибка соединения PeerJS');
      }
    });

    peer.on('disconnected', () => {
      setNetworkStatus('Переподключение...');
      if (!peer.destroyed) peer.reconnect();
    });
  }

  function handleMessage(conn, data) {
    if (!data || typeof data !== 'object') return;

    if (data.type === 'join') {
      const id = conn.peer;
      if (players.has(id)) return;
      const index = players.size;
      players.set(id, {
        id,
        name: sanitizeName(data.name),
        progress: 0,
        volume: 0,
        conn,
        demo: false,
        color: playerColors[index % playerColors.length],
        car: carEmojis[index % carEmojis.length],
        finished: false
      });
      send(conn, { type: 'joined', playerId: id, status: raceStatus, progress: 0 });
      broadcastState();
      scheduleRender();
      showToast(`${sanitizeName(data.name)} подключился`);
      return;
    }

    const player = players.get(conn.peer);
    if (!player) return;

    if (data.type === 'volume') {
      const volume = Math.max(0, Math.min(1, Number(data.value) || 0));
      player.volume = volume;
      if (raceStatus === 'running' && !player.finished) {
        const sensitivity = Number(els.sensitivity.value);
        const distanceScale = 100 / Number(els.finishDistance.value);
        const movement = Math.max(0, volume - 0.045) * sensitivity * 1.4 * distanceScale;
        player.progress = Math.min(100, player.progress + movement);
        send(player.conn, { type: 'progress', progress: player.progress, status: raceStatus });
        if (player.progress >= 100) finishRace(player);
      }
      scheduleRender();
    }

    if (data.type === 'ping') send(conn, { type: 'pong' });
  }

  function send(conn, payload) {
    if (conn && conn.open) conn.send(payload);
  }

  function broadcast(payload) {
    players.forEach((player) => {
      if (!player.demo) send(player.conn, payload);
    });
  }

  function broadcastState() {
    broadcast({ type: 'state', status: raceStatus });
  }

  function removePlayerByConnection(conn) {
    const player = players.get(conn.peer);
    if (!player) return;
    players.delete(conn.peer);
    scheduleRender();
    showToast(`${player.name} отключился`);
  }

  function scheduleRender() {
    if (renderRequested) return;
    renderRequested = true;
    requestAnimationFrame(() => {
      renderRequested = false;
      renderPlayers();
    });
  }

  function renderPlayers() {
    const sorted = [...players.values()].sort((a, b) => b.progress - a.progress);
    els.playerCount.textContent = String(sorted.length);
    els.startButton.disabled = sorted.length === 0 || raceStatus === 'countdown' || raceStatus === 'running';
    els.emptyState.classList.toggle('hidden', sorted.length > 0);
    els.raceTracks.classList.toggle('hidden', sorted.length === 0);

    if (sorted.length === 0) {
      els.raceTitle.textContent = 'Ожидание игроков';
      els.raceTracks.innerHTML = '';
      return;
    }

    if (raceStatus === 'lobby') els.raceTitle.textContent = 'Игроки готовы';
    if (raceStatus === 'running') els.raceTitle.textContent = 'Гонка началась';
    if (raceStatus === 'finished') els.raceTitle.textContent = 'Финиш';

    els.raceTracks.innerHTML = sorted.map((player, index) => {
      const safeName = escapeHtml(player.name);
      return `
        <article class="track-card" data-player-id="${player.id}">
          <div class="track-info">
            <div class="player-label">
              <span class="player-dot" style="background:${player.color}"></span>
              <span class="player-name">${index + 1}. ${safeName}${player.demo ? ' · DEMO' : ''}</span>
            </div>
            <div class="player-stats">
              <span>${Math.round(player.progress)}%</span>
              <span>Громкость ${Math.round(player.volume * 100)}</span>
            </div>
          </div>
          <div class="track-lane">
            <div class="race-car" style="left:calc(${Math.min(94, player.progress * 0.94)}% - 4px)">${player.car}</div>
          </div>
          <div class="volume-line"><div style="width:${Math.min(100, player.volume * 100)}%"></div></div>
        </article>`;
    }).join('');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
    }[char]));
  }

  async function startRace() {
    if (players.size === 0 || raceStatus === 'running' || raceStatus === 'countdown') return;
    resetProgress(false);
    raceStatus = 'countdown';
    winnerId = null;
    updateRaceBadge('ОТСЧЁТ', '#ffc857', 'rgba(255,200,87,.12)');
    broadcast({ type: 'countdown', seconds: 3 });
    els.countdown.classList.remove('hidden');

    for (const value of ['3', '2', '1', 'GO!']) {
      els.countdown.textContent = value;
      await wait(value === 'GO!' ? 650 : 900);
    }

    els.countdown.classList.add('hidden');
    raceStatus = 'running';
    updateRaceBadge('ГОНКА', '#22d3a7', 'rgba(34,211,167,.12)');
    broadcast({ type: 'start' });
    startDemoLoop();
    scheduleRender();
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function finishRace(player) {
    if (raceStatus !== 'running') return;
    raceStatus = 'finished';
    player.finished = true;
    winnerId = player.id;
    clearInterval(demoTimer);
    demoTimer = null;
    updateRaceBadge('ФИНИШ', '#ff3b77', 'rgba(255,59,119,.12)');
    els.winnerName.textContent = player.name;
    els.winnerOverlay.classList.remove('hidden');
    broadcast({ type: 'finish', winnerId: player.id, winnerName: player.name });
    scheduleRender();
  }

  function resetProgress(notify = true) {
    clearInterval(demoTimer);
    demoTimer = null;
    players.forEach((player) => {
      player.progress = 0;
      player.volume = 0;
      player.finished = false;
      if (!player.demo) send(player.conn, { type: 'reset', progress: 0 });
    });
    raceStatus = 'lobby';
    winnerId = null;
    els.winnerOverlay.classList.add('hidden');
    els.countdown.classList.add('hidden');
    updateRaceBadge('ЛОББИ', '#22d3a7', 'rgba(34,211,167,.12)');
    if (notify) broadcast({ type: 'reset', progress: 0 });
    scheduleRender();
  }

  function updateRaceBadge(text, color, background) {
    els.raceState.textContent = text;
    els.raceState.style.color = color;
    els.raceState.style.background = background;
  }

  function addDemoPlayers() {
    const names = ['Айша', 'Данияр', 'Мади', 'Алина'];
    names.forEach((name, index) => {
      const id = `demo-${Date.now()}-${index}`;
      if ([...players.values()].some((p) => p.name === name && p.demo)) return;
      const colorIndex = players.size;
      players.set(id, {
        id,
        name,
        progress: 0,
        volume: 0,
        conn: null,
        demo: true,
        color: playerColors[colorIndex % playerColors.length],
        car: carEmojis[colorIndex % carEmojis.length],
        finished: false
      });
    });
    showToast('Демо-игроки добавлены');
    scheduleRender();
  }

  function startDemoLoop() {
    clearInterval(demoTimer);
    demoTimer = setInterval(() => {
      if (raceStatus !== 'running') return;
      players.forEach((player) => {
        if (!player.demo || player.finished) return;
        player.volume = 0.2 + Math.random() * 0.75;
        player.progress = Math.min(100, player.progress + player.volume * (0.9 + Math.random() * 1.8));
        if (player.progress >= 100 && raceStatus === 'running') finishRace(player);
      });
      scheduleRender();
    }, 150);
  }

  els.copyLinkButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getJoinUrl());
      showToast('Ссылка скопирована');
    } catch {
      showToast('Скопируйте ссылку под QR-кодом');
    }
  });

  els.finishDistance.addEventListener('input', () => {
    els.finishDistanceValue.textContent = els.finishDistance.value;
  });

  els.sensitivity.addEventListener('input', () => {
    els.sensitivityValue.textContent = `${Number(els.sensitivity.value).toFixed(1)}×`;
  });

  els.startButton.addEventListener('click', startRace);
  els.resetButton.addEventListener('click', () => resetProgress(true));
  els.playAgainButton.addEventListener('click', () => resetProgress(true));
  els.demoButton.addEventListener('click', addDemoPlayers);

  window.addEventListener('beforeunload', () => {
    if (peer && !peer.destroyed) peer.destroy();
  });

  initPeer();
  renderPlayers();
})();
