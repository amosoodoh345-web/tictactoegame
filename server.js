/* =======================================================================
   server.js — Express + Socket.IO server for Tic-Tac-Toe online mode.

   Responsibilities:
     1. Serve the static client (public/) so the whole app runs from one
        process: node server.js, then open http://localhost:3000.
     2. Hold *live* game state for each open room in memory (a Map). This
        is intentionally not persisted — it only needs to exist while a
        match is being played in real time.
     3. On game end, persist the result (and updated win/loss/draw tallies)
        to Neon Postgres via db.js, so scores and history survive restarts
        and are visible from any device.
     4. Expose small REST endpoints so the client can read back a player's
        stats/history and the global leaderboard from Neon.
   ======================================================================= */

'use strict';

require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const db = require('./db');

const PORT = process.env.PORT || 3000;

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

// ---------- In-memory room registry ----------
// Map<roomCode, Room>. A Room looks like:
// {
//   roomCode, board, current, winner, winningLine, starter,
//   players: { X: {id, name, socketId, connected} | null,
//              O: {id, name, socketId, connected} | null }
// }
const rooms = new Map();

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity

function generateRoomCode() {
  let code;
  do {
    code = Array.from({ length: 5 }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function checkWinner(board) {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }
  if (board.every(Boolean)) return { winner: 'draw', line: null };
  return null;
}

/** Strips server-internal fields (socket ids) before sending state to clients. */
function publicRoomState(room) {
  return {
    roomCode: room.roomCode,
    board: room.board,
    current: room.current,
    winner: room.winner,
    winningLine: room.winningLine,
    players: {
      X: room.players.X ? { name: room.players.X.name, connected: room.players.X.connected } : null,
      O: room.players.O ? { name: room.players.O.name, connected: room.players.O.connected } : null
    }
  };
}

function emitRoomState(io, room) {
  io.to(room.roomCode).emit('state-update', publicRoomState(room));
}

function otherSymbol(symbol) {
  return symbol === 'X' ? 'O' : 'X';
}

function removeEmptyRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (room && !room.players.X && !room.players.O) {
    rooms.delete(roomCode);
  }
}

// =======================================================================
// Express app + static file serving
// =======================================================================
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- REST endpoints backed by Neon ----------
app.get('/api/leaderboard', async (req, res) => {
  try {
    res.json(await db.getLeaderboard(10));
  } catch (err) {
    console.error('[api] Failed to load leaderboard', err);
    res.status(500).json({ error: 'Failed to load leaderboard.' });
  }
});

app.get('/api/players/:id/history', async (req, res) => {
  try {
    const [player, matches] = await Promise.all([
      db.getPlayer(req.params.id),
      db.getRecentMatchesForPlayer(req.params.id, 20)
    ]);
    res.json({ player: player || { wins: 0, losses: 0, draws: 0 }, matches });
  } catch (err) {
    console.error('[api] Failed to load player history', err);
    res.status(500).json({ error: 'Failed to load player history.' });
  }
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server);

// =======================================================================
// Socket.IO: realtime room lifecycle
// =======================================================================
io.on('connection', (socket) => {
  socket.on('create-room', async ({ playerId, playerName }, ack) => {
    try {
      if (!playerId || !playerName) {
        return ack({ ok: false, error: 'Missing player id or name.' });
      }
      await db.upsertPlayer(playerId, playerName).catch((err) => {
        console.error('[db] upsertPlayer failed', err);
      });

      const roomCode = generateRoomCode();
      const room = {
        roomCode,
        board: Array(9).fill(null),
        current: 'X',
        winner: null,
        winningLine: null,
        starter: 'X',
        players: {
          X: { id: playerId, name: playerName, socketId: socket.id, connected: true },
          O: null
        }
      };
      rooms.set(roomCode, room);

      socket.data.roomCode = roomCode;
      socket.data.symbol = 'X';
      socket.data.playerId = playerId;
      socket.join(roomCode);

      ack({ ok: true, roomCode, symbol: 'X', state: publicRoomState(room) });
    } catch (err) {
      console.error('[socket] create-room failed', err);
      ack({ ok: false, error: 'Server error creating room.' });
    }
  });

  socket.on('join-room', async ({ roomCode, playerId, playerName }, ack) => {
    try {
      const code = (roomCode || '').trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return ack({ ok: false, error: 'Room not found. Check the code and try again.' });
      if (room.players.O && room.players.O.id !== playerId) {
        return ack({ ok: false, error: 'That room is already full.' });
      }
      if (room.players.X && room.players.X.id === playerId) {
        return ack({ ok: false, error: "You can't join your own room." });
      }

      await db.upsertPlayer(playerId, playerName).catch((err) => {
        console.error('[db] upsertPlayer failed', err);
      });

      room.players.O = { id: playerId, name: playerName, socketId: socket.id, connected: true };

      socket.data.roomCode = code;
      socket.data.symbol = 'O';
      socket.data.playerId = playerId;
      socket.join(code);

      ack({ ok: true, roomCode: code, symbol: 'O', state: publicRoomState(room) });
      socket.to(code).emit('state-update', publicRoomState(room));
    } catch (err) {
      console.error('[socket] join-room failed', err);
      ack({ ok: false, error: 'Server error joining room.' });
    }
  });

  socket.on('make-move', async ({ roomCode, index }) => {
    const room = rooms.get(roomCode);
    if (!room || room.winner) return;
    if (typeof index !== 'number' || index < 0 || index > 8) return;
    if (room.board[index]) return;
    if (socket.data.symbol !== room.current) return; // not this player's turn
    if (!room.players.X || !room.players.O) return;  // need both players

    room.board[index] = room.current;
    const result = checkWinner(room.board);

    if (result) {
      room.winner = result.winner;
      room.winningLine = result.line;
    } else {
      room.current = otherSymbol(room.current);
    }

    emitRoomState(io, room);

    if (result) {
      try {
        await db.recordMatch({
          roomCode: room.roomCode,
          playerX: { id: room.players.X.id, name: room.players.X.name },
          playerO: { id: room.players.O.id, name: room.players.O.name },
          winner: result.winner
        });

        const [statsX, statsO] = await Promise.all([
          db.getPlayer(room.players.X.id),
          db.getPlayer(room.players.O.id)
        ]);
        if (statsX) io.to(room.players.X.socketId).emit('stats-update', statsX);
        if (statsO) io.to(room.players.O.socketId).emit('stats-update', statsO);
      } catch (err) {
        console.error('[db] Failed to record match result', err);
      }
    }
  });

  socket.on('rematch', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    room.starter = otherSymbol(room.starter);
    room.board = Array(9).fill(null);
    room.current = room.starter;
    room.winner = null;
    room.winningLine = null;
    emitRoomState(io, room);
  });

  socket.on('leave-room', ({ roomCode }) => {
    leaveRoom(socket, roomCode);
  });

  socket.on('disconnect', () => {
    if (socket.data.roomCode) {
      leaveRoom(socket, socket.data.roomCode);
    }
  });

  function leaveRoom(sock, roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    const symbol = sock.data.symbol;
    if (symbol && room.players[symbol] && room.players[symbol].socketId === sock.id) {
      room.players[symbol] = null;
      sock.to(roomCode).emit('opponent-left');
    }
    sock.leave(roomCode);
    removeEmptyRoom(roomCode);
  }
});

// =======================================================================
// Boot: ensure schema exists, then start listening
// =======================================================================
async function start() {
  try {
    await db.initSchema();
  } catch (err) {
    console.error('[db] Failed to initialize schema (check DATABASE_URL):', err.message);
    console.error('Online mode will not persist data until this is fixed. Continuing to serve local/AI play.');
  }

  server.listen(PORT, () => {
    console.log(`Tic-Tac-Toe server listening on http://localhost:${PORT}`);
  });
}

start();
