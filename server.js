const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

let game = new Chess();
let players = {};

io.on('connection', (socket) => {
  console.log('ada yg masuk:', socket.id);
  if (!players.white) players.white = socket.id;
  else if (!players.black) players.black = socket.id;

  socket.emit('init', game.fen());

  socket.on('move', (move) => {
    const result = game.move(move);
    if (result) io.emit('move', game.fen());
  });

  socket.on('disconnect', () => {
    if (players.white === socket.id) players.white = null;
    if (players.black === socket.id) players.black = null;
  });
});

server.listen(process.env.PORT || 3000, () => console.log('Server jalan di port 3000'));
