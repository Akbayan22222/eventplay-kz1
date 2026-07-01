(() => {
  'use strict';

  const el = {
    joinScreen: document.getElementById('joinScreen'),
    gameScreen: document.getElementById('gameScreen'),
    joinForm: document.getElementById('joinForm'),
    nameInput: document.getElementById('nameInput'),
    joinButton: document.getElementById('joinButton'),
    badLink: document.getElementById('badLink'),
    playerNameDisplay: document.getElementById('playerNameDisplay'),
    playerCarLabel: document.getElementById('playerCarLabel'),
    playerCarImage: document.getElementById('playerCarImage'),
    connectionStatus: document.getElementById('connectionStatus'),
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

  const roomId = String(new URLSearchParams(location.search).get('room') || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  let peer = null;
  let connection = null;
  let audioContext = null;
  let analyser = null;
  let microphoneStream = null;
  let animationFrame = null;
  let sendInterval = null;
  let playerId = '';
  let raceStatus = 'lobby';
  let smoothedVolume = 0;

  if (!roomId) {
    el.badLink.classList.remove('hidden');
    el.joinForm.classList.add('hidden');
  }

  const savedName = localStorage.getItem('screamRaceName');
  if (savedName) el.nameInput.value = savedName;

  function toast(text) {
    el.toast.textContent = text;
    el.toast.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.toast.classList.remove('show'), 1800);
  }

  function safeName(value) {
    return String(value || '').replace(/[<>]/g, '').trim().slice(0, 20);
  }

  function setProgress(value) {
    const progress = Math.max(0, Math.min(100, Number(value) || 0));
    el.miniProgress.style.width = `${progress}%`;
    el.progressText.textContent = `${Math.round(progress)}%`;
  }

  function updateText() {
    if (raceStatus === 'running') {
      el.instructionText.textContent = 'КРИЧИ!';
      el.micHint.textContent = 'Чем громче, тем быстрее едет машина.';
    } else if (raceStatus === 'countdown') {
      el.instructionText.textContent = 'Приготовься';
      el.micHint.textContent = 'Сейчас старт.';
    } else if (raceStatus === 'finished') {
      el.instructionText.textContent = 'Гонка завершена';
      el.micHint.textContent = 'Жди следующего старта.';
    } else {
      el.instructionText.textContent = 'Жди старта';
      el.micHint.textContent = 'Когда начнётся гонка — кричи громче.';
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
      await audioContext.resume();

      const source = audioContext.createMediaStreamSource(microphoneStream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.18;
      source.connect(analyser);
      el.enableMicButton.classList.add('hidden');
      startMonitoring();
      return true;
    } catch (error) {
      console.error(error);
      el.enableMicButton.classList.remove('hidden');
      toast('Разреши микрофон в браузере');
      return false;
    }
  }

  function connect(name) {
    peer = new Peer(undefined, { debug: 1 });

    peer.on('open', () => {
      connection = peer.connect(`screamrace-${roomId.toLowerCase()}`, { reliable: true });

      connection.on('open', () => {
        connection.send({ type: 'join', name });
        el.joinScreen.classList.add('hidden');
        el.gameScreen.classList.remove('hidden');
        el.playerNameDisplay.textContent = name;
        localStorage.setItem('screamRaceName', name);
      });

      connection.on('data', handleMessage);

      connection.on('close', () => {
        el.connectionStatus.textContent = 'Отключено';
        el.connectionStatus.classList.add('offline');
      });

      connection.on('error', (error) => {
        console.error(error);
        toast('Ошибка связи');
      });
    });

    peer.on('error', (error) => {
      console.error(error);
      el.joinButton.disabled = false;
      el.joinButton.textContent = 'Подключиться';
      toast(error.type === 'peer-unavailable' ? 'Ведущий ещё не открыл игру' : 'Ошибка подключения');
    });
  }

  function handleMessage(data) {
    if (!data || typeof data !== 'object') return;

    if (data.type === 'joined') {
      playerId = data.playerId;
      raceStatus = data.status || 'lobby';
      setProgress(data.progress || 0);
      if (data.car) {
        el.playerCarLabel.textContent = data.car.name;
        el.playerCarImage.src = data.car.image;
      }
      updateText();
    }
    if (data.type === 'countdown') {
      raceStatus = 'countdown';
      updateText();
    }
    if (data.type === 'start') {
      raceStatus = 'running';
      updateText();
    }
    if (data.type === 'progress') {
      raceStatus = data.status || raceStatus;
      setProgress(data.progress);
    }
    if (data.type === 'finish') {
      raceStatus = 'finished';
      if (data.winnerId === playerId) {
        el.instructionText.textContent = 'ТЫ ПОБЕДИЛ!';
        el.micHint.textContent = 'Отличная гонка.';
      } else {
        el.instructionText.textContent = `${data.winnerName} победил`;
        el.micHint.textContent = 'Жди следующего старта.';
      }
    }
    if (data.type === 'reset') {
      raceStatus = 'lobby';
      smoothedVolume = 0;
      el.volumeFill.style.width = '0%';
      setProgress(0);
      updateText();
    }
  }

  function startMonitoring() {
    if (!analyser) return;
    clearInterval(sendInterval);
    if (animationFrame) cancelAnimationFrame(animationFrame);

    const timeData = new Uint8Array(analyser.fftSize);
    const freqData = new Uint8Array(analyser.frequencyBinCount);

    const loop = () => {
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
      }

      analyser.getByteTimeDomainData(timeData);
      analyser.getByteFrequencyData(freqData);

      let timeSum = 0;
      for (let i = 0; i < timeData.length; i += 1) {
        const v = (timeData[i] - 128) / 128;
        timeSum += v * v;
      }
      const rms = Math.sqrt(timeSum / timeData.length);

      let freqSum = 0;
      const maxBins = Math.min(80, freqData.length);
      for (let i = 2; i < maxBins; i += 1) freqSum += freqData[i];
      const freqLevel = freqSum / ((maxBins - 2) * 255);

      const raw = Math.max((rms - 0.006) * 16, (freqLevel - 0.03) * 2.2, 0);
      smoothedVolume = Math.min(1, smoothedVolume * 0.50 + raw * 0.50);

      const pct = Math.round(smoothedVolume * 100);
      el.volumeFill.style.width = `${pct}%`;
      el.micRing.style.transform = `scale(${1 + smoothedVolume * 0.16})`;
      el.micRing.style.boxShadow = `0 0 0 ${Math.round(smoothedVolume * 28)}px rgba(255,74,137,${0.22 * smoothedVolume})`;
      el.playerCarImage.classList.toggle('active', raceStatus === 'running' && smoothedVolume > 0.06);

      animationFrame = requestAnimationFrame(loop);
    };

    loop();

    sendInterval = setInterval(() => {
      if (connection && connection.open) {
        connection.send({ type: 'volume', value: smoothedVolume });
      }
    }, 55);
  }

  function leaveGame() {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    clearInterval(sendInterval);
    if (microphoneStream) microphoneStream.getTracks().forEach((track) => track.stop());
    if (audioContext) audioContext.close().catch(() => {});
    if (connection) connection.close();
    if (peer && !peer.destroyed) peer.destroy();
    location.href = 'index.html';
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && audioContext && audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
  });

  el.joinForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = safeName(el.nameInput.value);
    if (name.length < 2) {
      toast('Напиши имя');
      return;
    }

    el.joinButton.disabled = true;
    el.joinButton.textContent = 'Микрофон...';
    const allowed = await enableMicrophone();
    if (!allowed) {
      el.joinButton.disabled = false;
      el.joinButton.textContent = 'Подключиться';
      return;
    }

    el.joinButton.textContent = 'Подключение...';
    connect(name);
  });

  el.enableMicButton.addEventListener('click', enableMicrophone);
  el.leaveButton.addEventListener('click', leaveGame);

  updateText();
})();
