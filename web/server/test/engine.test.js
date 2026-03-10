import test from "node:test";
import assert from "node:assert/strict";
import { createInitialGame, placeBid, coincheAction, playCard, settleTrick } from "../src/engine/game.js";

function forceSimpleHands(g) {
  g.hands = [
    [{ id: "A♠", rank: "A", suit: "♠" }, { id: "7♥", rank: "7", suit: "♥" }],
    [{ id: "K♠", rank: "K", suit: "♠" }, { id: "8♦", rank: "8", suit: "♦" }],
    [{ id: "Q♠", rank: "Q", suit: "♠" }, { id: "9♣", rank: "9", suit: "♣" }],
    [{ id: "J♠", rank: "J", suit: "♠" }, { id: "10♥", rank: "10", suit: "♥" }],
  ];
}

test("bidding accepts valid increasing bids", () => {
  const g = createInitialGame();
  let r = placeBid(g, 0, { action: "bid", value: 100, suit: "♠" });
  assert.equal(r.ok, true);
  assert.equal(g.bidding.highestBid.value, 100);
  assert.equal(g.turnSeat, 1);

  r = placeBid(g, 1, { action: "bid", value: 110, suit: "♥" });
  assert.equal(r.ok, true);
  assert.equal(g.bidding.highestBid.value, 110);
  assert.equal(g.turnSeat, 2);
});

test("bidding rejects too-low bid", () => {
  const g = createInitialGame();
  placeBid(g, 0, { action: "bid", value: 100, suit: "♠" });
  const r = placeBid(g, 1, { action: "bid", value: 100, suit: "♥" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "BID_TOO_LOW");
});

test("3 passes after highest bid fixes contract and enters coinche", () => {
  const g = createInitialGame();
  placeBid(g, 0, { action: "bid", value: 100, suit: "♣" });
  placeBid(g, 1, { action: "pass" });
  placeBid(g, 2, { action: "pass" });
  const r = placeBid(g, 3, { action: "pass" });

  assert.equal(r.ok, true);
  assert.equal(g.phase, "coinche");
  assert.equal(g.contract.value, 100);
  assert.equal(g.trump, "♣");
});

test("coinche contree then surcontree sets multiplier x4 and enters play", () => {
  const g = createInitialGame();
  placeBid(g, 0, { action: "bid", value: 100, suit: "♣" });
  placeBid(g, 1, { action: "pass" });
  placeBid(g, 2, { action: "pass" });
  placeBid(g, 3, { action: "pass" });

  let r = coincheAction(g, g.turnSeat, { action: "contree" });
  assert.equal(r.ok, true);
  assert.equal(g.coinche.multiplier, 2);
  assert.equal(g.coinche.stage, "surcontree");

  r = coincheAction(g, g.turnSeat, { action: "surcontree" });
  assert.equal(r.ok, true);
  assert.equal(g.phase, "play");
  assert.equal(g.contract.multiplier, 4);
});

test("play enforces turn and legal card, resolves trick winner", () => {
  const g = createInitialGame();
  g.phase = "play";
  g.turnSeat = 0;
  g.trump = "♠";
  forceSimpleHands(g);

  let r = playCard(g, 1, "K♠");
  assert.equal(r.ok, false);
  assert.equal(r.error, "NOT_YOUR_TURN");

  r = playCard(g, 0, "A♠");
  assert.equal(r.ok, true);
  assert.equal(g.turnSeat, 1);

  playCard(g, 1, "K♠");
  playCard(g, 2, "Q♠");
  r = playCard(g, 3, "J♠");
  assert.equal(r.ok, true);
  assert.equal(r.trickCompleted, true);
  assert.equal(r.winnerSeat, 3);

  settleTrick(g, r.winnerSeat);
  assert.equal(g.trick.length, 0);
  assert.equal(g.turnSeat, 3);
});
