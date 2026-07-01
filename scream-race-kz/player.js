(() => {
  'use strict';

  const els = {
    joinScreen: document.getElementById('joinScreen'),
    gameScreen: document.getElementById('gameScreen'),
    joinForm: document.getElementById('joinForm'),
    roomInput: document.getElementById('roomInput'),
    nameInput: document.getElementById('nameInput'),
    joinButton: document.getElementById('joinButton'),
    playerNameDisplay: document.getElementById('playerNameDisplay'),
    connectionStatus: document.getElementById('connectionStatus'),
    playerCar: document.getElementById('playerCar'),
    miniProgress: document.getElementById('miniProgress'),
    progressText: document.getElementById('progressText'),
    micRing: document.getElementById('micRing'),
    instructionText: document.getElementById('instructionText'),
    micHint: document.getElementById('micHint'),
    volumeFill: document.getElementById('volumeFill'),
    enableMicButton: document.getElementById('enableMicButton'),
    leaveButton: document.getElementById('leaveButton'),
    toast: document.getElementById('toast')
  };

  let peer = null;
  let conn = null;
  let audioContext = null;
  let analyser = null;
  let microphoneStream = null;
  let animationFrame = null;
  let micEnabled = false;
  let raceStatus = 'lobby';
  let playerId = null;
  let progress = 0;
  let smoothedVolume = 0;
  let lastSentAt = 0;

  const params = new URLSearchParams(window.location.search);
  const roomFromUrl = (params.get('room') || '').toUpperCase();
  if (roomFromUrl) els.roomInput.value = roomFromUrl;
  const savedName = localStorage.getItem('screamRacePlayerName');
  if (savedName) els.nameInput.value = savedName;

  function sanitizeRoom(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  }

  function sanitizeName(value) {
    return String(value || '').replace(/[<>]/g, '').trim().slice(0, 18);
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2300);
  }

  function setStatus(text, color = '#22d3a7', background = 'rgba(34,211,167,.12)') {
    els.connectionStatus.textContent = text;
    els.connectionStatus.style.color = color;
    els.connectionStatus.style.background = background;
  }

  function connectToRoom(room, name) {
    els.joinButton.disabled = true;
    els.joinButton.textContent = 'Подключение...';

    peer = new Peer(undefined, { debug: 1 });

    peer.on('open', () => {
      const hostPeerId = `screamrace-${room.toLowerCase()}`;
      conn = peer.connect(hostPeerId, { reliable: true });

      conn.on('open', () => {
        conn.send({ type: 'join', name });
        els.joinScreen.classList.add('hidden');
        els.gameScreen.classList.remove('hidden');
        els.playerNameDisplay.textContent = name;
        localStorage.setItem('screamRacePlayerName', name);
        setStatus('Онлайн');
        showToast('Подключено к комнате');
      });

      conn.on('data', handleMessage);

      conn.on('close', () => {
        setStatus('Отключено', '#ffc857', 'rgba(255,200,87,.12)');
        raceStatus = 'lobby';
        updateInstruction();
      });

      conn.on('error', () => {
        showToast('Ошибка соединения с ведущим');
      });
    });

    peer.on('error', (error) => {
      console.error(error);
      els.joinButton.disabled = false;
      els.joinButton.textContent = 'Подключиться';
      if (error.type === 'peer-unavailable') {
        showToast('Комната не найдена. Проверь код.');
      } else {
        showToast('Не удалось подключиться');
      }
    });
  }

  function handleMessage(data) {
    if (!data || typeof data !== 'object') return;

    switch (data.type) {
      case 'joined':
        playerId = data.playerId;
        raceStatus = data.status || 'lobby';
        setProgress(data.progress || 0);
        updateInstruction();
        break;
      case 'state':
        raceStatus = data.status || raceStatus;
        updateInstruction();
        break;
      case 'countdown':
        raceStatus = 'countdown';
        els.instructionText.textContent = 'Приготовься!';
        els.micHint.textContent = 'Гонка начнётся через несколько секунд.';
        break;
      case 'start':
        raceStatus = 'running';
        els.instructionText.textContent = 'КРИЧИ!';
        els.micHint.textContent = 'Чем громче голос, тем быстрее машинка.';
        els.playerCar.classList.add('active');
        break;
      case 'progress':
        raceStatus = data.status || raceStatus;
        setProgress(data.progress || 0);
        break;
      case 'finish':
        raceStatus = 'finished';
        els.playerCar.classList.remove('active');
        if (data.winnerId === playerId) {
          els.instructionText.textContent = 'Ты победил! 🏆';
          els.micHint.textContent = 'Отличная гонка.';
        } else {
          els.instructionText.textContent = `${data.winnerName} победил`;
          els.micHint.textContent = 'Жди следующего старта.';
        }
        break;
      case 'reset':
        raceStatus = 'lobby';
        setProgress(0);
        els.playerCar.classList.remove('active');
        updateInstruction();
        break;
      default:
        break;
    }
  }

  function setProgress(value) {
    progress = Math.max(0, Math.min(100, Number(value) || 0));
    els.miniProgress.style.width = `${progress}%`;
    els.progressText.textContent = `${Math.round(progress)}%`;
  }

  function updateInstruction() {
    if (!micEnabled) {
      els.instructionText.textContent = 'Включи микрофон';
      els.micHint.textContent = 'Он нужен, чтобы управлять машинкой.';
      return;
    }
    if (raceStatus === 'running') {
      els.instructionText.textContent = 'КРИЧИ!';
      els.micHint.textContent = 'Чем громче голос, тем быстрее машинка.';
    } else if (raceStatus === 'countdown') {
      els.instructionText.textContent = 'Приготовься!';
      els.micHint.textContent = 'Скоро старт.';
    } else if (raceStatus === 'finished') {
      els.instructionText.textContent = 'Гонка завершена';
      els.micHint.textContent = 'Жди следующего старта.';
    } else {
      els.instructionText.textContent = 'Жди старта ведущего';
      els.micHint.textContent = 'После старта кричи громче, чтобы машинка ехала.';
    }
  }

  async function enableMicrophone() {
    try {
      microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(microphoneStream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.35;
      source.connect(analyser);

      micEnabled = true;
      els.enableMicButton.textContent = 'Микрофон включён';
      els.enableMicButton.disabled = true;
      updateInstruction();
      monitorVolume();
      showToast('Микрофон включён');
    } catch (error) {
      console.error(error);
      showToast('Разреши доступ к микрофону в браузере');
    }
  }

  function monitorVolume() {
    if (!analyser) return;
    const samples = new Uint8Array(analyser.fftSize);

    const loop = (timestamp) => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i += 1) {
        const normalized = (samples[i] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / samples.length);
      const normalizedVolume = Math.min(1, Math.max(0, (rms - 0.015) * 8.5));
      smoothedVolume = smoothedVolume * 0.65 + normalizedVolume * 0.35;

      const visual = Math.round(smoothedVolume * 100);
      els.volumeFill.style.width = `${visual}%`;
      els.micRing.style.transform = `scale(${1 + smoothedVolume * 0.16})`;
      els.micRing.style.boxShadow = `0 0 0 ${Math.round(smoothedVolume * 28)}px rgba(255,59,119,${0.18 * smoothedVolume})`;

      if (conn && conn.open && timestamp - lastSentAt > 85) {
        conn.send({ type: 'volume', value: smoothedVolume });
        lastSentAt = timestamp;
      }

      animationFrame = requestAnimationFrame(loop);
    };

    animationFrame = requestAnimationFrame(loop);
  }

  function disconnect() {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    if (microphoneStream) microphoneStream.getTracks().forEach((track) => track.stop());
    if (audioContext) audioContext.close().catch(() => {});
    if (conn) conn.close();
    if (peer && !peer.destroyed) peer.destroy();
    window.location.href = 'player.html';
  }

  els.joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const room = sanitizeRoom(els.roomInput.value);
    const name = sanitizeName(els.nameInput.value);

    if (room.length < 4) {
      showToast('Введите правильный код комнаты');
      return;
    }
    if (name.length < 2) {
      showToast('Введите имя');
      return;
    }
    connectToRoom(room, name);
  });

  els.roomInput.addEventListener('input', () => {
    els.roomInput.value = sanitizeRoom(els.roomInput.value);
  });

  els.enableMicButton.addEventListener('click', enableMicrophone);
  els.leaveButton.addEventListener('click', disconnect);
  window.addEventListener('beforeunload', () => {
    if (microphoneStream) microphoneStream.getTracks().forEach((track) => track.stop());
  });
})();
