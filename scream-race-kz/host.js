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
    playerList: document.getElementById('playerList'),
    raceState: document.getElementById('raceState'),
    countdown: document.getElementById('countdown'),
    winnerOverlay: document.getElementById('winnerOverlay'),
    winnerName: document.getElementById('winnerName'),
    playAgainButton: document.getElementById('playAgainButton'),
    emptyState: document.getElementById('emptyState'),
    raceTracks: document.getElementById('raceTracks'),
    toast: document.getElementById('toast')
  };

  const playerColors = ['#ff5b86', '#7c5cff', '#22d3a7', '#ffc857', '#4db5ff', '#ff8a4c', '#72df89', '#d97cff'];
  const carCatalog = [
    { brand: 'Changan Alsvin', image: 'assets/changan-white.png', accent: '#3dd9ff' },
    { brand: 'Chevrolet Cobalt', image: 'assets/chevrolet-cobalt.png', accent: '#ffd166' },
    { brand: 'Toyota Camry', image: 'assets/toyota-camry.png', accent: '#9ae66e' },
    { brand: 'Changan Eado', image: 'assets/changan-red.png', accent: '#ff6b6b' },
    { brand: 'Hyundai Accent', image: 'assets/hyundai-accent.png', accent: '#a998ff' },
    { brand: 'Changan Alsvin Sport', image: 'assets/changan-front.png', accent: '#ff9d66' }
  ];

  const players = new Map();
  let peer = null;
  let roomCode = '';
  let raceStatus = 'lobby';
  let winnerId = null;
  let renderRequested = false;
  let physicsTimer = null;
  let countdownActive = false;
  let demoTimer = null;

  function makeRoomCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    return code;
  }

  function sanitizeName(value) {
    return String(value || 'Игрок').replace(/[<>]/g, '').trim().slice(0, 20) || 'Игрок';
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2200);
  }

  function setNetworkStatus(text, good = false) {
    els.networkStatus.textContent = text;
    els.networkStatus.style.color = good ? '#22d3a7' : '#ffc857';
    els.networkStatus.style.background = good ? 'rgba(34,211,167,.12)' : 'rgba(255,200,87,.12)';
  }

  function getJoinUrl() {
    const base = new URL('player.html', window.location.href);
    base.searchParams.set('room', roomCode);
    return base.toString();
  }

  function setupQr() {
    const url = getJoinUrl();
    els.joinUrl.textContent = url;
    if (!window.QRCode) return;
    QRCode.toCanvas(els.qrCanvas, url, {
      width: 220,
      margin: 1,
      color: { dark: '#090b17', light: '#ffffff' }
    }, (error) => {
      if (error) showToast('Не удалось создать QR-код');
    });
  }

  function getCarForSlot(index) {
    return carCatalog[index % carCatalog.length];
  }

  function initPeer() {
    roomCode = makeRoomCode();
    els.roomCode.textContent = roomCode;
    setupQr();

    const peerId = `screamrace-${roomCode.toLowerCase()}`;
    peer = new Peer(peerId, { debug: 1 });

    peer.on('open', () => setNetworkStatus('Комната онлайн', true));

    peer.on('connection', (conn) => {
      conn.on('data', (data) => handleMessage(conn, data));
      conn.on('close', () => removePlayerByConnection(conn));
      conn.on('error', () => removePlayerByConnection(conn));
    });

    peer.on('error', (error) => {
      console.error(error);
      if (error.type === 'unavailable-id') {
        showToast('Код комнаты уже занят. Обнови страницу.');
      } else {
        setNetworkStatus('Ошибка сети');
        showToast('Ошибка PeerJS');
      }
    });

    peer.on('disconnected', () => {
      setNetworkStatus('Переподключение...');
      if (!peer.destroyed) peer.reconnect();
    });
  }

  function createPlayerObject(id, conn, name, demo = false) {
    const index = players.size;
    const car = getCarForSlot(index);
    return {
      id,
      conn,
      demo,
      name: sanitizeName(name),
      brand: car.brand,
      image: car.image,
      accent: car.accent,
      color: playerColors[index % playerColors.length],
      volume: 0,
      progress: 0,
      finished: false,
      lastProgressSent: -1
    };
  }

  function handleMessage(conn, data) {
    if (!data || typeof data !== 'object') return;

    if (data.type === 'join') {
      const id = conn.peer;
      if (players.has(id)) return;
      const player = createPlayerObject(id, conn, data.name, false);
      players.set(id, player);

      send(conn, {
        type: 'joined',
        playerId: id,
        status: raceStatus,
        progress: player.progress,
        car: { brand: player.brand, image: player.image, accent: player.accent }
      });
      broadcastState();
      scheduleRender();
      showToast(`${player.name} подключился`);
      return;
    }

    const player = players.get(conn.peer);
    if (!player) return;

    if (data.type === 'volume') {
      player.volume = Math.max(0, Math.min(1, Number(data.value) || 0));
      scheduleRender();
      return;
    }

    if (data.type === 'ping') {
      send(conn, { type: 'pong' });
    }
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
    if (winnerId === player.id) winnerId = null;
    if (players.size === 0 && raceStatus !== 'lobby') resetRace(false);
    scheduleRender();
    showToast(`${player.name} вышел`);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
    }[char]));
  }

  function scheduleRender() {
    if (renderRequested) return;
    renderRequested = true;
    requestAnimationFrame(() => {
      renderRequested = false;
      render();
    });
  }

  function render() {
    const list = [...players.values()];
    const hasPlayers = list.length > 0;
    els.playerCount.textContent = String(list.length);
    els.startButton.disabled = !hasPlayers || raceStatus === 'running' || countdownActive;
    els.emptyState.classList.toggle('hidden', hasPlayers);
    els.raceTracks.classList.toggle('hidden', !hasPlayers);

    renderRoster(list);

    if (!hasPlayers) {
      els.raceTracks.innerHTML = '';
      return;
    }

    els.raceTracks.innerHTML = list.map((player) => {
      const safeName = escapeHtml(player.name);
      const safeBrand = escapeHtml(player.brand);
      const carLeft = Math.max(0, Math.min(82, player.progress * 0.82));
      const powerWidth = Math.round(player.volume * 100);
      return `
        <article class="track-card" data-player-id="${player.id}">
          <div class="track-head">
            <div class="track-player">
              <span class="player-dot" style="background:${player.color}"></span>
              <div class="player-text">
                <div class="player-name">${safeName}${player.demo ? ' · DEMO' : ''}</div>
                <div class="player-brand">${safeBrand}</div>
              </div>
            </div>
            <div class="track-numbers">
              <div class="progress-chip">${Math.round(player.progress)}%</div>
              <div class="power-meter"><div style="width:${powerWidth}%"></div></div>
            </div>
          </div>
          <div class="track-lane">
            <img class="race-car" src="${player.image}" alt="${safeBrand}" style="left:calc(${carLeft}% + 8px)" />
            <div class="finish-flag">FINISH</div>
            <div class="lane-glow"></div>
          </div>
        </article>`;
    }).join('');
  }

  function renderRoster(list) {
    if (list.length === 0) {
      els.playerList.innerHTML = '<div class="roster-empty">Пока никого нет</div>';
      return;
    }

    els.playerList.innerHTML = list.map((player) => `
      <div class="roster-item">
        <span class="roster-color" style="background:${player.color}"></span>
        <div class="roster-main">
          <div class="roster-name">${escapeHtml(player.name)}</div>
          <div class="roster-brand">${escapeHtml(player.brand)}</div>
        </div>
      </div>`).join('');
  }

  function setRaceBadge(text, color, background) {
    els.raceState.textContent = text;
    els.raceState.style.color = color;
    els.raceState.style.background = background;
  }

  function startPhysicsLoop() {
    clearInterval(physicsTimer);
    physicsTimer = setInterval(() => {
      if (raceStatus !== 'running') return;

      let changed = false;
      const sensitivity = Number(els.sensitivity.value);
      const distanceFactor = 100 / Number(els.finishDistance.value);

      players.forEach((player) => {
        if (player.finished) return;

        if (player.demo) {
          player.volume = 0.25 + Math.random() * 0.65;
        }

        const throttle = Math.max(0, player.volume - 0.03);
        const movement = Math.pow(throttle, 1.15) * 5.8 * sensitivity * distanceFactor;
        if (movement <= 0) return;

        player.progress = Math.min(100, player.progress + movement);
        changed = true;

        const rounded = Math.round(player.progress * 10) / 10;
        if (!player.demo && rounded !== player.lastProgressSent) {
          player.lastProgressSent = rounded;
          send(player.conn, { type: 'progress', progress: player.progress, status: raceStatus });
        }

        if (player.progress >= 100 && !winnerId) {
          finishRace(player);
        }
      });

      if (changed) scheduleRender();
    }, 85);
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function startRace() {
    if (players.size === 0 || raceStatus === 'running' || countdownActive) return;
    resetRace(false);
    countdownActive = true;
    raceStatus = 'countdown';
    winnerId = null;
    setRaceBadge('СТАРТ', '#ffc857', 'rgba(255,200,87,.12)');
    els.countdown.classList.remove('hidden');
    broadcast({ type: 'countdown', seconds: 3 });

    for (const value of ['3', '2', '1', 'GO!']) {
      els.countdown.textContent = value;
      await wait(value === 'GO!' ? 650 : 850);
    }

    els.countdown.classList.add('hidden');
    countdownActive = false;
    raceStatus = 'running';
    setRaceBadge('ГОНКА', '#22d3a7', 'rgba(34,211,167,.12)');
    broadcast({ type: 'start' });
    scheduleRender();
  }

  function finishRace(player) {
    if (raceStatus !== 'running' || winnerId) return;
    raceStatus = 'finished';
    winnerId = player.id;
    player.finished = true;
    setRaceBadge('ФИНИШ', '#ff3b77', 'rgba(255,59,119,.12)');
    els.winnerName.textContent = player.name;
    els.winnerOverlay.classList.remove('hidden');
    broadcast({ type: 'finish', winnerId: player.id, winnerName: player.name });
    scheduleRender();
  }

  function resetRace(notify = true) {
    winnerId = null;
    countdownActive = false;
    raceStatus = 'lobby';
    els.countdown.classList.add('hidden');
    els.winnerOverlay.classList.add('hidden');
    setRaceBadge('ЛОББИ', '#22d3a7', 'rgba(34,211,167,.12)');

    players.forEach((player) => {
      player.progress = 0;
      player.volume = 0;
      player.finished = false;
      player.lastProgressSent = -1;
      if (!player.demo && notify) {
        send(player.conn, { type: 'reset', progress: 0 });
      }
    });

    if (notify) broadcast({ type: 'reset', progress: 0 });
    scheduleRender();
  }

  function addDemoPlayers() {
    const names = ['Айша', 'Данияр', 'Мади', 'Алина'];
    names.forEach((name, index) => {
      const id = `demo-${Date.now()}-${index}`;
      if ([...players.values()].some((player) => player.name === name && player.demo)) return;
      const player = createPlayerObject(id, null, name, true);
      players.set(id, player);
    });
    showToast('Демо-игроки добавлены');
    scheduleRender();
  }

  els.copyLinkButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getJoinUrl());
      showToast('Ссылка скопирована');
    } catch {
      showToast('Скопируй ссылку под QR');
    }
  });

  els.finishDistance.addEventListener('input', () => {
    els.finishDistanceValue.textContent = els.finishDistance.value;
  });

  els.sensitivity.addEventListener('input', () => {
    els.sensitivityValue.textContent = `${Number(els.sensitivity.value).toFixed(1)}×`;
  });

  els.startButton.addEventListener('click', startRace);
  els.resetButton.addEventListener('click', () => resetRace(true));
  els.playAgainButton.addEventListener('click', () => resetRace(true));
  els.demoButton.addEventListener('click', addDemoPlayers);

  window.addEventListener('beforeunload', () => {
    clearInterval(physicsTimer);
    clearInterval(demoTimer);
    if (peer && !peer.destroyed) peer.destroy();
  });

  initPeer();
  startPhysicsLoop();
  render();
})();
