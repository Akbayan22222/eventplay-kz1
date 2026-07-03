const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public')); // public папкасында HTML/CSS/JS тұрады

io.on('connection', (socket) => {
    console.log('Ойыншы қосылды: ' + socket.id);
    
    // Телефоннан дауыс деңгейі келгенде
    socket.on('volume', (data) => {
        // Барлық қосылған экрандарға (компьютерге) сигнал жіберу
        io.emit('move', { id: data.id, vol: data.vol });
    });
});

http.listen(3000, () => console.log('Сервер 3000-портта жұмыс істеп тұр'));
