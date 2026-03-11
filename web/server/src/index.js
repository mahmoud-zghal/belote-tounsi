import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { nanoid } from "nanoid";
import {
  createInitialGame,
  placeBid,
  coincheAction,
  playCard,
  settleTrick,
  legalCardsForSeat,
  scoreRound,
} from "./engine/game.js";

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

const rooms = new Map();
const disconnectTimers = new Map();
const roomDestroyTimers = new Map();

const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS || 45_000);
const AUTO_PASS_ON_TIMEOUT = (process.env.AUTO_PASS_ON_TIMEOUT || "1") !== "0";
const LOBBY_IDLE_DESTROY_MS = Number(process.env.LOBBY_IDLE_DESTROY_MS || 15 * 60_000);
const FINISHED_DESTROY_MS = Number(process.env.FINISHED_DESTROY_MS || 90_000);

function makeRoomCode() {
  return nanoid(6).toUpperCase();
}

function roomPublic(room) {
  return {
    code: room.code,
    hostSeat: room.hostSeat,
    status: room.status,
    seats: room.seats.map((s) => (s ? { name: s.name, connected: s.connected } : null)),
    started: room.started,
    turnSeat: room.game?.turnSeat ?? null,
    trickCount: room.game?.trickCount ?? 0,
    scores: room.scores || [0, 0],
    winnerTeam: room.winnerTeam ?? null,
  };
}

function seatSocketIds(room) {
  return room.seats.map((s) => s?.socketId ?? null);
}

function emitRoomUpdate(room) {
  io.to(room.code).emit("room:update", roomPublic(room));
}

function emitGameState(room) {
  if (!room.game) return;
  const socketIds = seatSocketIds(room);
  for (let seat = 0; seat < 4; seat++) {
    const sid = socketIds[seat];
    if (!sid) continue;
    io.to(sid).emit("game:state", {
      yourSeat: seat,
      yourHand: room.game.hands[seat],
      handCounts: room.game.hands.map((h) => h.length),
      phase: room.game.phase,
      turnSeat: room.game.turnSeat,
      trick: room.game.trick,
      trickCount: room.game.trickCount,
      trump: room.game.trump,
      contract: room.game.contract,
      bidding: room.game.bidding,
      coinche: room.game.coinche,
      scores: room.scores || [0, 0],
      roundScore: room.game.roundScore || [0, 0],
      roundPoints: room.game.roundPoints || [0, 0],
      result: room.game.result || null,
      room: roomPublic(room),
    });
  }
}

function clearRoomDestroyTimer(code) {
  const t = roomDestroyTimers.get(code);
  if (t) {
    clearTimeout(t);
    roomDestroyTimers.delete(code);
  }
}

function destroyRoom(code, reason = "cleanup") {
  const room = rooms.get(code);
  if (!room) return;

  clearRoomDestroyTimer(code);
  for (let seat = 0; seat < 4; seat++) {
    clearDisconnectTimer(code, seat);
  }

  io.to(code).emit("room:closed", { reason });
  rooms.delete(code);
}

function scheduleRoomDestroy(room, ms, reason) {
  clearRoomDestroyTimer(room.code);
  const t = setTimeout(() => destroyRoom(room.code, reason), ms);
  roomDestroyTimers.set(room.code, t);
}

function markRoomActivity(room) {
  room.lastActivityAt = Date.now();
  if (room.status === "lobby") {
    scheduleRoomDestroy(room, LOBBY_IDLE_DESTROY_MS, "lobby-timeout");
  }
}

function createRoom(hostName, socketId) {
  const code = makeRoomCode();
  const room = {
    code,
    hostSeat: 0,
    status: "lobby",
    seats: [
      { id: nanoid(10), name: hostName || "Host", socketId, connected: true, token: nanoid(16) },
      null,
      null,
      null,
    ],
    started: false,
    game: null,
    scores: [0, 0],
    winnerTeam: null,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };
  rooms.set(code, room);
  scheduleRoomDestroy(room, LOBBY_IDLE_DESTROY_MS, "lobby-timeout");
  return room;
}

function joinSeat(room, name, socketId, requestedSeat = null) {
  let idx = -1;

  if (Number.isInteger(requestedSeat)) {
    if (requestedSeat < 1 || requestedSeat > 3) return -2;
    if (room.seats[requestedSeat]) return -3;
    idx = requestedSeat;
  } else {
    idx = room.seats.findIndex((s, i) => i !== 0 && !s);
  }

  if (idx === -1) return -1;
  room.seats[idx] = {
    id: nanoid(10),
    name: name || `Player ${idx + 1}`,
    socketId,
    connected: true,
    token: nanoid(16),
  };
  markRoomActivity(room);
  return idx;
}

function startGame(room) {
  room.game = createInitialGame();
  room.started = true;
  room.status = "in_game";
  markRoomActivity(room);
}

function recoverSeat(socket) {
  let { roomCode, seat } = socket.data || {};
  let room = rooms.get(roomCode);

  if ((seat === undefined || !room) && roomCode) {
    room = rooms.get(roomCode);
    if (room) {
      const recoveredSeat = room.seats.findIndex((s) => s?.socketId === socket.id);
      if (recoveredSeat !== -1) {
        seat = recoveredSeat;
        socket.data = { roomCode, seat };
      }
    }
  }

  if (room && seat !== undefined && room.seats[seat]?.socketId !== socket.id) {
    const recoveredSeat = room.seats.findIndex((s) => s?.socketId === socket.id);
    if (recoveredSeat !== -1) {
      seat = recoveredSeat;
      socket.data = { roomCode, seat };
    } else {
      seat = undefined;
    }
  }

  return { room, roomCode, seat };
}

function timerKey(roomCode, seat) {
  return `${roomCode}:${seat}`;
}

function clearDisconnectTimer(roomCode, seat) {
  const key = timerKey(roomCode, seat);
  const t = disconnectTimers.get(key);
  if (t) {
    clearTimeout(t);
    disconnectTimers.delete(key);
  }
}

function maybeFinishGame(room) {
  if (!room?.game || room.game.phase !== "play") return;
  const totalCards = room.game.hands.reduce((a, h) => a + h.length, 0);
  if (totalCards > 0) return;

  const { roundScore } = scoreRound(room.game);
  room.scores[0] += roundScore[0];
  room.scores[1] += roundScore[1];

  if (room.scores[0] >= 2000 || room.scores[1] >= 2000) {
    room.winnerTeam = room.scores[0] >= 2000 ? 0 : 1;
  }

  room.game.phase = "finished";
  room.status = "finished";
  room.started = false;
  io.to(room.code).emit("game:finished", { room: roomPublic(room), result: room.game.result, roundScore, totalScore: room.scores, winnerTeam: room.winnerTeam });
  scheduleRoomDestroy(room, FINISHED_DESTROY_MS, "finished-timeout");
}

function maybeApplyTimeoutAction(room, seat) {
  if (!AUTO_PASS_ON_TIMEOUT || !room?.started || !room.game) return;
  if (room.game.turnSeat !== seat) return;

  if (room.game.phase === "bidding") {
    const res = placeBid(room.game, seat, { action: "pass" });
    if (res.ok) {
      io.to(room.code).emit("game:bid-event", { seat, action: "pass", type: "auto-pass-timeout" });
    }
  } else if (room.game.phase === "coinche") {
    const res = coincheAction(room.game, seat, { action: "pass" });
    if (res.ok) {
      io.to(room.code).emit("game:coinche-event", {
        seat,
        action: "pass",
        type: "auto-pass-timeout",
        multiplier: room.game.coinche?.multiplier || room.game.contract?.multiplier || 1,
      });
    }
  } else if (room.game.phase === "play") {
    const legal = legalCardsForSeat(room.game, seat);
    if (!legal.length) return;
    const res = playCard(room.game, seat, legal[0].id);
    if (res.ok) {
      io.to(room.code).emit("game:card-played", { seat, card: res.card, auto: true });
      if (res.trickCompleted) {
        io.to(room.code).emit("game:trick-winner", { seat: res.winnerSeat, trickCount: room.game.trickCount });
        setTimeout(() => {
          settleTrick(room.game, res.winnerSeat, res.trickCards);
          maybeFinishGame(room);
          emitGameState(room);
          emitRoomUpdate(room);
        }, 1300);
      }
    }
  }

  markRoomActivity(room);
  emitGameState(room);
  emitRoomUpdate(room);
}

app.get("/health", (_, res) => res.json({ ok: true, rooms: rooms.size }));

io.on("connection", (socket) => {
  socket.on("room:create", ({ name }, cb) => {
    const room = createRoom(name, socket.id);
    socket.join(room.code);
    socket.data = { roomCode: room.code, seat: 0 };
    cb?.({ ok: true, room: roomPublic(room), seat: 0, token: room.seats[0].token });
    emitRoomUpdate(room);
  });

  socket.on("room:join", ({ code, name, seat: requestedSeat }, cb) => {
    const room = rooms.get((code || "").toUpperCase());
    if (!room) return cb?.({ ok: false, error: "ROOM_NOT_FOUND" });
    if (room.started || room.status === "in_game") return cb?.({ ok: false, error: "GAME_ALREADY_STARTED" });

    const seat = joinSeat(room, name, socket.id, Number.isInteger(requestedSeat) ? requestedSeat : null);
    if (seat === -1) return cb?.({ ok: false, error: "ROOM_FULL" });
    if (seat === -2) return cb?.({ ok: false, error: "BAD_SEAT" });
    if (seat === -3) return cb?.({ ok: false, error: "SEAT_TAKEN" });

    socket.join(room.code);
    socket.data = { roomCode: room.code, seat };
    cb?.({ ok: true, room: roomPublic(room), seat, token: room.seats[seat].token });
    emitRoomUpdate(room);
  });

  socket.on("room:reconnect", ({ code, token }, cb) => {
    const room = rooms.get((code || "").toUpperCase());
    if (!room) return cb?.({ ok: false, error: "ROOM_NOT_FOUND" });
    const seat = room.seats.findIndex((s) => s && s.token === token);
    if (seat === -1) return cb?.({ ok: false, error: "BAD_TOKEN" });

    room.seats[seat].socketId = socket.id;
    room.seats[seat].connected = true;
    socket.join(room.code);
    socket.data = { roomCode: room.code, seat };
    clearDisconnectTimer(room.code, seat);

    markRoomActivity(room);
    emitRoomUpdate(room);
    emitGameState(room);
    cb?.({ ok: true, seat, room: roomPublic(room), token: room.seats[seat].token });
  });

  socket.on("room:leave", (_, cb) => {
    const { room, roomCode, seat } = recoverSeat(socket);
    if (!room || seat === undefined) return cb?.({ ok: false, error: "NOT_IN_ROOM" });

    room.seats[seat] = null;
    socket.leave(roomCode);
    socket.data = {};

    if (room.seats.every((s) => !s)) {
      destroyRoom(room.code, "empty-room");
      return cb?.({ ok: true });
    }

    emitRoomUpdate(room);
    cb?.({ ok: true });
  });

  socket.on("game:start", (_, cb) => {
    const { roomCode, seat } = socket.data || {};
    const room = rooms.get(roomCode);
    if (!room) return cb?.({ ok: false, error: "ROOM_NOT_FOUND" });
    if (seat !== room.hostSeat) return cb?.({ ok: false, error: "HOST_ONLY" });
    if (room.seats.some((s) => !s)) return cb?.({ ok: false, error: "NEED_4_PLAYERS" });

    startGame(room);
    emitRoomUpdate(room);
    emitGameState(room);
    io.to(room.code).emit("game:started", { room: roomPublic(room) });
    cb?.({ ok: true });
  });

  socket.on("game:rematch", (_, cb) => {
    const { roomCode, seat } = socket.data || {};
    const room = rooms.get(roomCode);
    if (!room) return cb?.({ ok: false, error: "ROOM_NOT_FOUND" });
    if (seat !== room.hostSeat) return cb?.({ ok: false, error: "HOST_ONLY" });
    if (room.seats.some((s) => !s)) return cb?.({ ok: false, error: "NEED_4_PLAYERS" });
    if (room.status !== "finished") return cb?.({ ok: false, error: "REMATCH_NOT_AVAILABLE" });
    if (room.winnerTeam !== null) return cb?.({ ok: false, error: "MATCH_FINISHED_2000" });

    startGame(room);
    emitRoomUpdate(room);
    emitGameState(room);
    io.to(room.code).emit("game:started", { room: roomPublic(room), rematch: true });
    cb?.({ ok: true });
  });

  socket.on("game:bid-action", (payload, cb) => {
    const { room, seat } = recoverSeat(socket);
    if (seat === undefined) return cb?.({ ok: false, error: "NO_SEAT" });
    if (!room || !room.started) return cb?.({ ok: false, error: "NOT_IN_GAME" });

    const result = placeBid(room.game, seat, payload);
    if (!result.ok) return cb?.(result);

    markRoomActivity(room);
    io.to(room.code).emit("game:bid-event", { seat, ...payload, type: result.type });
    emitGameState(room);
    emitRoomUpdate(room);
    cb?.({ ok: true });
  });

  socket.on("game:coinche-action", (payload, cb) => {
    const { room, seat } = recoverSeat(socket);
    if (seat === undefined) return cb?.({ ok: false, error: "NO_SEAT" });
    if (!room || !room.started) return cb?.({ ok: false, error: "NOT_IN_GAME" });

    const result = coincheAction(room.game, seat, payload);
    if (!result.ok) return cb?.(result);

    markRoomActivity(room);
    io.to(room.code).emit("game:coinche-event", {
      seat,
      ...payload,
      type: result.type,
      multiplier: room.game.coinche?.multiplier || room.game.contract?.multiplier || 1,
    });
    emitGameState(room);
    emitRoomUpdate(room);
    cb?.({ ok: true });
  });

  socket.on("game:play-card", ({ cardId }, cb) => {
    const { room, seat } = recoverSeat(socket);
    if (seat === undefined) return cb?.({ ok: false, error: "NO_SEAT" });
    if (!room || !room.started) return cb?.({ ok: false, error: "NOT_IN_GAME" });

    const result = playCard(room.game, seat, cardId);
    if (!result.ok) return cb?.(result);

    markRoomActivity(room);
    io.to(room.code).emit("game:card-played", { seat, card: result.card });

    if (result.trickCompleted) {
      io.to(room.code).emit("game:trick-winner", { seat: result.winnerSeat, trickCount: room.game.trickCount });
      setTimeout(() => {
        settleTrick(room.game, result.winnerSeat, result.trickCards);
        maybeFinishGame(room);
        emitGameState(room);
        emitRoomUpdate(room);
      }, 1300);
    } else {
      emitGameState(room);
      emitRoomUpdate(room);
    }

    cb?.({ ok: true });
  });

  socket.on("disconnect", () => {
    const { roomCode, seat } = socket.data || {};
    const room = rooms.get(roomCode);
    if (!room || seat === undefined) return;

    if (room.seats[seat]) room.seats[seat].connected = false;
    emitRoomUpdate(room);

    clearDisconnectTimer(roomCode, seat);
    const t = setTimeout(() => {
      const currentRoom = rooms.get(roomCode);
      if (!currentRoom) return;
      const s = currentRoom.seats[seat];
      if (!s || s.connected) return;

      maybeApplyTimeoutAction(currentRoom, seat);

      const hasAnyConnected = currentRoom.seats.some((x) => x?.connected);
      if (!hasAnyConnected && currentRoom.status === "lobby") {
        scheduleRoomDestroy(currentRoom, 60_000, "all-disconnected-lobby");
      }
    }, RECONNECT_GRACE_MS);
    disconnectTimers.set(timerKey(roomCode, seat), t);
  });
});

const PORT = process.env.PORT || 8787;
httpServer.listen(PORT, () => console.log(`Belote server running on :${PORT}`));
