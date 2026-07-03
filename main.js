let p1Pos = 0;
let targetP1 = 0;

const startBtn = document.getElementById('start-game');
startBtn.addEventListener('click', async () => {
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('game-arena').style.display = 'block';
    
    // Микрофонды қосу
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    source.connect(analyser);
    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function animate() {
        analyser.getByteFrequencyData(dataArray);
        let sum = dataArray.reduce((a, b) => a + b);
        let avg = sum / bufferLength;

        // Машинаны жылжыту (Lerp)
        targetP1 = avg * 3;
        p1Pos += (targetP1 - p1Pos) * 0.05;
        document.getElementById('p1').style.left = p1Pos + "px";

        requestAnimationFrame(animate);
    }
    animate();
});
