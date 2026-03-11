(() => {
  const statusEl = document.getElementById("lobby-status");
  const eventsEl = document.getElementById("mp-events");
  const nameEl = document.getElementById("mp-name");
  const codeEl = document.getElementById("mp-code");
  const createBtn = document.getElementById("mp-create");
  const joinBtn = document.getElementById("mp-join");
  const startBtn = document.getElementById("mp-start");
  const leaveBtn = document.getElementById("mp-leave");
  const rematchBtn = document.getElementById("btn-rematch");
  const seatEl = document.getElementById("mp-seat");

  if (!statusEl || typeof io === "undefined") return;

  const SERVER_URL = `${location.protocol}//${location.host}`;
  const socket = io(SERVER_URL, { autoConnect: true });

  const tabKey = sessionStorage.getItem("mp_tab_key") || crypto.randomUUID();
  sessionStorage.setItem("mp_tab_key", tabKey);

  const savedCode = sessionStorage.getItem("mp_room_code") || "";
  const savedToken = sessionStorage.getItem("mp_room_token") || "";
  if (savedCode) codeEl.value = savedCode;

  let currentState = null;
  let lastStatus = "";
  let connState = "connecting";

  function ts() {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function humanizeError(code) {
    const map = {
      ROOM_NOT_FOUND: "Room not found. Check the room code.",
      GAME_ALREADY_STARTED: "Game already started in this room.",
      ROOM_FULL: "Room is full.",
      BAD_SEAT: "Invalid seat selection.",
      SEAT_TAKEN: "That seat is already taken.",
      HOST_ONLY: "Only the host can start the game.",
      NEED_4_PLAYERS: "Need 4 players before starting.",
      NO_SEAT: "No seat assigned for this socket. Rejoin/reconnect.",
      NOT_IN_GAME: "You are not in an active game.",
      NOT_BIDDING: "Not in bidding phase.",
      NOT_COINCHE_PHASE: "Not in contree/surcontree phase.",
      NOT_PLAY_PHASE: "Not in card play phase.",
      NOT_YOUR_TURN: "It is not your turn.",
      BAD_SUIT: "Invalid suit selected.",
      BAD_BID: "Invalid bid value.",
      BID_TOO_LOW: "Bid is too low.",
      CARD_NOT_IN_HAND: "Card is not in your hand.",
      ILLEGAL_MOVE: "Illegal card play for current trick.",
      NOT_DEFENDER: "Only defenders can contree now.",
      NOT_TAKER: "Only takers can surcontree now.",
      BAD_TOKEN: "Reconnect token expired/invalid. Join room again.",
      NOT_IN_ROOM: "You are not currently in a room.",
      REMATCH_NOT_AVAILABLE: "Rematch is available only after a finished game.",
      MATCH_FINISHED_2000: "Match is finished (a team reached 2000). Create a new room for a new match.",
    };
    return map[code] || code || "Unknown error";
  }

  function addEvent(msg, tone = "info") {
    if (!eventsEl) return;
    const row = document.createElement("div");
    row.className = `event ${tone}`;
    row.textContent = `[${ts()}] ${msg}`;
    eventsEl.prepend(row);

    while (eventsEl.children.length > 40) {
      eventsEl.removeChild(eventsEl.lastChild);
    }
  }

  function cardText(c) {
    if (!c) return "?";
    const map = { J: "V", Q: "D", K: "R", A: "A" };
    return `${map[c.rank] || c.rank}${c.suit}`;
  }

  function seatsHtml(room) {
    return room.seats
      .map((s, i) => `Seat ${i + 1}: ${s ? `${s.name}${s.connected ? "" : " (offline)"}` : "(empty)"}`)
      .join("<br>");
  }

  function phaseDetails(gs) {
    if (!gs) return "Waiting for game state...";

    const yourTurn = gs.turnSeat === gs.yourSeat;
    const contract = gs.contract ? `${gs.contract.value} ${gs.contract.suit} x${gs.contract.multiplier || 1}` : "none";

    if (gs.phase === "bidding") {
      const b = gs.bidding || {};
      const canAct = b.currentSeat === gs.yourSeat;
      return [
        `Phase: <strong>Bidding</strong> ${yourTurn ? "(your turn)" : ""}`,
        `Bid turn: Seat ${((b.currentSeat ?? 0) + 1)}`,
        `High: ${b.highestBid ? `${b.highestBid.value}${b.highestBid.suit} (Seat ${b.highestBid.by + 1})` : "none"}`,
        `Contract: ${contract}`,
        canAct ? "Action: Open bidding popup to bid/pass/kabbout." : "Action: Waiting for current bidder.",
      ].join("<br>");
    }

    if (gs.phase === "coinche") {
      const c = gs.coinche || {};
      return [
        `Phase: <strong>Coinche</strong> ${yourTurn ? "(your turn)" : ""}`,
        `Stage: ${c.stage || "-"} • Multiplier: x${c.multiplier || 1}`,
        `Current turn: Seat ${((gs.turnSeat ?? 0) + 1)}`,
        `Contract: ${contract}`,
      ].join("<br>");
    }

    if (gs.phase === "finished") {
      return [
        "Phase: <strong>Finished</strong>",
        `Contract: ${contract}`,
        "Use Rematch (host) or return to lobby.",
      ].join("<br>");
    }

    const trick = (gs.trick || []).map((t) => `S${t.seat + 1}:${cardText(t.card)}`).join(" | ") || "(empty)";
    return [
      `Phase: <strong>Play</strong> ${yourTurn ? "(your turn)" : ""}`,
      `Current turn: Seat ${((gs.turnSeat ?? 0) + 1)}`,
      `Trick #${(gs.trickCount || 0) + 1}`,
      `Current trick: ${trick}`,
      `Contract: ${contract}`,
    ].join("<br>");
  }

  function statusHeader() {
    if (connState === "connecting") {
      return `${lastStatus || "Connecting to server"}<span class="loading-dots" aria-hidden="true"><span></span><span></span><span></span></span>`;
    }
    return lastStatus;
  }

  function renderStatus() {
    const room = window.__mp.room;
    const roomLine = room
      ? `Room: <strong>${room.code}</strong><br>Status: ${room.status || "-"}<br>${seatsHtml(room)}<br>Started: ${room.started ? "Yes" : "No"}`
      : "Room: -";

    statusEl.dataset.conn = connState;
    statusEl.innerHTML = `${statusHeader()}<br><br>${roomLine}<br><br>${phaseDetails(currentState)}`;
  }

  function updateActionAvailability() {
    const room = window.__mp.room;
    const seat = window.__mp.seat;
    const isHost = room && seat === room.hostSeat;
    if (startBtn) startBtn.disabled = !room || !isHost || room.started;
    if (rematchBtn) rematchBtn.disabled = !room || !isHost || room.status !== "finished";
    if (leaveBtn) leaveBtn.disabled = !room;
  }

  function setStatus(msg, state = connState) {
    lastStatus = msg;
    connState = state;
    renderStatus();
    updateActionAvailability();
  }

  window.__mp = { socket, room: null, seat: null, token: null, state: null, setStatus };

  setStatus(`Connecting to server ${SERVER_URL}`, "connecting");

  socket.on("connect", () => {
    setStatus(`Connected to server ${SERVER_URL}`, "connected");
    addEvent("Connected to multiplayer server", "good");

    if (savedCode && savedToken) {
      socket.emit("room:reconnect", { code: savedCode, token: savedToken }, (res) => {
        if (res?.ok) {
          window.__mp.room = res.room;
          window.__mp.seat = res.seat;
          window.__mp.token = res.token;
          clearTimeout(window.__mpReconnectToast);
          setStatus(`Reconnected to room ${res.room.code} as seat ${res.seat + 1}`);
          addEvent(`Reconnected to room ${res.room.code} (seat ${res.seat + 1})`, "good");
        } else {
          addEvent(`Reconnect failed: ${humanizeError(res?.error)}`, "warn");
        }
      });
    }
  });

  socket.on("connect_error", () => {
    setStatus(`Could not connect to ${SERVER_URL}. Start backend first.`, "error");
    addEvent("Connection error (server offline?)", "warn");
  });

  socket.on("disconnect", () => {
    setStatus("Disconnected. Reconnecting...", "connecting");
    addEvent("Disconnected from server", "warn");
  });

  socket.on("reconnect_attempt", () => {
    setStatus("Reconnecting...", "connecting");
  });

  socket.on("room:update", (room) => {
    window.__mp.room = room;
    renderStatus();
    updateActionAvailability();
  });

  socket.on("game:started", ({ room }) => {
    window.__mp.room = room;
    setStatus(`Game started in room ${room.code}`);
    addEvent("Game started", "good");
  });

  socket.on("room:closed", ({ reason }) => {
    addEvent(`Room closed (${reason || "unknown"})`, "warn");
    sessionStorage.removeItem("mp_room_code");
    sessionStorage.removeItem("mp_room_token");
    window.__mp.room = null;
    window.__mp.token = null;
    window.__mp.state = null;
    currentState = null;
    setStatus("Room closed. Create or join a new room.");
  });

  socket.on("game:state", (gs) => {
    currentState = gs;
    window.__mp.state = gs;
    if (typeof window.syncFromMultiplayer === "function") window.syncFromMultiplayer(gs);
    renderStatus();
    updateActionAvailability();
  });

  socket.on("game:bid-event", ({ seat, action, type }) => {
    addEvent(`Seat ${seat + 1}: ${action || type}`, "info");
  });

  socket.on("game:coinche-event", ({ seat, action, type, multiplier }) => {
    addEvent(`Seat ${seat + 1}: ${action || type} (x${multiplier || 1})`, "info");
  });

  socket.on("game:card-played", ({ seat, card, auto }) => {
    addEvent(`Seat ${seat + 1} played ${cardText(card)}${auto ? " (auto)" : ""}`, auto ? "warn" : "info");
  });

  socket.on("game:trick-winner", ({ seat, trickCount }) => {
    addEvent(`Trick ${trickCount} winner: Seat ${seat + 1}`, "good");
  });

  socket.on("game:finished", ({ room }) => {
    if (room) window.__mp.room = room;
    addEvent("Game finished", "good");
    setStatus("Game finished.");
    const seat = window.__mp.seat;
    const host = room?.hostSeat;
    const summary = `Room ${room?.code || "-"} finished. ${seat === host ? "You are host: you can rematch." : "Waiting host for rematch."}`;
    window.__ui?.showPostgame?.(summary);
  });

  createBtn.onclick = () => {
    const name = (nameEl.value || "Player").trim();
    socket.emit("room:create", { name }, (res) => {
      if (!res?.ok) {
        const e = humanizeError(res?.error);
        setStatus(`Create failed: ${e}`);
        addEvent(`Create failed: ${e}`, "warn");
        return;
      }
      window.__mp.room = res.room;
      window.__mp.seat = res.seat;
      window.__mp.token = res.token;
      codeEl.value = res.room.code;
      sessionStorage.setItem("mp_room_code", res.room.code);
      sessionStorage.setItem("mp_room_token", res.token || "");
      setStatus(`Room created: ${res.room.code} (you are seat ${res.seat + 1})`);
      addEvent(`Room ${res.room.code} created`, "good");
    });
  };

  joinBtn.onclick = () => {
    const name = (nameEl.value || "Player").trim();
    const code = (codeEl.value || "").trim().toUpperCase();
    if (!code) return setStatus("Enter room code first.");

    const requestedSeat = seatEl?.value ? Number(seatEl.value) : null;
    socket.emit("room:join", { code, name, seat: Number.isInteger(requestedSeat) ? requestedSeat : undefined }, (res) => {
      if (!res?.ok) {
        const e = humanizeError(res?.error);
        setStatus(`Join failed: ${e}`);
        addEvent(`Join failed: ${e}`, "warn");
        return;
      }
      window.__mp.room = res.room;
      window.__mp.seat = res.seat;
      window.__mp.token = res.token;
      sessionStorage.setItem("mp_room_code", res.room.code);
      sessionStorage.setItem("mp_room_token", res.token || "");
      setStatus(`Joined room ${res.room.code} (seat ${res.seat + 1})`);
      addEvent(`Joined room ${res.room.code} as seat ${res.seat + 1}`, "good");
    });
  };

  startBtn.onclick = () => {
    socket.emit("game:start", {}, (res) => {
      if (!res?.ok) {
        const e = humanizeError(res?.error);
        setStatus(`Start failed: ${e}`);
        addEvent(`Start failed: ${e}`, "warn");
        return;
      }
      setStatus("Start requested.");
      addEvent("Start requested", "info");
    });
  };

  leaveBtn.onclick = () => {
    socket.emit("room:leave", {}, (res) => {
      if (!res?.ok) {
        const e = humanizeError(res?.error);
        setStatus(`Leave failed: ${e}`);
        addEvent(`Leave failed: ${e}`, "warn");
        return;
      }
      sessionStorage.removeItem("mp_room_code");
      sessionStorage.removeItem("mp_room_token");
      window.__mp.room = null;
      window.__mp.token = null;
      window.__mp.state = null;
      currentState = null;
      setStatus("Left room.");
      addEvent("You left the room", "info");
      window.__ui?.show?.("lobby");
    });
  };

  rematchBtn.onclick = () => {
    socket.emit("game:rematch", {}, (res) => {
      if (!res?.ok) {
        const e = humanizeError(res?.error);
        setStatus(`Rematch failed: ${e}`);
        addEvent(`Rematch failed: ${e}`, "warn");
        return;
      }
      addEvent("Rematch requested", "good");
      window.__ui?.show?.("game");
    });
  };

  updateActionAvailability();
})();
