// server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import crypto from "crypto";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(process.cwd(), "public")));

const ARENA_CAPACITY = 8;

const rooms = new Map(); // roomCode -> { players: Map<socketId, player>, spectators: Set<socketId> }
function getOrCreateRoom(code) {
  if (!rooms.has(code)) rooms.set(code, { players: new Map(), spectators: new Set() });
  return rooms.get(code);
}

function makeRoomCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase(); // e.g., "A3F91B"
}

io.on("connection", (socket) => {
  let roomCode = null;

  socket.on("create_room", (_, cb) => {
    roomCode = makeRoomCode();
    getOrCreateRoom(roomCode);
    cb({ roomCode });
  });

  socket.on("join_as_player", ({ code, name }, cb) => {
    roomCode = code;
    const room = getOrCreateRoom(roomCode);
    if (room.players.size >= ARENA_CAPACITY) return cb({ ok: false, error: "Room full" });

    const slot = [...Array(ARENA_CAPACITY).keys()].find(
      i => ![...room.players.values()].some(p => p.slot === i)
    );

    const player = {
      id: socket.id,
      name: (name || "Player").slice(0, 16),
      slot,
      score: 0,
      alive: true,
      lastUpdate: Date.now()
    };

    room.players.set(socket.id, player);
    socket.join(roomCode);
    cb({ ok: true, slot });
    io.to(roomCode).emit("roster", serializeRoster(room));
  });

  socket.on("join_as_spectator", ({ code }, cb) => {
    roomCode = code;
    const room = getOrCreateRoom(roomCode);
    room.spectators.add(socket.id);
    socket.join(roomCode);
    cb({ ok: true, capacity: ARENA_CAPACITY });
    socket.emit("roster", serializeRoster(room));
  });

  // From clients: small, throttled state packets
  socket.on("player_state", ({ score, alive, frame }) => {
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p) return;

    p.score = Math.max(0, Math.floor(score || 0));
    p.alive = !!alive;
    p.lastUpdate = Date.now();

    // Echo minimal state to spectators only (players don't need others' exact physics)
    io.to(roomCode).emit("spectator_state", {
      id: socket.id,
      slot: p.slot,
      score: p.score,
      alive: p.alive,
      frame: frame || null
    });
  });

  socket.on("player_restart", () => {
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    const p = room?.players.get(socket.id);
    if (!p) return;
    p.alive = true;
    p.score = 0;
    io.to(roomCode).emit("roster", serializeRoster(room));
  });

  socket.on("disconnect", () => {
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    if (room.players.has(socket.id)) room.players.delete(socket.id);
    if (room.spectators.has(socket.id)) room.spectators.delete(socket.id);

    if (room.players.size === 0 && room.spectators.size === 0) {
      rooms.delete(roomCode);
    } else {
      io.to(roomCode).emit("roster", serializeRoster(room));
    }
  });
});

function serializeRoster(room) {
  return {
    capacity: ARENA_CAPACITY,
    players: [...room.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      slot: p.slot,
      score: p.score,
      alive: p.alive
    }))
  };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server listening on", PORT));
