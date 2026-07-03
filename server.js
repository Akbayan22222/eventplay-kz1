const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

io.on('connection', (socket) => {
    socket.on('volume', (data) => {
        io.emit('move', data);
    });
});

http.listen(3000, () => console.log('Ойын іске қосылды: http://localhost:3000'));
