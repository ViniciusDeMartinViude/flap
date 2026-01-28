import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

// Fix for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve your files from /public
app.use(express.static(path.join(__dirname, "public")));

// Room storage
const rooms = new Map();

// Create or get a room
function getOrCreateRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, {
      players: new Map(),
      screens: new Set(),
    });
  }
  return rooms.get(code);
}

// Send updated leaderboard state
function broadcastRoomState(code) {
  const room = rooms.get(code);
  if (!room) return;

  const now = Date.now();
  const INACTIVE_LIMIT = 60 * 1000; // 60 seconds

  const players = [];

  for (const [id, p] of room.players.entries()) {

    // Remove or ignore inactive players
    if (!p.lastUpdate || (now - p.lastUpdate) > INACTIVE_LIMIT) {
      room.players.delete(id); // fully remove them
      console.log(`Player ${p.name} removed (inactive > 60s)`);
      continue;
    }

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

// Socket.IO
io.on("connection", (socket) => {
  console.log("✅ Connected:", socket.id);

  socket.data = {
    roomCode: null,
    isPlayer: false,
    isScreen: false,
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
      alive: true,
      lastUpdate: Date.now(),   // 👈 activity timestamp
    });

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.isPlayer = true;

    console.log("🧑 Player joined:", name, "→ room:", code);

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

    console.log("📺 Screen joined room:", code);

    cb?.({ ok: true });
    broadcastRoomState(code);
  });

  // ---- Player sends state ----
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

    player.lastUpdate = Date.now();  // 👈 update activity timestamp
    broadcastRoomState(code);
  });

  // ---- Player restart ----
  socket.on("player_restart", () => {
    const code = socket.data.roomCode;
    if (!code) return;

    const room = rooms.get(code);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    player.score = 0;
    player.alive = true;
    player.lastUpdate = Date.now();

    broadcastRoomState(code);
  });

  // ---- Periodic cleanup (every 10s) ----
  setInterval(() => {
    for (const code of rooms.keys()) {
      broadcastRoomState(code);
    }
  }, 10000);

  // ---- Disconnect ----
  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    if (!code) return;

    const room = rooms.get(code);
    if (!room) return;

    if (socket.data.isPlayer)
      room.players.delete(socket.id);

    if (socket.data.isScreen)
      room.screens.delete(socket.id);

    if (room.players.size === 0 && room.screens.size === 0) {
      rooms.delete(code);
      console.log("🧹 Room deleted (empty):", code);
    } else {
      broadcastRoomState(code);
    }

    console.log("❌ Disconnected:", socket.id);
  });
});

// Start server
const PORT = 3000;
server.listen(PORT, () => {
  console.log("🚀 Server running:");
  console.log(`👉 http://localhost:${PORT}/`);
});
