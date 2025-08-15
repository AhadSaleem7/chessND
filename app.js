// app.js
const express = require('express');
const { Chess } = require('chess.js');
const http = require('http');
const socketio = require('socket.io');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = socketio(server);

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

// Lobby Page
app.get('/', (req, res) => {
  res.render('lobby', { title: 'ChessND - Lobby' });
});

// Game Page
app.get('/game/:roomId', (req, res) => {
  res.render('game', {
    title: 'ChessND - Game',
    roomId: req.params.roomId
  });
});

/* 
    Store multiple games:
    games[roomId] = { chess: ChessInstance, players: {white: socketId, black: socketId}, currentPlayer }
*/
let games = {};

// Utility to create a random room
function createGameRoom() {
  const roomId = 'room-' + Date.now();
  games[roomId] = {
    chess: new Chess(),
    players: {}, // { white: socketId, black: socketId }
    currentPlayer: 'w'
  };
  return roomId;
}

io.on("connection", (socket) => {
  console.log('A user connected:', socket.id);

  // =====================================================
  // Handle joining a named room (from friend or self)
  socket.on('joinRoomByName', ({ roomId, playerName }) => {
    if (!games[roomId]) {
      games[roomId] = {
        chess: new Chess(),
        players: {},
        currentPlayer: 'w'
      };
    }
    const game = games[roomId];

    // Inform existing players
    Object.values(game.players).forEach(playerId => {
      if (playerId) {
        socket.emit('connected', roomId);
        io.to(playerId).emit('connected', playerName);
      }
    });

    socket.join(roomId);

    // Assign role
    if (!game.players.white) {
      game.players.white = socket.id;
      socket.emit('playerColor', 'white');
      socket.emit('playerRole', 'w');
    } else if (!game.players.black) {
      game.players.black = socket.id;
      socket.emit('playerColor', 'black');
      socket.emit('playerRole', 'b');
    } else {
      socket.emit('full', 'Game is full');
      socket.emit('playerRole', 'spectator');
    }

    // Send initial board
    socket.emit('boardState', game.chess.fen());

    // Store roomId on socket for disconnect handling
    socket.data.roomId = roomId;
  });

  // =====================================================
  // Random matchmaking (old logic)
  socket.on('joinRandom', () => {
    let roomId = Object.keys(games).find(id =>
      !games[id].players.white || !games[id].players.black
    );
    if (!roomId) roomId = createGameRoom();

    const game = games[roomId];

    // Notify already connected players
    Object.values(games[roomId].players).forEach(playerId => {
      if (playerId) {
        socket.emit('connected', playerId);
        io.to(playerId).emit('connected', socket.id);
      }
    });

    socket.join(roomId);

    if (!game.players.white) {
      game.players.white = socket.id;
      socket.emit('playerColor', 'white');
      socket.emit('playerRole', 'w');
    } else if (!game.players.black) {
      game.players.black = socket.id;
      socket.emit('playerColor', 'black');
      socket.emit('playerRole', 'b');
    } else {
      socket.emit('full', 'Game is full');
      socket.emit('playerRole', 'spectator');
    }

    socket.emit('boardState', game.chess.fen());
    socket.data.roomId = roomId;
  });

  // =====================================================
  // Handle move
  socket.on('move', (move) => {
    const roomId = socket.data.roomId;
    if (!roomId || !games[roomId]) return;

    const game = games[roomId];
    try {
      if (game.chess.turn() === 'w' && game.players.white !== socket.id) return;
      if (game.chess.turn() === 'b' && game.players.black !== socket.id) return;

      const validMove = game.chess.move(move);
      if (validMove) {
        io.to(roomId).emit('move', move);
        game.currentPlayer = game.chess.turn();
        io.to(roomId).emit('turn', game.currentPlayer);
        io.to(roomId).emit('boardState', game.chess.fen());
        // Check for various endings
        if (game.chess.isCheckmate()) {
          // Checkmate: other side wins
          const color = game.chess.turn() === 'w' ? 'black' : 'white';
          io.to(roomId).emit('gameEnd', {
            result: 'checkmate',
            winner: color,
            reason: 'Checkmate'
          });
        } else if (game.chess.isStalemate()) {
          io.to(roomId).emit('gameEnd', {
            result: 'draw',
            winner: null,
            reason: 'Stalemate'
          });
        } else if (game.chess.insufficient_material()) {
          io.to(roomId).emit('gameEnd', {
            result: 'draw',
            winner: null,
            reason: 'Insufficient material'
          });
        } else if (game.chess.in_threefold_repetition()) {
          io.to(roomId).emit('gameEnd', {
            result: 'draw',
            winner: null,
            reason: 'Threefold repetition'
          });
        } else if (game.chess.half_moves >= 100) { // 50 full moves = 100 half moves
          io.to(roomId).emit('gameEnd', {
            result: 'draw',
            winner: null,
            reason: '50-move rule'
          });
        }

      } else {
        socket.emit('invalidMove', {
          move,
          fen: game.chess.fen(),
          message: 'Invalid move'
        });
      }
    } catch (error) {
      console.error('Caught invalid move error:', error);
      socket.emit('invalidMove', {
        move,
        fen: game.chess.fen(),
        message: 'Invalid move (exception caught)'
      });
    }
  });

  // =====================================================
  // Handle disconnection
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !games[roomId]) return;

    console.log('User disconnected:', socket.id);
    const game = games[roomId];
    io.to(roomId).emit('playerDisconnected', socket.id);

    let resetNeeded = false;

    if (game.players.white === socket.id) {
      delete game.players.white;
      resetNeeded = true;
    }
    if (game.players.black === socket.id) {
      delete game.players.black;
      resetNeeded = true;
    }

    if (resetNeeded) {
      game.chess = new Chess();
      game.currentPlayer = 'w';
      io.to(roomId).emit('resetBoard', game.chess.fen());
      io.to(roomId).emit('turn', game.currentPlayer);
    }

    if (!game.players.white && !game.players.black) {
      delete games[roomId];
    }
  });

  // =====================================================
  // Reload handling (same as before)
  socket.on('reload', (socketId) => {
    const roomId = socket.data.roomId;
    if (!roomId || !games[roomId]) return;

    const game = games[roomId];
    if (game.players.black === socketId) {
      delete game.players.black;
      game.players.white = socket.id;
      socket.emit('playerRole', 'w');
    }
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

