let p1Pos = 0;
let p2Pos = 0;

// Бұл функцияны WebSocket-тен келген деректер арқылы шақырасыз
function moveCar(playerId, volume) {
    if (playerId === 'p1') {
        p1Pos += volume * 2;
        document.getElementById('p1').style.left = p1Pos + "px";
    } else {
        p2Pos += volume * 2;
        document.getElementById('p2').style.left = p2Pos + "px";
    }
}
