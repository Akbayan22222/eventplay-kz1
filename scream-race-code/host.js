(() => {
  'use strict';

  const el = {
    networkStatus: document.getElementById('networkStatus'),
    qrImage: document.getElementById('qrImage'),
    startButton: document.getElementById('startButton'),
    resetButton: document.getElementById('resetButton'),
    demoButton: document.getElementById('demoButton'),
    playerCount: document.getElementById('playerCount'),
    playerList: document.getElementById('playerList'),
    raceState: document.getElementById('raceState'),
    emptyState: document.getElementById('emptyState'),
    raceTracks: document.getElementById('raceTracks'),
    countdown: document.getElementById('countdown'),
    winnerOverlay: document.getElementById('winnerOverlay'),
    winnerName: document.getElementById('winnerName'),
    playAgainButton: document.getElementById('playAgainButton'),
    toast: document.getElementById('toast')
  };

  const cars = [
    { name: 'Changan Alsvin', image: 'assets/car-changan.png' },
    { name: 'Chevrolet Cobalt', image: 'assets/car-cobalt.png' },
    { name: 'Toyota Camry', image: 'assets/car-camry.png' }
  ];

  const colors = ['#ff477e', '#00d9ff', '#ffd166', '#8cff66', '#a878ff', '#ff8a5b'];
  const players = new Map();

  let peer;
  let roomId = '';
  let raceStatus = 'lobby';
  let winnerId = null;
  let countdownRunning = false;

  function createRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  function safeName(value) {
    return String(value || 'Игрок').replace(/[<>]/g, '').trim().slice(0, 20) || 'Игрок';
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[char]));
  }

  function toast(text) {
    el.toast.textContent = text;
    el.toast.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.toast.classList.remove('show'), 1800);
  }

  function setStatus(text, online) {
    el.networkStatus.textContent = text;
    el.networkStatus.classList.toggle('offline', !online);
  }

  function joinUrl() {
    const url = new URL('player.html', window.location.href);
    url.searchParams.set('room', roomId);
    return url.toString();
  }

  function showQr() {
    const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=420x420&margin=12&data=' + encodeURIComponent(joinUrl());
    el.qrImage.src = qrUrl;
  }

  function initPeer() {
    roomId = createRoomId();
    showQr();

    peer = new Peer(`screamrace-${roomId.toLowerCase()}`, { debug: 1 });

    peer.on('open', () => setStatus('Комната онлайн', true));

    peer.on('connection', connection => {
      connection.on('data', data => handleMessage(connection, data));
      connection.on('close', () => removePlayer(connection.peer));
      connection.on('error', () => removePlayer(connection.peer));
    });

    peer.on('error', error => {
      console.error(error);
      setStatus('Ошибка сети', false);
      toast('Обнови страницу');
    });

    peer.on('disconnected', () => {
      setStatus('Переподключение...', false);
      if (!peer.destroyed) peer.reconnect();
    });
  }

  function handleMessage(connection, data) {
    if (!data || typeof data !== 'object') return;

    if (data.type === 'join') {
      if (players.has(connection.peer)) return;

      const index = players.size;
      const car = cars[index % cars.length];
      const player = {
        id: connection.peer,
        connection,
        name: safeName(data.name),
        carName: car.name,
        carImage: car.image,
        color: colors[index % colors.length],
        progress: 0,
        volume: 0,
        demo: false,
        finished: false
      };

      players.set(player.id, player);
      send(connection, {
        type: 'joined',
        playerId: player.id,
        status: raceStatus,
        progress: 0,
        car: { name: player.carName, image: player.carImage }
      });

      render();
      toast(`${player.name} подключился`);
      return;
    }

    const player = players.get(connection.peer);
    if (!player) return;

    if (data.type === 'volume') {
      player.volume = Math.max(0, Math.min(1, Number(data.value) || 0));
      render();
    }
  }

  function send(connection, data) {
    if (connection && connection.open) connection.send(data);
  }

  function broadcast(data) {
    players.forEach(player => {
      if (!player.demo) send(player.connection, data);
    });
  }

  function removePlayer(id) {
    if (!players.has(id)) return;
    players.delete(id);
    render();
  }

  function render() {
    const list = [...players.values()];
    el.playerCount.textContent = list.length;
    el.startButton.disabled = list.length === 0 || raceStatus === 'running' || countdownRunning;
    el.emptyState.classList.toggle('hidden', list.length > 0);
    el.raceTracks.classList.toggle('hidden', list.length === 0);

    el.playerList.innerHTML = list.length
      ? list.map(player => `
          <div class="player-list-item">
            <span style="background:${player.color}"></span>
            <div><strong>${escapeHtml(player.name)}</strong><small>${escapeHtml(player.carName)}</small></div>
          </div>`).join('')
      : '<div class="no-players">Пока никого нет</div>';

    el.raceTracks.innerHTML = list.map(player => {
      const left = Math.min(84, player.progress * 0.84);
      return `
        <article class="track">
          <div class="track-info">
            <div>
              <strong>${escapeHtml(player.name)}</strong>
              <span>${escapeHtml(player.carName)}</span>
            </div>
            <b>${Math.round(player.progress)}%</b>
          </div>
          <div class="road">
            <div class="road-line"></div>
            <div class="finish-line"></div>
            <img src="${player.carImage}" alt="${escapeHtml(player.carName)}" style="left:calc(${left}% + 10px)">
          </div>
        </article>`;
    }).join('');
  }

  function physicsStep() {
    if (raceStatus !== 'running') return;

    players.forEach(player => {
      if (player.finished) return;

      if (player.demo) player.volume = 0.25 + Math.random() * 0.7;

      const loudness = Math.max(0, player.volume - 0.025);
      if (loudness <= 0) return;

      player.progress = Math.min(100, player.progress + Math.pow(loudness, 1.12) * 7.5);

      if (!player.demo) {
        send(player.connection, {
          type: 'progress',
          progress: player.progress,
          status: raceStatus
        });
      }

      if (player.progress >= 100 && !winnerId) finishRace(player);
    });

    render();
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function startRace() {
    if (!players.size || raceStatus === 'running' || countdownRunning) return;

    resetRace(false);
    countdownRunning = true;
    raceStatus = 'countdown';
    el.raceState.textContent = 'СТАРТ';
    el.countdown.classList.remove('hidden');
    broadcast({ type: 'countdown' });

    for (const value of ['3', '2', '1', 'GO!']) {
      el.countdown.textContent = value;
      await wait(value === 'GO!' ? 600 : 850);
    }

    el.countdown.classList.add('hidden');
    countdownRunning = false;
    raceStatus = 'running';
    el.raceState.textContent = 'ГОНКА';
    broadcast({ type: 'start' });
  }

  function finishRace(player) {
    raceStatus = 'finished';
    winnerId = player.id;
    player.finished = true;
    el.raceState.textContent = 'ФИНИШ';
    el.winnerName.textContent = player.name;
    el.winnerOverlay.classList.remove('hidden');
    broadcast({ type: 'finish', winnerId: player.id, winnerName: player.name });
  }

  function resetRace(notify = true) {
    raceStatus = 'lobby';
    winnerId = null;
    countdownRunning = false;
    el.raceState.textContent = 'ЛОББИ';
    el.countdown.classList.add('hidden');
    el.winnerOverlay.classList.add('hidden');

    players.forEach(player => {
      player.progress = 0;
      player.volume = 0;
      player.finished = false;
    });

    if (notify) broadcast({ type: 'reset', progress: 0 });
    render();
  }

  function addDemoPlayers() {
    ['Айша', 'Данияр', 'Мади'].forEach((name, index) => {
      if ([...players.values()].some(player => player.demo && player.name === name)) return;
      const car = cars[players.size % cars.length];
      players.set(`demo-${Date.now()}-${index}`, {
        id: `demo-${Date.now()}-${index}`,
        connection: null,
        name,
        carName: car.name,
        carImage: car.image,
        color: colors[players.size % colors.length],
        progress: 0,
        volume: 0,
        demo: true,
        finished: false
      });
    });
    render();
  }

  el.startButton.addEventListener('click', startRace);
  el.resetButton.addEventListener('click', () => resetRace(true));
  el.playAgainButton.addEventListener('click', () => resetRace(true));
  el.demoButton.addEventListener('click', addDemoPlayers);

  window.addEventListener('beforeunload', () => {
    if (peer && !peer.destroyed) peer.destroy();
  });

  initPeer();
  setInterval(physicsStep, 90);
  render();
})();
