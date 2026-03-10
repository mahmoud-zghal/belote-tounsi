import { io as ioc } from "socket.io-client";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = Number(process.env.BELOTE_E2E_PORT || 8790);
const SERVER = process.env.BELOTE_SERVER_URL || `http://localhost:${PORT}`;
const TIMEOUT_MS = 8000;

function withTimeout(promise, label, ms = TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: ${label}`)), ms)),
  ]);
}

function connectClient(name) {
  const socket = ioc(SERVER, { transports: ["websocket"], timeout: TIMEOUT_MS, reconnection: false });
  socket.__state = null;
  socket.on("game:state", (gs) => { socket.__state = gs; });
  return withTimeout(new Promise((resolve, reject) => {
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
  }), `connect ${name}`);
}

function emitAck(socket, event, payload) {
  return withTimeout(new Promise((resolve) => {
    socket.emit(event, payload, (res) => resolve(res));
  }), `ack ${event}`);
}

function pickLegalCardFromState(gs) {
  const hand = gs?.yourHand || [];
  if (!hand.length) return null;
  const trick = gs?.trick || [];
  if (!trick.length) return hand[0];

  const leadSuit = trick[0].card.suit;
  const follow = hand.filter((c) => c.suit === leadSuit);
  if (!follow.length) return hand[0];

  if (leadSuit === gs?.trump) {
    const order = ["J", "9", "A", "10", "K", "Q", "8", "7"];
    const trumpsOnTable = trick.map((t) => t.card).filter((c) => c.suit === gs.trump);
    const highest = trumpsOnTable.sort((a, b) => order.indexOf(a.rank) - order.indexOf(b.rank))[0];
    const rising = follow.filter((c) => order.indexOf(c.rank) < order.indexOf(highest.rank));
    if (rising.length) return rising[0];
  }

  return follow[0];
}

function waitForState(socket, predicate, label) {
  return withTimeout(new Promise((resolve) => {
    const check = () => {
      if (socket.__state && predicate(socket.__state)) return resolve(socket.__state);
      setTimeout(check, 50);
    };
    check();
  }), `state ${label}`);
}

async function startServer() {
  const child = spawn("node", ["src/index.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await withTimeout(new Promise((resolve, reject) => {
    child.stdout.on("data", (buf) => {
      const t = buf.toString();
      if (t.includes("Belote server running")) resolve();
    });
    child.stderr.on("data", (buf) => {
      const t = buf.toString();
      if (t.toLowerCase().includes("error") || t.includes("EADDRINUSE")) reject(new Error(t));
    });
    child.on("exit", (code) => reject(new Error(`Server exited early (${code})`)));
  }), "server start", 12000);

  return child;
}

async function run() {
  const sockets = [];
  let server;
  try {
    server = await startServer();

    const s0 = await connectClient("seat1");
    const s1 = await connectClient("seat2");
    const s2 = await connectClient("seat3");
    const s3 = await connectClient("seat4");
    sockets.push(s0, s1, s2, s3);

    const c0 = await emitAck(s0, "room:create", { name: "E2E-S1" });
    assert.equal(c0?.ok, true, `room:create failed: ${JSON.stringify(c0)}`);
    const code = c0.room.code;

    const j1 = await emitAck(s1, "room:join", { code, name: "E2E-S2", seat: 1 });
    const j2 = await emitAck(s2, "room:join", { code, name: "E2E-S3", seat: 2 });
    const j3 = await emitAck(s3, "room:join", { code, name: "E2E-S4", seat: 3 });
    assert.equal(j1?.ok, true);
    assert.equal(j2?.ok, true);
    assert.equal(j3?.ok, true);

    const start = await emitAck(s0, "game:start", {});
    assert.equal(start?.ok, true, `game:start failed: ${JSON.stringify(start)}`);

    await Promise.all([
      waitForState(s0, (gs) => gs.phase === "bidding", "bidding s0"),
      waitForState(s1, (gs) => gs.phase === "bidding", "bidding s1"),
      waitForState(s2, (gs) => gs.phase === "bidding", "bidding s2"),
      waitForState(s3, (gs) => gs.phase === "bidding", "bidding s3"),
    ]);

    // Force deterministic bidding path to contract-fixed -> coinche
    const b0 = await emitAck(s0, "game:bid-action", { action: "bid", value: 100, suit: "♠" });
    const b1 = await emitAck(s1, "game:bid-action", { action: "bid", value: 110, suit: "♥" });
    const b2 = await emitAck(s2, "game:bid-action", { action: "bid", value: 120, suit: "♣" });
    const p3 = await emitAck(s3, "game:bid-action", { action: "pass" });
    const p0 = await emitAck(s0, "game:bid-action", { action: "pass" });
    const p1 = await emitAck(s1, "game:bid-action", { action: "pass" });

    [b0, b1, b2, p3, p0, p1].forEach((r, i) => assert.equal(r?.ok, true, `bid step ${i} failed: ${JSON.stringify(r)}`));

    const coincheState = await waitForState(s0, (gs) => gs.phase === "coinche", "enter coinche");
    assert.equal(coincheState.coinche?.stage, "contree");

    // Follow turnSeat for contree/surcontree
    const seatSockets = [s0, s1, s2, s3];
    let actor = coincheState.turnSeat;
    const c1 = await emitAck(seatSockets[actor], "game:coinche-action", { action: "contree" });
    assert.equal(c1?.ok, true, `contree failed: ${JSON.stringify(c1)}`);

    const surState = await waitForState(s0, (gs) => gs.phase === "coinche" && gs.coinche?.stage === "surcontree", "surcontree stage");
    actor = surState.turnSeat;
    const c2 = await emitAck(seatSockets[actor], "game:coinche-action", { action: "surcontree" });
    assert.equal(c2?.ok, true, `surcontree failed: ${JSON.stringify(c2)}`);

    const playState = await waitForState(s0, (gs) => gs.phase === "play", "enter play");
    assert.equal(playState.contract?.multiplier, 4);

    // Play 4 legal cards for one trick
    let current = playState;
    for (let i = 0; i < 4; i++) {
      const seat = current.turnSeat;
      const sock = seatSockets[seat];
      const hand = current.yourSeat === seat ? current.yourHand : null;

      // Pull fresh state from actor seat if needed
      let actorState = current;
      if (!hand) {
        actorState = await waitForState(sock, (gs) => gs.phase === "play" && gs.turnSeat === seat, `actor state seat ${seat}`);
      }

      const legal = pickLegalCardFromState(actorState);
      const cardId = legal?.id;
      assert.ok(cardId, `seat ${seat} has no legal card to play`);
      const pr = await emitAck(sock, "game:play-card", { cardId });
      assert.equal(pr?.ok, true, `play failed at seat ${seat}: ${JSON.stringify(pr)}`);

      // next local state from seat0 stream
      current = await waitForState(s0, (gs) => gs.phase === "play", `post-play ${i}`);
    }

    console.log("E2E socket test passed ✅");
  } finally {
    sockets.forEach((s) => s?.disconnect());
    if (server && !server.killed) server.kill("SIGTERM");
  }
}

run().catch((err) => {
  console.error("E2E socket test failed ❌", err);
  process.exit(1);
});
