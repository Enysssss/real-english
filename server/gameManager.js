const fs = require('fs');
const path = require('path');
const db = require('./db');

const vocabBank = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'vocab.json'), 'utf8')
).items;

const DEFAULT_ROUND_SECONDS = 30;
const MIN_ROUND_SECONDS = 5;
const MAX_ROUND_SECONDS = 120;
const ROUNDS_PER_GAME = 5;
const POINTS = { oui: 2, presque: 1, non: 0 };
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L

const sessions = new Map();
let io = null;

function attach(socketIoServer) {
  io = socketIoServer;
}

function makePlayerId() {
  return Math.random().toString(36).slice(2, 10);
}

function generateCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (sessions.has(code));
  return code;
}

function pickRounds() {
  const shuffled = [...vocabBank].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, ROUNDS_PER_GAME).map((item) => ({
    vocabId: item.id,
    fr: item.fr,
    referenceAnswers: item.en,
    native: item.native,
    formal: item.formal,
  }));
}

function publicPlayers(session) {
  return [...session.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    connected: p.connected,
    totalScore: p.totalScore,
  }));
}

function leaderboard(session) {
  return [...session.players.values()]
    .map((p) => ({ playerId: p.id, name: p.name, totalScore: p.totalScore }))
    .sort((a, b) => b.totalScore - a.totalScore);
}

function broadcastSessionUpdate(session) {
  io.to(session.code).emit('session:update', {
    phase: session.phase,
    hostName: session.hostName,
    players: publicPlayers(session),
  });
}

function createSession(hostSocketId, hostName) {
  const code = generateCode();
  const trimmedHostName = (hostName || '').trim().slice(0, 24) || 'Chef';
  const hostPlayerId = makePlayerId();
  const session = {
    code,
    hostSocketId,
    hostName: trimmedHostName,
    hostPlayerId,
    players: new Map(),
    phase: 'lobby',
    rounds: [],
    roundSeconds: DEFAULT_ROUND_SECONDS,
    currentRoundIndex: -1,
    roundTimer: null,
    roundDeadline: null,
    answers: new Map(), // `${roundIndex}:${playerId}` -> {text}
    grades: new Map(), // `${roundIndex}:${playerId}` -> {grade, points}
    playerOrder: [],
    reviewCursor: { roundIndex: 0, playerIdx: 0 },
    createdAt: Date.now(),
  };
  // the host plays too — they just also happen to grade the answers afterwards
  session.players.set(hostPlayerId, {
    id: hostPlayerId,
    name: trimmedHostName,
    socketId: hostSocketId,
    connected: true,
    totalScore: 0,
  });
  sessions.set(code, session);
  return session;
}

function getSession(code) {
  return sessions.get((code || '').toUpperCase());
}

function joinSession(session, socketId, name) {
  const trimmed = (name || '').trim().slice(0, 24);
  if (!trimmed) return { error: 'Choisis un pseudo.' };
  if (session.phase !== 'lobby') return { error: 'La partie a déjà commencé.' };
  const nameTaken = [...session.players.values()].some(
    (p) => p.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (nameTaken) return { error: 'Ce pseudo est déjà pris dans cette partie.' };
  const id = makePlayerId();
  session.players.set(id, { id, name: trimmed, socketId, connected: true, totalScore: 0 });
  return { playerId: id };
}

function rejoinSession(session, socketId, name) {
  const trimmed = (name || '').trim().slice(0, 24);
  const existing = [...session.players.values()].find(
    (p) => p.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (!existing) return { error: 'Pseudo introuvable dans cette partie.' };
  existing.socketId = socketId;
  existing.connected = true;
  return { playerId: existing.id };
}

function reviewShowPayload(session) {
  const { roundIndex, playerIdx } = session.reviewCursor;
  const round = session.rounds[roundIndex];
  const playerId = session.playerOrder[playerIdx];
  const player = session.players.get(playerId);
  const key = `${roundIndex}:${playerId}`;
  const answer = session.answers.get(key);
  const grade = session.grades.get(key);
  return {
    phase: 'review',
    roundIndex,
    totalRounds: session.rounds.length,
    fr: round.fr,
    referenceAnswers: round.referenceAnswers,
    native: round.native,
    formal: round.formal,
    playerId,
    playerName: player ? player.name : '???',
    answerText: answer ? answer.text : null,
    grade: grade ? grade.grade : null,
  };
}

function snapshotFor(session) {
  if (session.phase === 'lobby') {
    return { phase: 'lobby', hostName: session.hostName, players: publicPlayers(session) };
  }
  if (session.phase === 'question') {
    const round = session.rounds[session.currentRoundIndex];
    return {
      phase: 'question',
      roundIndex: session.currentRoundIndex,
      totalRounds: session.rounds.length,
      fr: round.fr,
      deadline: session.roundDeadline,
    };
  }
  if (session.phase === 'review') {
    return reviewShowPayload(session);
  }
  if (session.phase === 'finished') {
    return { phase: 'finished', leaderboard: leaderboard(session) };
  }
  return { phase: session.phase };
}

function startSession(session, requesterSocketId, roundSeconds) {
  if (requesterSocketId !== session.hostSocketId) return { error: 'Seul le chef peut lancer la partie.' };
  if (session.phase !== 'lobby') return { error: 'La partie a déjà commencé.' };
  if (session.players.size === 0) return { error: 'Attends au moins un joueur avant de lancer.' };
  const parsed = Number(roundSeconds);
  session.roundSeconds = Number.isFinite(parsed)
    ? Math.min(MAX_ROUND_SECONDS, Math.max(MIN_ROUND_SECONDS, Math.round(parsed)))
    : DEFAULT_ROUND_SECONDS;
  session.rounds = pickRounds();
  session.playerOrder = [...session.players.keys()];
  startRound(session, 0);
  return {};
}

function startRound(session, index) {
  session.phase = 'question';
  session.currentRoundIndex = index;
  session.roundDeadline = Date.now() + session.roundSeconds * 1000;
  const round = session.rounds[index];
  io.to(session.code).emit('round:start', {
    roundIndex: index,
    totalRounds: session.rounds.length,
    fr: round.fr,
    deadline: session.roundDeadline,
  });
  clearTimeout(session.roundTimer);
  session.roundTimer = setTimeout(() => advanceAfterRound(session), session.roundSeconds * 1000);
}

function advanceAfterRound(session) {
  const next = session.currentRoundIndex + 1;
  if (next < session.rounds.length) {
    startRound(session, next);
  } else {
    startReview(session);
  }
}

function findPlayerBySocket(session, socketId) {
  return [...session.players.values()].find((p) => p.socketId === socketId);
}

function allPlayersAnswered(session) {
  return session.playerOrder.every((playerId) =>
    session.answers.has(`${session.currentRoundIndex}:${playerId}`)
  );
}

function submitAnswer(session, socketId, text) {
  const player = findPlayerBySocket(session, socketId);
  if (!player) return { error: 'Joueur inconnu.' };
  if (session.phase !== 'question') return { error: "Ce n'est pas le moment de répondre." };
  const key = `${session.currentRoundIndex}:${player.id}`;
  session.answers.set(key, { text: (text || '').slice(0, 300) });
  if (allPlayersAnswered(session)) {
    clearTimeout(session.roundTimer);
    advanceAfterRound(session);
  }
  return {};
}

function sendChatMessage(session, socketId, text) {
  const player = findPlayerBySocket(session, socketId);
  if (!player) return { error: 'Tu dois avoir rejoint la partie pour écrire.' };
  const trimmed = (text || '').trim().slice(0, 200);
  if (!trimmed) return { error: 'Message vide.' };
  const message = { playerId: player.id, name: player.name, text: trimmed, ts: Date.now() };
  io.to(session.code).emit('chat:message', message);
  return {};
}

function startReview(session) {
  clearTimeout(session.roundTimer);
  session.phase = 'review';
  session.reviewCursor = { roundIndex: 0, playerIdx: 0 };
  io.to(session.code).emit('review:start', {});
  emitReviewShow(session);
}

function emitReviewShow(session) {
  io.to(session.code).emit('review:show', reviewShowPayload(session));
}

function gradeAnswer(session, requesterSocketId, grade) {
  if (requesterSocketId !== session.hostSocketId) return { error: 'Seul le chef peut noter.' };
  if (session.phase !== 'review') return { error: "Ce n'est pas la phase de review." };
  if (!(grade in POINTS)) return { error: 'Note invalide.' };

  const { roundIndex, playerIdx } = session.reviewCursor;
  const playerId = session.playerOrder[playerIdx];
  const key = `${roundIndex}:${playerId}`;
  if (session.grades.has(key)) return { error: 'Déjà noté.' };

  const player = session.players.get(playerId);
  const points = POINTS[grade];
  session.grades.set(key, { grade, points });
  if (player) player.totalScore += points;

  io.to(session.code).emit('review:graded', { roundIndex, playerId, grade, points });

  // brief pause so everyone can see the grade land before the view moves on
  setTimeout(() => advanceReviewCursor(session), 1400);
  return {};
}

function advanceReviewCursor(session) {
  const nextPlayerIdx = session.reviewCursor.playerIdx + 1;
  if (nextPlayerIdx < session.playerOrder.length) {
    session.reviewCursor = { roundIndex: session.reviewCursor.roundIndex, playerIdx: nextPlayerIdx };
    emitReviewShow(session);
    return;
  }
  const nextRoundIndex = session.reviewCursor.roundIndex + 1;
  if (nextRoundIndex < session.rounds.length) {
    session.reviewCursor = { roundIndex: nextRoundIndex, playerIdx: 0 };
    emitReviewShow(session);
    return;
  }
  finishSession(session);
}

async function finishSession(session) {
  session.phase = 'finished';
  const board = leaderboard(session);
  io.to(session.code).emit('game:finished', { leaderboard: board });

  const answersFlat = [];
  for (const [key, answer] of session.answers.entries()) {
    const [roundIndexStr, playerId] = key.split(':');
    const grade = session.grades.get(key);
    if (!grade) continue;
    answersFlat.push({
      roundIndex: Number(roundIndexStr),
      playerId,
      vocabId: session.rounds[Number(roundIndexStr)].vocabId,
      text: answer.text || '',
      grade: grade.grade,
      points: grade.points,
    });
  }

  const playersForDb = [...session.players.values()].map((p) => ({
    tempId: p.id,
    name: p.name,
    totalScore: p.totalScore,
  }));

  await db.saveFinishedSession({ code: session.code, players: playersForDb, answersFlat });

  setTimeout(() => sessions.delete(session.code), 30 * 60 * 1000);
}

function allPlayersDisconnected(session) {
  return [...session.players.values()].every((p) => !p.connected);
}

function disconnectSocket(socketId) {
  for (const session of sessions.values()) {
    let matched = false;
    for (const player of session.players.values()) {
      if (player.socketId === socketId) {
        player.connected = false;
        matched = true;
      }
    }
    if (!matched) continue;

    if (allPlayersDisconnected(session)) {
      // Everyone's gone — kill the session for good rather than leaving it
      // around for someone to stumble back into later.
      clearTimeout(session.roundTimer);
      sessions.delete(session.code);
    } else {
      broadcastSessionUpdate(session);
    }
  }
}

module.exports = {
  attach,
  createSession,
  getSession,
  joinSession,
  rejoinSession,
  startSession,
  submitAnswer,
  gradeAnswer,
  sendChatMessage,
  snapshotFor,
  broadcastSessionUpdate,
  disconnectSocket,
};
