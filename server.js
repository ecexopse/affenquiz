const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Static files
app.use(express.static(path.join(__dirname, "public")));

// --- In-Memory Game State ---
const rooms = {};

// Beispiel-Fragen – du kannst die Liste beliebig erweitern
const QUESTIONS = [
  // Allgemeinwissen
  {
    id: 1,
    category: "Allgemeinwissen",
    type: "choice",
    question: "Wie viele Kontinente hat die Erde?",
    options: ["5", "6", "7", "8"],
    correctIndex: 2
  },
  {
    id: 2,
    category: "Allgemeinwissen",
    type: "choice",
    question: "Welche ist die größte Wüste der Welt?",
    options: ["Sahara", "Gobi", "Antarktis", "Kalahari"],
    correctIndex: 2
  },
  // Flaggen
  {
    id: 3,
    category: "Flaggen",
    type: "choice",
    question: "Welche Flagge gehört zu Japan?",
    options: ["🇩🇪", "🇯🇵", "🇧🇷", "🇺🇸"],
    correctIndex: 1
  },
  {
    id: 4,
    category: "Flaggen",
    type: "choice",
    question: "Welche Flagge gehört zu Brasilien?",
    options: ["🇫🇷", "🇮🇹", "🇧🇷", "🇨🇦"],
    correctIndex: 2
  },
  // Lieder erraten (ohne Audio, mit Text-Zitat)
  {
    id: 5,
    category: "Lieder erraten",
    type: "choice",
    question: "Zu welchem Song gehört die Zeile: „We will, we will rock you…“?",
    options: [
      "Bohemian Rhapsody – Queen",
      "We Will Rock You – Queen",
      "Thunderstruck – AC/DC",
      "Smells Like Teen Spirit – Nirvana"
    ],
    correctIndex: 1
  },
  {
    id: 6,
    category: "Lieder erraten",
    type: "choice",
    question: "„I'm gonna take my horse to the old town road…“ – welcher Song?",
    options: [
      "Old Town Road – Lil Nas X",
      "Bad Guy – Billie Eilish",
      "Blinding Lights – The Weeknd",
      "Shape of You – Ed Sheeran"
    ],
    correctIndex: 0
  }
];

// Helper: zufälliger Raumcode
function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

io.on("connection", (socket) => {
  // Raum erstellen
  socket.on("createRoom", (nickname, cb) => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      hostId: socket.id,
      players: {},
      currentQuestionIndex: 0,
      isStarted: false,
      answers: []
    };

    rooms[roomCode].players[socket.id] = {
      id: socket.id,
      nickname: nickname || "Affe",
      score: 0,
      answeredCurrent: false
    };

    socket.join(roomCode);
    if (cb) cb({ roomCode, isHost: true });
    io.to(roomCode).emit("roomUpdate", getRoomPublicState(roomCode));
  });

  // Raum beitreten
  socket.on("joinRoom", ({ roomCode, nickname }, cb) => {
    roomCode = (roomCode || "").toUpperCase();
    const room = rooms[roomCode];

    if (!room) {
      return cb && cb({ error: "Raum nicht gefunden." });
    }
    if (room.isStarted) {
      return cb && cb({ error: "Spiel in diesem Raum läuft bereits." });
    }

    room.players[socket.id] = {
      id: socket.id,
      nickname: nickname || "Affe",
      score: 0,
      answeredCurrent: false
    };

    socket.join(roomCode);
    cb && cb({ roomCode, isHost: room.hostId === socket.id });
    io.to(roomCode).emit("roomUpdate", getRoomPublicState(roomCode));
  });

  // Spiel starten (nur Host)
  socket.on("startGame", (roomCode) => {
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;

    room.isStarted = true;
    room.currentQuestionIndex = 0;
    room.answers = [];
    resetAnswers(room);
    io.to(roomCode).emit("gameStarted");
    sendCurrentQuestion(roomCode);
  });

  // Nächste Frage (nur Host)
  socket.on("nextQuestion", (roomCode) => {
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;

    room.currentQuestionIndex++;

    // Antworten der letzten Frage zurücksetzen
    room.answers = [];
    resetAnswers(room);

    if (room.currentQuestionIndex >= QUESTIONS.length) {
      const finalScores = Object.values(room.players)
        .map((p) => ({ nickname: p.nickname, score: p.score }))
        .sort((a, b) => b.score - a.score);

      io.to(roomCode).emit("gameOver", finalScores);
      room.isStarted = false;
      return;
    }

    sendCurrentQuestion(roomCode);
  });

  // Antwort einreichen
  socket.on("submitAnswer", ({ roomCode, answerIndex }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const player = room.players[socket.id];
    if (!player || player.answeredCurrent) return;

    const question = QUESTIONS[room.currentQuestionIndex];
    const isCorrect = answerIndex === question.correctIndex;

    // Punkte vergeben
    if (isCorrect) player.score += 100;

    player.answeredCurrent = true;

    // Antwort speichern
    if (!room.answers) room.answers = [];
    room.answers.push({
      playerId: socket.id,
      nickname: player.nickname,
      answerIndex,
      correct: isCorrect
    });

    // für Spieler-Leiste: jemand hat geantwortet
    io.to(roomCode).emit("playerAnswered", { playerId: socket.id });

    // Score Update an alle
    io.to(roomCode).emit("scoreUpdate", getRoomPublicState(roomCode));

    // Prüfen, ob alle geantwortet haben
    const allAnswered = Object.values(room.players).every(
      (p) => p.answeredCurrent
    );

    if (allAnswered) {
      io.to(roomCode).emit("answerReveal", {
        answers: room.answers,
        correctIndex: question.correctIndex
      });
    }
  });

  // Disconnect
  socket.on("disconnect", () => {
    // Spieler aus allen Räumen entfernen
    for (const [roomCode, room] of Object.entries(rooms)) {
      if (room.players[socket.id]) {
        delete room.players[socket.id];

        // Wenn Host disconnected -> neuen Host wählen oder Raum löschen
        const remainingPlayerIds = Object.keys(room.players);
        if (room.hostId === socket.id) {
          if (remainingPlayerIds.length > 0) {
            room.hostId = remainingPlayerIds[0];
          } else {
            // Kein Spieler mehr -> Raum löschen
            delete rooms[roomCode];
            continue;
          }
        }
        io.to(roomCode).emit("roomUpdate", getRoomPublicState(roomCode));
      }
    }
  });
});

function resetAnswers(room) {
  Object.values(room.players).forEach((p) => (p.answeredCurrent = false));
}

function sendCurrentQuestion(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  const question = QUESTIONS[room.currentQuestionIndex];

  io.to(roomCode).emit("newQuestion", {
    index: room.currentQuestionIndex + 1,
    total: QUESTIONS.length,
    category: question.category,
    question: question.question,
    options: question.options
  });
}

function getRoomPublicState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return null;
  return {
    hostId: room.hostId,
    isStarted: room.isStarted,
    players: Object.values(room.players).map((p) => ({
      id: p.id,
      nickname: p.nickname,
      score: p.score
    }))
  };
}

server.listen(PORT, () => {
  console.log(`Affen Quiz läuft auf http://localhost:${PORT}`);
});
