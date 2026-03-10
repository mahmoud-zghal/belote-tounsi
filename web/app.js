const SUITS = ["♠", "♥", "♦", "♣"];
const SUIT_CODE = { "♠": "S", "♥": "H", "♦": "D", "♣": "C" };
const RANK_LABEL = { J: "V", Q: "D", K: "R", A: "A", "10": "10", 9: "9", 8: "8", 7: "7" };
const NON_TRUMP_ORDER = ["A", "10", "K", "Q", "J", "9", "8", "7"];
const TRUMP_ORDER = ["J", "9", "A", "10", "K", "Q", "8", "7"];

const state = {
  players: [[], [], [], []],
  names: ["You", "Player 2", "Player 3", "Player 4"],
  scores: [0, 0],
  trick: [],
  trickNo: 1,
  trump: null,
  contract: null,
  multiplier: 1,
  phase: "lobby",
  currentPlayer: null,
  leader: null,
  lastMpBidPromptKey: null,
};

const el = {
  p0: document.getElementById("p0"),
  p1: document.getElementById("p1"),
  p2: document.getElementById("p2"),
  p3: document.getElementById("p3"),
  trick: document.getElementById("trick"),
  controls: document.getElementById("controls"),
  phase: document.getElementById("phase"),
  log: document.getElementById("log"),
  scoreboard: document.getElementById("scoreboard"),
  guide: document.getElementById("guide"),
  modal: document.getElementById("modal"),
  modalTitle: document.getElementById("modal-title"),
  modalSub: document.getElementById("modal-sub"),
  modalContent: document.getElementById("modal-content"),
  modalClose: document.getElementById("modal-close"),
};

function suitColorClass(s) {
  return s === "♥" || s === "♦" ? "suit-red" : "suit-black";
}

function cardText(c) {
  return `${RANK_LABEL[c.rank] ?? c.rank}${c.suit}`;
}

function cardCode(c) {
  return `${c.rank}${SUIT_CODE[c.suit]}`;
}

function renderCardFace(c) {
  return `<img class="card-face" src="assets/cards/${cardCode(c)}.svg" alt="${cardText(c)}" />`;
}

function openModal(title, sub = "") {
  el.modalTitle.textContent = title;
  el.modalSub.textContent = sub;
  el.modal.classList.remove("hidden");
  el.modal.setAttribute("aria-hidden", "false");
  el.modalContent.innerHTML = "";
}

function closeModal() {
  el.modal.classList.add("hidden");
  el.modal.setAttribute("aria-hidden", "true");
}

el.modalClose.onclick = closeModal;
el.modal.onclick = (e) => {
  if (e.target === el.modal) closeModal();
};

function sortHandForDisplay(hand, trump = null) {
  const bySuit = {
    "♠": hand.filter((c) => c.suit === "♠"),
    "♥": hand.filter((c) => c.suit === "♥"),
    "♦": hand.filter((c) => c.suit === "♦"),
    "♣": hand.filter((c) => c.suit === "♣"),
  };

  for (const s of SUITS) {
    const order = s === trump ? TRUMP_ORDER : NON_TRUMP_ORDER;
    bySuit[s].sort((a, b) => order.indexOf(a.rank) - order.indexOf(b.rank));
  }

  const blacks = ["♠", "♣"].filter((s) => bySuit[s].length);
  const reds = ["♥", "♦"].filter((s) => bySuit[s].length);

  const suitOrder = [];
  let next = blacks.length >= reds.length ? "black" : "red";
  while (blacks.length || reds.length) {
    if (next === "black") {
      if (blacks.length) suitOrder.push(blacks.shift());
      else if (reds.length) suitOrder.push(reds.shift());
      next = "red";
    } else {
      if (reds.length) suitOrder.push(reds.shift());
      else if (blacks.length) suitOrder.push(blacks.shift());
      next = "black";
    }
  }

  return suitOrder.map((s) => ({ suit: s, cards: bySuit[s] }));
}

function getSeatNames() {
  const seats = window.__mp?.room?.seats || [];
  return [0, 1, 2, 3].map((i) => seats[i]?.name || `Player ${i + 1}`);
}

function renderGuide() {
  const seatNames = getSeatNames();
  const turnName = Number.isInteger(state.currentPlayer) ? seatNames[state.currentPlayer] : "-";
  const contract = state.contract
    ? `${state.contract.kabbout ? "Kabbout" : `${state.contract.value} ${state.trump}`} x${state.multiplier || 1}`
    : "not set";

  el.guide.innerHTML = [
    `Turn: <strong>${turnName}</strong>`,
    `Contract: <strong>${contract}</strong>`,
    `Phase: <strong>${state.phase}</strong>`,
  ].join(" • ");
}

function renderScoreboard() {
  const n = getSeatNames();
  state.names = n;
  el.scoreboard.textContent = `${n[0]} + ${n[2]}: ${state.scores[0]} | ${n[1]} + ${n[3]}: ${state.scores[1]}`;
}

function renderPlayers() {
  const n = state.names;
  const back = `<img class="card-back" src="assets/cards/back.svg" alt="back" />`;

  el.p1.innerHTML = `<strong>${n[1]}</strong><div>${state.players[1].length} cards</div><div class="backs">${back}</div>`;
  el.p2.innerHTML = `<strong>${n[2]}</strong><div>${state.players[2].length} cards</div><div class="backs">${back}</div>`;
  el.p3.innerHTML = `<strong>${n[3]}</strong><div>${state.players[3].length} cards</div><div class="backs">${back}</div>`;

  const groups = sortHandForDisplay(state.players[0], state.trump);
  const handHtml = groups
    .map((g, gi) => {
      const cards = g.cards
        .map((c, ci) => `<button class="card" data-idx="${c.__idx}">${renderCardFace(c)}</button>${ci < g.cards.length - 1 ? "" : ""}`)
        .join("");

      const divider = gi < groups.length - 1
        ? `<div class="suit-divider ${suitColorClass(g.suit)}" aria-hidden="true"></div>`
        : "";

      return `<div class="suit-group ${suitColorClass(g.suit)}"><div class="suit-label">${g.suit}</div><div class="hand">${cards}</div>${divider}</div>`;
    })
    .join("");

  el.p0.innerHTML = `<strong>${n[0]}</strong><div class="hand-groups">${handHtml || '<div class="muted">No cards</div>'}</div>`;
}

function renderTrick() {
  el.trick.innerHTML = `<div><strong>Trick ${Math.min(state.trickNo, 8)}</strong> <span class="tag">Trump: ${state.trump ?? "?"}</span></div>` +
    state.trick.map((t) => `<div class="played-wrap"><div class="played-name">${state.names[t.player]}</div><div class="played">${renderCardFace(t.card)}</div></div>`).join("");
}

function renderPlayControls() {
  const gs = window.__mp?.state;
  const yourTurn = gs && gs.turnSeat === gs.yourSeat;
  const cardButtons = [...document.querySelectorAll("#p0 .card")];

  cardButtons.forEach((b) => {
    const idx = Number(b.dataset.idx);
    const c = state.players[0][idx];
    b.disabled = !yourTurn;
    b.onclick = () => {
      if (!yourTurn || !c) return;
      window.__mp?.socket?.emit("game:play-card", { cardId: c.id });
    };
  });
}

function render() {
  renderScoreboard();
  renderPlayers();
  renderTrick();
  renderGuide();
  el.phase.textContent = `Phase: ${state.phase}`;
  el.controls.innerHTML = "";
  el.log.innerHTML = "";

  if (state.phase === "play") renderPlayControls();
}

function showMultiplayerCoincheModal(gs) {
  const c = gs?.coinche || {};
  const isContreeStage = c.stage === "contree";
  openModal(isContreeStage ? "Contree Decision" : "Surcontree Decision", `Multiplier x${c.multiplier || 1}`);

  const wrap = document.createElement("div");
  wrap.className = "suit-row";

  const passBtn = document.createElement("button");
  passBtn.className = "action";
  passBtn.textContent = isContreeStage ? "No Contree" : "No Surcontree";
  passBtn.onclick = () => {
    window.__mp?.socket?.emit("game:coinche-action", { action: "pass" }, (res) => {
      if (res?.ok) closeModal();
      else window.__mp?.setStatus?.(`Coinche error: ${res?.error || "unknown"}`);
    });
  };

  const yesBtn = document.createElement("button");
  yesBtn.className = "action";
  yesBtn.textContent = isContreeStage ? "Contree x2" : "Surcontree x4";
  yesBtn.onclick = () => {
    window.__mp?.socket?.emit("game:coinche-action", { action: isContreeStage ? "contree" : "surcontree" }, (res) => {
      if (res?.ok) closeModal();
      else window.__mp?.setStatus?.(`Coinche error: ${res?.error || "unknown"}`);
    });
  };

  wrap.append(passBtn, yesBtn);
  el.modalContent.appendChild(wrap);
}

function showMultiplayerBidModal(gs) {
  const bState = gs?.bidding || {};
  const high = bState.highestBid;
  openModal("Your Bid", `Current high: ${high ? `${high.value} ${high.suit}` : "none"}`);

  const minBid = high ? high.value + 10 : 90;
  const maxBid = 160;

  const wrap = document.createElement("div");
  wrap.className = "bid-builder";

  const suitLabel = document.createElement("div");
  suitLabel.textContent = "Choose trump suit:";
  wrap.appendChild(suitLabel);

  const suitRow = document.createElement("div");
  suitRow.className = "suit-row";
  let selectedSuit = high?.suit || "♠";
  const picked = document.createElement("div");
  picked.className = "bid-value";
  picked.textContent = `Picked suit: ${selectedSuit}`;

  SUITS.forEach((s, i) => {
    const b = document.createElement("button");
    b.className = `action suit-btn ${(selectedSuit === s || (!selectedSuit && i === 0)) ? "active" : ""}`;
    b.textContent = s;
    b.onclick = () => {
      selectedSuit = s;
      picked.textContent = `Picked suit: ${selectedSuit}`;
      [...suitRow.querySelectorAll(".suit-btn")].forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
    };
    suitRow.appendChild(b);
  });
  wrap.appendChild(suitRow);
  wrap.appendChild(picked);

  const sliderWrap = document.createElement("div");
  sliderWrap.className = "bid-slider-wrap";
  sliderWrap.innerHTML = `<div>Choose bid value: <span class="bid-value" id="bid-val">${Math.min(minBid, maxBid)}</span></div>`;
  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "bid-slider";
  slider.min = String(Math.min(minBid, maxBid));
  slider.max = String(maxBid);
  slider.step = "10";
  slider.value = String(Math.min(minBid, maxBid));
  slider.oninput = () => {
    sliderWrap.querySelector("#bid-val").textContent = slider.value;
  };
  sliderWrap.appendChild(slider);
  wrap.appendChild(sliderWrap);

  const actionRow = document.createElement("div");
  actionRow.className = "suit-row";

  const passBtn = document.createElement("button");
  passBtn.className = "action";
  passBtn.textContent = "Pass";
  passBtn.onclick = () => {
    window.__mp?.socket?.emit("game:bid-action", { action: "pass" }, (res) => {
      if (res?.ok) closeModal();
      else window.__mp?.setStatus?.(`Bid error: ${res?.error || "unknown"}`);
    });
  };

  const bidBtn = document.createElement("button");
  bidBtn.className = "action";
  bidBtn.textContent = "Confirm Bid";
  bidBtn.disabled = minBid > maxBid;
  bidBtn.onclick = () => {
    window.__mp?.socket?.emit("game:bid-action", {
      action: "bid",
      value: Number(slider.value),
      suit: selectedSuit,
    }, (res) => {
      if (res?.ok) closeModal();
      else window.__mp?.setStatus?.(`Bid error: ${res?.error || "unknown"}`);
    });
  };

  const kabBtn = document.createElement("button");
  kabBtn.className = "action";
  kabBtn.textContent = "Kabbout";
  kabBtn.onclick = () => {
    window.__mp?.socket?.emit("game:bid-action", { action: "kabbout", suit: selectedSuit }, (res) => {
      if (res?.ok) closeModal();
      else window.__mp?.setStatus?.(`Bid error: ${res?.error || "unknown"}`);
    });
  };

  actionRow.append(passBtn, bidBtn, kabBtn);
  wrap.appendChild(actionRow);
  el.modalContent.appendChild(wrap);
}

window.syncFromMultiplayer = function syncFromMultiplayer(gs) {
  state.phase = gs.phase || "bidding";
  state.trump = gs.trump || null;
  state.contract = gs.contract || null;
  state.multiplier = gs.contract?.multiplier || state.multiplier || 1;
  state.currentPlayer = gs.turnSeat;
  state.leader = gs.turnSeat;
  state.trickNo = (gs.trickCount || 0) + 1;
  state.trick = (gs.trick || []).map((t) => ({ player: t.seat, card: t.card }));
  state.scores = gs.scores || state.scores;

  state.players[0] = [...(gs.yourHand || [])].map((c, i) => ({ ...c, __idx: i }));
  state.players[1] = new Array(gs.handCounts?.[1] || 0).fill({ suit: "♣", rank: "7", id: "x" });
  state.players[2] = new Array(gs.handCounts?.[2] || 0).fill({ suit: "♣", rank: "7", id: "x" });
  state.players[3] = new Array(gs.handCounts?.[3] || 0).fill({ suit: "♣", rank: "7", id: "x" });

  render();

  if (state.phase === "play") {
    closeModal();
    state.lastMpBidPromptKey = null;
    return;
  }

  if (state.phase === "coinche") {
    const c = gs.coinche || {};
    const myTurn = gs.turnSeat === gs.yourSeat;
    if (!myTurn) {
      closeModal();
      return;
    }
    const key = `coinche-${c.stage || "-"}-${c.multiplier || 1}-${gs.turnSeat}`;
    if (state.lastMpBidPromptKey !== key) {
      state.lastMpBidPromptKey = key;
      showMultiplayerCoincheModal(gs);
    }
    return;
  }

  if (state.phase === "bidding") {
    const b = gs.bidding || {};
    const mySeat = gs.yourSeat;
    const myTurn = b.currentSeat === mySeat;

    if (!myTurn) {
      closeModal();
      return;
    }

    const key = `${b.currentSeat}-${b.highestBid?.value || 0}-${b.highestBid?.suit || "-"}`;
    if (state.lastMpBidPromptKey !== key) {
      state.lastMpBidPromptKey = key;
      showMultiplayerBidModal(gs);
    }
  }
};

render();
