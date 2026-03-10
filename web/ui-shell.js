(() => {
  const screens = {
    menu: document.getElementById("screen-menu"),
    lobby: document.getElementById("screen-lobby"),
    settings: document.getElementById("screen-settings"),
    game: document.getElementById("screen-game"),
    postgame: document.getElementById("screen-postgame"),
  };

  const btnMenuStart = document.getElementById("btn-menu-start");
  const btnMenuSettings = document.getElementById("btn-menu-settings");
  const btnLobbyBack = document.getElementById("btn-lobby-back");
  const btnSettingsBack = document.getElementById("btn-settings-back");
  const btnGameLobby = document.getElementById("btn-game-lobby");
  const btnPostgameLobby = document.getElementById("btn-postgame-lobby");
  const postgameSummary = document.getElementById("postgame-summary");

  const stgDark = document.getElementById("stg-dark");
  const stgSfx = document.getElementById("stg-sfx");

  function show(name) {
    Object.entries(screens).forEach(([k, el]) => {
      if (!el) return;
      el.classList.toggle("active", k === name);
    });
    sessionStorage.setItem("ui_screen", name);
  }

  function showPostgame(summaryText) {
    if (postgameSummary) postgameSummary.textContent = summaryText || "Round ended.";
    show("postgame");
  }

  window.__ui = { show, showPostgame };

  btnMenuStart?.addEventListener("click", () => show("lobby"));
  btnMenuSettings?.addEventListener("click", () => show("settings"));
  btnLobbyBack?.addEventListener("click", () => show("menu"));
  btnSettingsBack?.addEventListener("click", () => show("menu"));
  btnGameLobby?.addEventListener("click", () => show("lobby"));
  btnPostgameLobby?.addEventListener("click", () => show("lobby"));

  stgDark?.addEventListener("change", () => {
    document.body.classList.toggle("theme-light", !stgDark.checked);
    localStorage.setItem("stg_dark", stgDark.checked ? "1" : "0");
  });

  stgSfx?.addEventListener("change", () => {
    localStorage.setItem("stg_sfx", stgSfx.checked ? "1" : "0");
  });

  const dark = localStorage.getItem("stg_dark");
  if (dark === "0") {
    stgDark.checked = false;
    document.body.classList.add("theme-light");
  }

  const sfx = localStorage.getItem("stg_sfx");
  if (sfx === "0") stgSfx.checked = false;

  const remembered = sessionStorage.getItem("ui_screen") || "menu";
  show(remembered);

  // Auto route to game when live game state starts; back to lobby when not in-game
  setInterval(() => {
    const gs = window.__mp?.state;
    const room = window.__mp?.room;
    if (gs?.phase === "bidding" || gs?.phase === "coinche" || gs?.phase === "play") {
      if (!screens.game.classList.contains("active")) show("game");
      return;
    }
    if (gs?.phase === "finished") {
      if (!screens.postgame.classList.contains("active")) show("postgame");
      return;
    }
    if (room && room.started !== true && (screens.game.classList.contains("active") || screens.postgame.classList.contains("active"))) {
      show("lobby");
    }
  }, 500);
})();
