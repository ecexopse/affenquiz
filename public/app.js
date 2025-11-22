const socket = io();

// State
let currentRoomCode = null;
let isHost = false;
let hasAnsweredCurrent = false;
let lastOptionCards = [];

// DOM Helper
const $ = (id) => document.getElementById(id);

// Screens
const screens = {
  start: $("screen-start"),
  lobby: $("screen-lobby"),
  quiz: $("screen-quiz"),
  gameOver: $("screen-game-over")
};

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    if (key === name) {
      el.classList.add("active");
    } else {
      el.classList.remove("active");
    }
  });
}

// Inputs & Buttons
const nicknameInput = $("nickname-input");
const roomCodeInput = $("room-code-input");
const startError = $("start-error");

const btnCreateRoom = $("btn-create-room");
const btnJoinRoom = $("btn-join-room");
const btnBackToStart = $("btn-back-to-start");
const btnStartGame = $("btn-start-game");
const btnNextQuestion = $("btn-next-question");
const btnBackToLobby = $("btn-back-to-lobby");
const btnNewGame = $("btn-new-game");

// Lobby Elements
const lobbyCodeEl = $("lobby-code");
const playersListEl = $("players-list");
const hostInfoEl = $("host-info");

// Quiz Elements
const quizCategoryEl = $("quiz-category");
const quizProgressEl = $("quiz-progress");
const quizQuestionEl = $("quiz-question");
const quizOptionsEl = $("quiz-options");
const quizStatusEl = $("quiz-status");
const answerSummaryEl = $("answer-summary");
const scoreboardListEl = $("scoreboard-list");

// Game Over
const finalScoreboardEl = $("final-scoreboard");

// --- Event Listener ---
// Lobby erstellen
btnCreateRoom.addEventListener("click", () => {
  const nickname = nicknameInput.value.trim() || "Affe";
  startError.textContent = "";

  socket.emit("createRoom", nickname, (response) => {
    if (response?.roomCode) {
      currentRoomCode = response.roomCode;
      isHost = response.isHost;
      lobbyCodeEl.textContent = currentRoomCode;
      updateLobbyHostUI();
      showScreen("lobby");
      updateLobbyLinkHint();
    } else if (response?.error) {
      startError.textContent = response.error;
    }
  });
});

// Lobby beitreten
btnJoinRoom.addEventListener("click", () => {
  const nickname = nicknameInput.value.trim() || "Affe";
  const roomCode = roomCodeInput.value.trim().toUpperCase();
  startError.textContent = "";

  if (!roomCode || roomCode.length < 3) {
    startError.textContent = "Bitte gib einen gültigen Raumcode ein.";
    return;
  }

  socket.emit("joinRoom", { roomCode, nickname }, (response) => {
    if (response?.error) {
      startError.textContent = response.error;
      return;
    }
    currentRoomCode = response.roomCode;
    isHost = response.isHost;
    lobbyCodeEl.textContent = currentRoomCode;
    updateLobbyHostUI();
    showScreen("lobby");
    updateLobbyLinkHint();
  });
});

// Zurück zur Startseite (aus Lobby)
btnBackToStart.addEventListener("click", () => {
  showScreen("start");
});

// Spiel starten (nur Host)
btnStartGame.addEventListener("click", () => {
  if (!currentRoomCode) return;
  socket.emit("startGame", currentRoomCode);
});

// Nächste Frage (nur Host)
btnNextQuestion.addEventListener("click", () => {
  if (!currentRoomCode) return;
  socket.emit("nextQuestion", currentRoomCode);
});

// Game Over: Zurück zur Lobby
btnBackToLobby.addEventListener("click", () => {
  showScreen("lobby");
});

// Game Over: Neue Runde (Host startet dann wieder)
btnNewGame.addEventListener("click", () => {
  if (isHost && currentRoomCode) {
    socket.emit("startGame", currentRoomCode);
  } else {
    // Nur Screen wechseln, Host muss starten
    showScreen("lobby");
  }
});

// Enter-Taste für Join
roomCodeInput.addEventListener("keyup", (e) => {
  if (e.key === "Enter") {
    btnJoinRoom.click();
  }
});

// --- Socket Events ---
// Raum-Update (Spielerliste + Scores)
socket.on("roomUpdate", (state) => {
  if (!state) return;
  renderPlayersList(state.players, state.hostId);
  renderScoreboard(state.players);
  isHost = state.hostId === socket.id;
  updateLobbyHostUI();
});

// Spiel gestartet
socket.on("gameStarted", () => {
  hasAnsweredCurrent = false;
  quizStatusEl.textContent = "";
  btnNextQuestion.classList.add("hidden");
  btnNextQuestion.disabled = true;
  showScreen("quiz");
});

// Neue Frage
socket.on("newQuestion", (payload) => {
  hasAnsweredCurrent = false;
  quizStatusEl.textContent = "";
  btnNextQuestion.disabled = true;
  btnNextQuestion.classList.add("hidden");

  // Answer-Summary zurücksetzen
  if (answerSummaryEl) {
    answerSummaryEl.classList.add("hidden");
    answerSummaryEl.innerHTML = "";
  }

  quizCategoryEl.textContent = payload.category;
  quizProgressEl.textContent = `${payload.index}/${payload.total}`;
  quizQuestionEl.textContent = payload.question;
  renderOptions(payload.options);
});

// Score-Update
socket.on("scoreUpdate", (state) => {
  if (!state) return;
  renderScoreboard(state.players);
});

// Antworten aufdecken (ROT/GRÜN + wer was geantwortet hat)
socket.on("answerReveal", (payload) => {
  if (!payload) return;
  const { answers, correctIndex } = payload;

  // Karten einfärben
  lastOptionCards.forEach((card, idx) => {
    card.classList.add("disabled");
    if (idx === correctIndex) {
      card.classList.add("correct");
    }
  });

  // Falsche Antworten markieren
  answers.forEach((a) => {
    if (!a.correct) {
      const card = lastOptionCards[a.answerIndex];
      if (card) {
        card.classList.add("wrong");
      }
    }
  });

  quizStatusEl.textContent =
    "Auswertung: Grün = richtig, Rot = falsch. Unten siehst du, wer was gewählt hat.";

  renderAnswerSummary(answers, correctIndex);

  // Host darf jetzt weiterklicken
  if (isHost) {
    btnNextQuestion.disabled = false;
    btnNextQuestion.classList.remove("hidden");
  }
});

// Spiel vorbei
socket.on("gameOver", (finalScores) => {
  renderFinalScoreboard(finalScores);
  showScreen("gameOver");
});

// --- Rendering ---
function renderPlayersList(players, hostId) {
  playersListEl.innerHTML = "";
  players.forEach((p) => {
    const li = document.createElement("li");

    const nameDiv = document.createElement("div");
    nameDiv.className = "player-name";
    const avatar = document.createElement("div");
    avatar.className = "player-avatar";
    avatar.textContent = "🐵";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = p.nickname;

    nameDiv.appendChild(avatar);
    nameDiv.appendChild(nameSpan);

    const rightDiv = document.createElement("div");
    if (p.id === hostId) {
      const hostBadge = document.createElement("span");
      hostBadge.className = "host-badge";
      hostBadge.textContent = "Host";
      rightDiv.appendChild(hostBadge);
    }

    li.appendChild(nameDiv);
    li.appendChild(rightDiv);
    playersListEl.appendChild(li);
  });
}

function renderScoreboard(players) {
  scoreboardListEl.innerHTML = "";
  const sorted = [...players].sort((a, b) => b.score - a.score);
  sorted.forEach((p, index) => {
    const li = document.createElement("li");
    const nameDiv = document.createElement("div");
    nameDiv.className = "player-name";

    const avatar = document.createElement("div");
    avatar.className = "player-avatar";
    avatar.textContent = index === 0 ? "👑" : "🐵";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = p.nickname;

    nameDiv.appendChild(avatar);
    nameDiv.appendChild(nameSpan);

    const scoreSpan = document.createElement("span");
    scoreSpan.className = "score";
    scoreSpan.textContent = p.score;

    li.appendChild(nameDiv);
    li.appendChild(scoreSpan);
    scoreboardListEl.appendChild(li);
  });
}

function renderOptions(options) {
  quizOptionsEl.innerHTML = "";
  lastOptionCards = [];
  const letters = ["A", "B", "C", "D"];

  options.forEach((opt, index) => {
    const card = document.createElement("div");
    card.className = "option-card";

    const letter = document.createElement("div");
    letter.className = "option-letter";
    letter.textContent = letters[index] || "?";

    const text = document.createElement("div");
    text.className = "option-text";
    text.textContent = opt;

    card.appendChild(letter);
    card.appendChild(text);

    card.addEventListener("click", () => {
      if (hasAnsweredCurrent || !currentRoomCode) return;
      hasAnsweredCurrent = true;

      // own selection leicht highlighten (bis Reveal kommt)
      card.classList.add("selected");

      socket.emit("submitAnswer", {
        roomCode: currentRoomCode,
        answerIndex: index
      });

      quizStatusEl.textContent = "Antwort gesendet! Warte, bis alle geantwortet haben …";
    });

    quizOptionsEl.appendChild(card);
    lastOptionCards.push(card);
  });
}

function renderAnswerSummary(answers, correctIndex) {
  if (!answerSummaryEl) return;

  answerSummaryEl.innerHTML = "";
  answerSummaryEl.classList.remove("hidden");

  const letters = ["A", "B", "C", "D"];
  const grouped = {};

  answers.forEach((a) => {
    if (!grouped[a.answerIndex]) grouped[a.answerIndex] = [];
    grouped[a.answerIndex].push(a);
  });

  Object.keys(grouped)
    .map((k) => parseInt(k, 10))
    .sort((a, b) => a - b)
    .forEach((idx) => {
      const row = document.createElement("div");
      row.className = "answer-summary-row";

      const label = document.createElement("div");
      label.className = "answer-summary-label";
      const isCorrect = idx === correctIndex;
      label.textContent = `${letters[idx] || "?"} ${isCorrect ? "✓" : "✗"}`;

      const names = document.createElement("div");
      names.className = "answer-summary-names";
      names.textContent = grouped[idx].map((a) => a.nickname).join(", ");

      row.appendChild(label);
      row.appendChild(names);
      answerSummaryEl.appendChild(row);
    });
}

function renderFinalScoreboard(finalScores) {
  finalScoreboardEl.innerHTML = "";
  finalScores.forEach((p, idx) => {
    const li = document.createElement("li");
    const nameDiv = document.createElement("div");
    nameDiv.className = "player-name";

    const avatar = document.createElement("div");
    avatar.className = "player-avatar";
    avatar.textContent = idx === 0 ? "👑" : "🐵";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = `${p.nickname}`;

    nameDiv.appendChild(avatar);
    nameDiv.appendChild(nameSpan);

    const scoreSpan = document.createElement("span");
    scoreSpan.className = "score";
    scoreSpan.textContent = p.score;

    li.appendChild(nameDiv);
    li.appendChild(scoreSpan);
    finalScoreboardEl.appendChild(li);
  });
}

function updateLobbyHostUI() {
  if (isHost) {
    hostInfoEl.textContent =
      "Du bist Host. Du kannst das Spiel starten, wenn alle drin sind.";
    btnStartGame.classList.remove("hidden");
  } else {
    hostInfoEl.textContent =
      "Du bist Spieler. Warte, bis der Host das Spiel startet.";
    btnStartGame.classList.add("hidden");
  }
}

// Kleines Text-Hint mit Link
function updateLobbyLinkHint() {
  if (!currentRoomCode) return;
  // könnte erweitert werden (z.B. Anzeige eines Links)
}

// --- 3D Tilt Effekt für Karten ---
const tiltCards = document.querySelectorAll(".tilt-card");

tiltCards.forEach((card) => {
  const maxTilt = 9; // Grad

  card.addEventListener("mousemove", (e) => {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const percentX = (x / rect.width) * 2 - 1; // -1 bis 1
    const percentY = (y / rect.height) * 2 - 1;

    const rotateY = percentX * maxTilt;
    const rotateX = -percentY * maxTilt;

    card.classList.add("hovered");
    card.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-2px)`;
  });

  card.addEventListener("mouseleave", () => {
    card.classList.remove("hovered");
    card.style.transform = "";
  });
});
