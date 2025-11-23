const socket = io();

// State
let currentRoomCode = null;
let isHost = false;
let hasAnsweredCurrent = false;
let lastOptionCards = [];
let currentPlayers = [];
let playerStates = {}; // pro Spieler: { answered: bool, correct: true/false/null }

// Webcam-State
let localCameraStream = null;

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
const btnToggleCamera = $("btn-toggle-camera");

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

// Spielerleiste unten
const playersStripInnerEl = $("players-strip-inner");

// Game Over
const finalScoreboardEl = $("final-scoreboard");

/* ---- Event Listener ---- */

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

/* ---- Webcam: manuell per Button ---- */

btnToggleCamera.addEventListener("click", async () => {
  if (localCameraStream) {
    // Kamera deaktivieren
    localCameraStream.getTracks().forEach((t) => t.stop());
    localCameraStream = null;
    btnToggleCamera.textContent = "Kamera aktivieren";
    renderPlayerStrip(currentPlayers);
    return;
  }

  // Kamera aktivieren – nur Video, kein Mikrofon
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("Dein Browser unterstützt keine Kamera-Funktion.");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false
    });
    localCameraStream = stream;
    btnToggleCamera.textContent = "Kamera deaktivieren";
    renderPlayerStrip(currentPlayers);
  } catch (err) {
    console.error("Kamera konnte nicht gestartet werden:", err);
    quizStatusEl.textContent =
      "Kamera konnte nicht gestartet werden (Berechtigungen prüfen).";
  }
});

/* ---- Socket Events ---- */

// Raum-Update (Spielerliste + Scores)
socket.on("roomUpdate", (state) => {
  if (!state) return;
  currentPlayers = state.players || [];
  ensurePlayerStateForCurrentPlayers();
  renderPlayersList(state.players, state.hostId);
  renderScoreboard(state.players);
  renderPlayerStrip(state.players);
  isHost = state.hostId === socket.id;
  updateLobbyHostUI();
});

// Spiel gestartet
socket.on("gameStarted", () => {
  hasAnsweredCurrent = false;
  quizStatusEl.textContent = "";
  btnNextQuestion.classList.add("hidden");
  btnNextQuestion.disabled = true;
  resetPlayerStatesForNewQuestion();
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

  resetPlayerStatesForNewQuestion();

  quizCategoryEl.textContent = payload.category;
  quizProgressEl.textContent = `${payload.index}/${payload.total}`;
  quizQuestionEl.textContent = payload.question;
  renderOptions(payload.options);
});

// Score-Update
socket.on("scoreUpdate", (state) => {
  if (!state) return;
  currentPlayers = state.players || [];
  renderScoreboard(state.players);
  renderPlayerStrip(state.players);
});

// Info: ein Spieler hat seine Antwort abgegeben (für Status „Lock-in“)
socket.on("playerAnswered", ({ playerId }) => {
  if (!playerStates[playerId]) {
    playerStates[playerId] = { answered: true, correct: null };
  } else {
    playerStates[playerId].answered = true;
  }
  renderPlayerStrip(currentPlayers);
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

  // Falsche Antworten markieren + Spielerstatus aktualisieren
  answers.forEach((a) => {
    if (!playerStates[a.playerId]) {
      playerStates[a.playerId] = { answered: true, correct: a.correct };
    } else {
      playerStates[a.playerId].answered = true;
      playerStates[a.playerId].correct = a.correct;
    }

    if (!a.correct) {
      const card = lastOptionCards[a.answerIndex];
      if (card) {
        card.classList.add("wrong");
      }
    }
  });

  renderPlayerStrip(currentPlayers);

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

/* ---- Rendering ---- */

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

      // eigene Auswahl leicht highlighten (bis Reveal kommt)
      card.classList.add("selected");

      socket.emit("submitAnswer", {
        roomCode: currentRoomCode,
        answerIndex: index
      });

      quizStatusEl.textContent =
        "Antwort gesendet! Warte, bis alle geantwortet haben …";
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

/* Spielerleiste unten */

function ensurePlayerStateForCurrentPlayers() {
  currentPlayers.forEach((p) => {
    if (!playerStates[p.id]) {
      playerStates[p.id] = { answered: false, correct: null };
    }
  });
}

function resetPlayerStatesForNewQuestion() {
  currentPlayers.forEach((p) => {
    playerStates[p.id] = { answered: false, correct: null };
  });
  renderPlayerStrip(currentPlayers);
}

function renderPlayerStrip(players) {
  if (!playersStripInnerEl) return;

  playersStripInnerEl.innerHTML = "";

  players.forEach((p) => {
    if (!playerStates[p.id]) {
      playerStates[p.id] = { answered: false, correct: null };
    }
    const state = playerStates[p.id];

    // Hauptkachel
    const cam = document.createElement("div");
    cam.className = "player-cam";

    // Rahmenfarben nach Reveal
    if (state.correct === true) cam.classList.add("correct-frame");
    else if (state.correct === false) cam.classList.add("wrong-frame");

    // Video element
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;

    // Nur eigene Kamera live
    if (p.id === socket.id && localCameraStream) {
      video.srcObject = localCameraStream;
    }

    // Status Icon (oben links wie im Screenshot)
    const statusIcon = document.createElement("div");
    statusIcon.className = "player-status-icon";

    // Logik:
    if (state.correct === true) {
      statusIcon.textContent = "✔️"; // richtig
      statusIcon.classList.add("status-correct");
    } else if (state.correct === false) {
      statusIcon.textContent = "❌"; // falsch
      statusIcon.classList.add("status-wrong");
    } else if (state.answered) {
      statusIcon.textContent = "✓"; // gelber Haken
      statusIcon.classList.add("status-answered");
    } else {
      statusIcon.textContent = "•"; // neutraler Punkt
      statusIcon.classList.add("status-waiting");
    }

    // Name
    const name = document.createElement("div");
    name.className = "player-cam-name";
    name.textContent = p.nickname;

    cam.appendChild(video);
    cam.appendChild(statusIcon);
    cam.appendChild(name);

    playersStripInnerEl.appendChild(cam);
  });
}

/* --- 3D Tilt Effekt für Karten --- */
const tiltCards = document.querySelectorAll(".tilt-card");

tiltCards.forEach((card) => {
  const maxTilt = 9; // Grad

  card.addEventListener("mousemove", (e) => {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = ((y - centerY) / centerY) * -maxTilt;
    const rotateY = ((x - centerX) / centerX) * maxTilt;

    card.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px)`;
    card.classList.add("hovered");
  });

  card.addEventListener("mouseleave", () => {
    card.style.transform = "";
    card.classList.remove("hovered");
  });
});
