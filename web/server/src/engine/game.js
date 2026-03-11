export const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["7", "8", "9", "J", "Q", "K", "10", "A"];

const TRUMP_ORDER = ["J", "9", "A", "10", "K", "Q", "8", "7"];
const NON_TRUMP_ORDER = ["A", "10", "K", "Q", "J", "9", "8", "7"];

const TRUMP_POINTS = { J: 20, 9: 14, A: 11, "10": 10, K: 4, Q: 3, 8: 0, 7: 0 };
const NON_TRUMP_POINTS = { A: 11, "10": 10, K: 4, Q: 3, J: 2, 9: 0, 8: 0, 7: 0 };

export function teamOf(seat) {
  return seat % 2;
}

export function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ suit: s, rank: r, id: `${r}${s}` });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function createInitialGame() {
  const deck = makeDeck();
  const hands = [[], [], [], []];
  for (let i = 0; i < 8; i++) for (let p = 0; p < 4; p++) hands[p].push(deck.pop());
  return {
    phase: "bidding",
    hands,
    turnSeat: 0,
    trick: [],
    trickCount: 0,
    trump: null,
    contract: null,
    bidding: {
      currentSeat: 0,
      highestBid: null,
      passesAfterBid: 0,
      allPassCount: 0,
    },
    coinche: null,
    trickHistory: [],
    roundPoints: [0, 0],
    roundScore: [0, 0],
    result: null,
  };
}

function trumpBeats(a, b) {
  return TRUMP_ORDER.indexOf(a.rank) < TRUMP_ORDER.indexOf(b.rank);
}

export function legalCardsForSeat(g, seat) {
  const hand = g.hands[seat];
  if (!g.trick.length) return hand;

  const leadSuit = g.trick[0].card.suit;
  const follow = hand.filter((c) => c.suit === leadSuit);
  if (!follow.length) return hand;

  if (leadSuit === g.trump) {
    const trumpsOnTable = g.trick.map((t) => t.card).filter((c) => c.suit === g.trump);
    const highestTrump = trumpsOnTable.sort((a, b) => TRUMP_ORDER.indexOf(a.rank) - TRUMP_ORDER.indexOf(b.rank))[0];
    const rising = follow.filter((c) => trumpBeats(c, highestTrump));
    if (rising.length) return rising;
  }

  return follow;
}

function cardBeats(a, b, leadSuit, trump) {
  const aTrump = a.suit === trump;
  const bTrump = b.suit === trump;

  if (aTrump && !bTrump) return true;
  if (!aTrump && bTrump) return false;

  if (aTrump && bTrump) {
    return TRUMP_ORDER.indexOf(a.rank) < TRUMP_ORDER.indexOf(b.rank);
  }

  const aLead = a.suit === leadSuit;
  const bLead = b.suit === leadSuit;

  if (aLead && !bLead) return true;
  if (!aLead && bLead) return false;

  if (a.suit !== b.suit) return false;
  return NON_TRUMP_ORDER.indexOf(a.rank) < NON_TRUMP_ORDER.indexOf(b.rank);
}

function trickWinnerSeat(g) {
  const leadSuit = g.trick[0].card.suit;
  let winner = g.trick[0];
  for (let i = 1; i < g.trick.length; i++) {
    const cur = g.trick[i];
    if (cardBeats(cur.card, winner.card, leadSuit, g.trump)) winner = cur;
  }
  return winner.seat;
}

function advanceBidTurn(g) {
  g.bidding.currentSeat = (g.bidding.currentSeat + 1) % 4;
  g.turnSeat = g.bidding.currentSeat;
}

export function placeBid(game, seat, payload) {
  const g = game;
  if (!g || g.phase !== "bidding") return { ok: false, error: "NOT_BIDDING" };
  if (g.bidding.currentSeat !== seat) return { ok: false, error: "NOT_YOUR_TURN" };

  const action = payload?.action;
  if (action === "pass") {
    if (g.bidding.highestBid) g.bidding.passesAfterBid += 1;
    g.bidding.allPassCount += 1;

    if (!g.bidding.highestBid && g.bidding.allPassCount >= 4) {
      const deck = makeDeck();
      g.hands = [[], [], [], []];
      for (let i = 0; i < 8; i++) for (let p = 0; p < 4; p++) g.hands[p].push(deck.pop());
      g.bidding.currentSeat = (g.bidding.currentSeat + 1) % 4;
      g.turnSeat = g.bidding.currentSeat;
      g.bidding.allPassCount = 0;
      return { ok: true, type: "redeal" };
    }

    if (g.bidding.highestBid && g.bidding.passesAfterBid >= 3) {
      g.contract = g.bidding.highestBid;
      g.trump = g.contract.suit;

      if (g.contract.kabbout) {
        g.phase = "play";
        g.turnSeat = g.contract.by;
      } else {
        const takerTeam = teamOf(g.contract.by);
        const defenders = [0, 1, 2, 3].filter((s) => teamOf(s) !== takerTeam);
        g.phase = "coinche";
        g.coinche = {
          stage: "contree",
          takerTeam,
          defenders,
          takers: [0, 1, 2, 3].filter((s) => teamOf(s) === takerTeam),
          idx: 0,
          multiplier: 1,
        };
        g.turnSeat = defenders[0];
      }

      return { ok: true, type: "contract-fixed" };
    }

    advanceBidTurn(g);
    return { ok: true, type: "pass" };
  }

  if (action === "bid") {
    const value = Number(payload?.value);
    const suit = payload?.suit;
    if (!SUITS.includes(suit)) return { ok: false, error: "BAD_SUIT" };
    if (!Number.isFinite(value) || value < 90 || value > 160 || value % 10 !== 0) return { ok: false, error: "BAD_BID" };

    const min = g.bidding.highestBid ? g.bidding.highestBid.value + 10 : 90;
    if (value < min) return { ok: false, error: "BID_TOO_LOW" };

    g.bidding.highestBid = { value, suit, by: seat, kabbout: false };
    g.bidding.passesAfterBid = 0;
    g.bidding.allPassCount = 0;
    advanceBidTurn(g);
    return { ok: true, type: "bid" };
  }

  if (action === "kabbout") {
    const suit = payload?.suit;
    if (!SUITS.includes(suit)) return { ok: false, error: "BAD_SUIT" };
    g.bidding.highestBid = { value: 500, suit, by: seat, kabbout: true };
    g.contract = g.bidding.highestBid;
    g.trump = suit;
    g.phase = "play";
    g.turnSeat = seat;
    return { ok: true, type: "kabbout" };
  }

  return { ok: false, error: "UNKNOWN_ACTION" };
}

export function coincheAction(game, seat, payload) {
  const g = game;
  if (!g || g.phase !== "coinche" || !g.coinche) return { ok: false, error: "NOT_COINCHE_PHASE" };
  if (g.turnSeat !== seat) return { ok: false, error: "NOT_YOUR_TURN" };

  const action = payload?.action;
  const c = g.coinche;

  if (c.stage === "contree") {
    if (!c.defenders.includes(seat)) return { ok: false, error: "NOT_DEFENDER" };

    if (action === "contree") {
      c.multiplier = 2;
      c.stage = "surcontree";
      c.idx = 0;
      g.turnSeat = c.takers[0];
      return { ok: true, type: "contree" };
    }

    c.idx += 1;
    if (c.idx >= c.defenders.length) {
      g.phase = "play";
      g.turnSeat = g.contract.by;
      g.contract.multiplier = c.multiplier;
      return { ok: true, type: "coinche-end-no-contree" };
    }
    g.turnSeat = c.defenders[c.idx];
    return { ok: true, type: "contree-pass" };
  }

  if (c.stage === "surcontree") {
    if (!c.takers.includes(seat)) return { ok: false, error: "NOT_TAKER" };

    if (action === "surcontree") {
      c.multiplier = 4;
      g.phase = "play";
      g.turnSeat = g.contract.by;
      g.contract.multiplier = c.multiplier;
      return { ok: true, type: "surcontree" };
    }

    c.idx += 1;
    if (c.idx >= c.takers.length) {
      g.phase = "play";
      g.turnSeat = g.contract.by;
      g.contract.multiplier = c.multiplier;
      return { ok: true, type: "coinche-end-no-sur" };
    }
    g.turnSeat = c.takers[c.idx];
    return { ok: true, type: "surcontree-pass" };
  }

  return { ok: false, error: "BAD_COINCHE_STAGE" };
}

export function playCard(game, seat, cardId) {
  const g = game;
  if (!g) return { ok: false, error: "NO_GAME" };
  if (g.phase !== "play") return { ok: false, error: "NOT_PLAY_PHASE" };
  if (g.turnSeat !== seat) return { ok: false, error: "NOT_YOUR_TURN" };

  const hand = g.hands[seat];
  const idx = hand.findIndex((c) => c.id === cardId);
  if (idx === -1) return { ok: false, error: "CARD_NOT_IN_HAND" };

  const legal = legalCardsForSeat(g, seat);
  const selected = hand[idx];
  const isLegal = legal.some((c) => c.id === selected.id);
  if (!isLegal) return { ok: false, error: "ILLEGAL_MOVE" };

  const [card] = hand.splice(idx, 1);
  g.trick.push({ seat, card });

  if (g.trick.length === 4) {
    g.trickCount += 1;
    const winnerSeat = trickWinnerSeat(g);
    return { ok: true, card, trickCompleted: true, winnerSeat, trickCards: [...g.trick] };
  }

  g.turnSeat = (seat + 1) % 4;
  return { ok: true, card, trickCompleted: false };
}

export function settleTrick(game, winnerSeat, trickCards = null) {
  const cards = trickCards || [...game.trick];
  game.trickHistory.push({ winnerSeat, cards });
  game.trick = [];
  game.turnSeat = winnerSeat;
}

function cardPoints(card, trump) {
  return card.suit === trump ? (TRUMP_POINTS[card.rank] ?? 0) : (NON_TRUMP_POINTS[card.rank] ?? 0);
}

function roundOppPoints(rawOpp, rawContract) {
  if (rawOpp >= 21 && rawOpp <= 24) return { opp: 20, contractBonus: 0 };
  if (rawOpp >= 25 && rawOpp <= 27) return { opp: 30, contractBonus: 10 };
  if (rawOpp >= 28 && rawOpp <= 29) return { opp: 30, contractBonus: 0 };

  const rounded = Math.max(0, Math.min(160, Math.round(rawOpp / 10) * 10));
  const contractRounded = Math.max(0, Math.min(160, Math.round(rawContract / 10) * 10));
  if (rounded + contractRounded !== 160) {
    return { opp: rounded, contractBonus: Math.max(0, 160 - rounded - contractRounded) };
  }
  return { opp: rounded, contractBonus: 0 };
}

export function scoreRound(game) {
  if (!game?.contract) return { roundScore: [0, 0], roundPoints: [0, 0], contractMade: false };

  const trickPoints = [0, 0];
  for (const t of game.trickHistory) {
    const team = teamOf(t.winnerSeat);
    for (const play of t.cards) trickPoints[team] += cardPoints(play.card, game.trump);
  }

  if (game.trickHistory.length) {
    const lastWinnerTeam = teamOf(game.trickHistory[game.trickHistory.length - 1].winnerSeat);
    trickPoints[lastWinnerTeam] += 10;
  }

  const total = Math.max(1, trickPoints[0] + trickPoints[1]);
  const normalized = [
    Math.round((trickPoints[0] * 160) / total),
    160 - Math.round((trickPoints[0] * 160) / total),
  ];

  const contractTeam = teamOf(game.contract.by);
  const oppTeam = 1 - contractTeam;
  const contractValue = game.contract.value;
  const multiplier = game.contract.multiplier || 1;

  const contractMade = normalized[contractTeam] >= contractValue;
  const roundScore = [0, 0];

  if (!contractMade) {
    roundScore[oppTeam] = 160 * multiplier;
  } else {
    const rounded = roundOppPoints(normalized[oppTeam], normalized[contractTeam]);
    const oppScore = Math.max(0, Math.min(160, rounded.opp));
    const contractScore = Math.max(0, 160 - oppScore + rounded.contractBonus);

    roundScore[oppTeam] = oppScore * multiplier;
    roundScore[contractTeam] = contractScore * multiplier;
  }

  game.roundPoints = normalized;
  game.roundScore = roundScore;
  game.result = {
    contractTeam,
    oppTeam,
    contractMade,
    contractValue,
    multiplier,
  };

  return { roundScore, roundPoints: normalized, contractMade };
}
