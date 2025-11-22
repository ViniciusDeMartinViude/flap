const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve everything inside /public
app.use(express.static(path.join(__dirname, "public")));

// Rooms storage
const rooms = new Map();

function getOrCreateRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, {
      players: new Map(),
      screens: new Set(),
    });
  }
  return rooms.get(code);
}

function broadcastRoomState(code) {
  const room = rooms.get(code);
  if (!room) return;

  const players = [];
  for (const [id, p] of room.players.entries()) {
    players.push({
      id,
      name: p.name,
      score: p.score || 0,
      bestScore: p.bestScore || 0,
      alive: p.alive,
    });
  }

  io.to(code).emit("room_state", { code, players });
}

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.data = {
    roomCode: null,
    isPlayer: false,
    isScreen: false
  };

  // ---- Player joins ----
  socket.on("join_as_player", (data, cb) => {
    const code = (data.code || "").trim().toUpperCase();
    const name = (data.name || "").trim() || "Player";

    if (!code) return cb?.({ ok: false, error: "Room code required" });

    const room = getOrCreateRoom(code);

    room.players.set(socket.id, {
      name,
      score: 0,
      bestScore: 0,
      alive: true
    });

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.isPlayer = true;

    console.log("Player joined:", name, "room:", code);

    cb?.({ ok: true });
    broadcastRoomState(code);
  });

  // ---- Spectator joins ----
  socket.on("join_as_screen", (data, cb) => {
    const code = (data.code || "").trim().toUpperCase();
    if (!code) return cb?.({ ok: false, error: "Room code required" });

    const room = getOrCreateRoom(code);

    room.screens.add(socket.id);
    socket.join(code);

    socket.data.roomCode = code;
    socket.data.isScreen = true;

    console.log("Screen joined room:", code);

    cb?.({ ok: true });
    broadcastRoomState(code);
  });

  // ---- Player sends updates ----
  socket.on("player_state", (data) => {
    const code = socket.data.roomCode;
    if (!code) return;

    const room = rooms.get(code);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    if (typeof data.score === "number") {
      player.score = data.score;
      if (data.score > player.bestScore) {
        player.bestScore = data.score;
      }
    }

    if (typeof data.alive === "boolean") {
      player.alive = data.alive;
    }

    broadcastRoomState(code);
  });

  // ---- Player restarts ----
  socket.on("player_restart", () => {
    const code = socket.data.roomCode;
    if (!code) return;

    const room = rooms.get(code);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    player.score = 0;
    player.alive = true;

    broadcastRoomState(code);
  });

  // ---- Disconnect ----
  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    if (!code) return;

    const room = rooms.get(code);
    if (!room) return;

    if (socket.data.isPlayer) {
      room.players.delete(socket.id);
    }
    if (socket.data.isScreen) {
      room.screens.delete(socket.id);
    }

    if (room.players.size === 0 && room.screens.size === 0) {
      rooms.delete(code);
    } else {
      broadcastRoomState(code);
    }

    console.log("Disconnected:", socket.id);
  });
});

server.listen(3000, () => {
  console.log("🚀 Server running at:");
  console.log("👉 http://localhost:3000/");
});
