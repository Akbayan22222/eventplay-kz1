const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public')); // Барлық файл осы папкада тұрады

io.on('connection', (socket) => {
    // Ойыншы қосылғанда экранға хабарлау
    socket.on('join', (name) => {
        io.emit('newPlayer', { id: socket.id, name: name });
    });

    // Дауыс деңгейін экранға жіберу
    socket.on('volume', (data) => {
        io.emit('moveCar', { id: socket.id, vol: data.vol });
    });
});

http.listen(3000, () => console.log('Ойын іске қосылды: http://localhost:3000'));
