const fs = require('fs');
const path = require('path');
const db = require('./db');

const vocabBank = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'vocab.json'), 'utf8')
).items;

const icebreakerBank = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'icebreakers.json'), 'utf8')
).icebreakers;

const DEFAULT_ROUND_SECONDS = 30;
const MIN_ROUND_SECONDS = 5;
const MAX_ROUND_SECONDS = 120;
const DEFAULT_QUESTIONS_COUNT = 5;
const MIN_QUESTIONS_COUNT = 3;
const MAX_QUESTIONS_COUNT = 15;
const POINTS = { oui: 3, presque: 1, non: 0 };
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const DEFAULT_ICEBREAKER_CHANCE = 0.45;
const MAX_ICEBREAKER_CHANCE = 0.8;
const ICEBREAKER_DURATION_MS = 20000;
const ICEBREAKER_RESULTS_DURATION_MS = 6000;
const AVATAR_KEYS = ['pigeon', 'stamp', 'envelope', 'seal', 'quill', 'compass'];

function normalizeAvatar(avatar) {
  return AVATAR_KEYS.includes(avatar) ? avatar : 'pigeon';
}

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

function pickRounds(count) {
  const shuffled = [...vocabBank].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map((item) => ({
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
    avatar: p.avatar,
    connected: p.connected,
    totalScore: p.totalScore,
  }));
}

function leaderboard(session) {
  return [...session.players.values()]
    .map((p) => ({ playerId: p.id, name: p.name, avatar: p.avatar, totalScore: p.totalScore }))
    .sort((a, b) => b.totalScore - a.totalScore);
}

function broadcastSessionUpdate(session) {
  io.to(session.code).emit('session:update', {
    phase: session.phase,
    hostName: session.hostName,
    players: publicPlayers(session),
  });
}

function createSession(hostSocketId, hostName, hostAvatar) {
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
    votes: new Map(), // `${roundIndex}:${answerPlayerId}:${voterPlayerId}` -> grade (only used in 'players' grading mode)
    playerOrder: [],
    reviewCursor: { roundIndex: 0, playerIdx: 0 },
    carnetEnabled: true,
    gradingMode: 'host', // 'host' | 'peers' | 'everyone'
    questionsCount: DEFAULT_QUESTIONS_COUNT,
    icebreakersEnabled: false,
    icebreakerChance: DEFAULT_ICEBREAKER_CHANCE,
    icebreakerTimer: null,
    currentIcebreaker: null,
    currentIcebreakerResults: null,
    icebreakerVotes: new Map(), // voterPlayerId -> { targetPlayerId, voterName } | { customText, voterName }
    lastIcebreakerTargetId: null,
    pendingAfterIcebreaker: null,
    icebreakerResultsLog: [], // vote-type icebreaker results, revealed at the end alongside the review
    icebreakerRevealIndex: 0,
    createdAt: Date.now(),
  };
  // the host plays too — they just also happen to grade the answers afterwards
  session.players.set(hostPlayerId, {
    id: hostPlayerId,
    name: trimmedHostName,
    avatar: normalizeAvatar(hostAvatar),
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

function joinSession(session, socketId, name, avatar) {
  const trimmed = (name || '').trim().slice(0, 24);
  if (!trimmed) return { error: 'Choisis un pseudo.' };
  if (session.phase !== 'lobby') return { error: 'La partie a déjà commencé.' };
  const nameTaken = [...session.players.values()].some(
    (p) => p.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (nameTaken) return { error: 'Ce pseudo est déjà pris dans cette partie.' };
  const id = makePlayerId();
  session.players.set(id, { id, name: trimmed, avatar: normalizeAvatar(avatar), socketId, connected: true, totalScore: 0 });
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

function eligibleVotersFor(session, answerPlayerId) {
  return session.playerOrder.filter((id) => {
    if (session.gradingMode === 'peers' && id === answerPlayerId) return false;
    const p = session.players.get(id);
    return p && p.connected;
  });
}

function reviewShowPayload(session) {
  const { roundIndex, playerIdx } = session.reviewCursor;
  const round = session.rounds[roundIndex];
  const playerId = session.playerOrder[playerIdx];
  const player = session.players.get(playerId);
  const key = `${roundIndex}:${playerId}`;
  const answer = session.answers.get(key);
  const gradeEntry = session.grades.get(key);
  const eligibleVoters = eligibleVotersFor(session, playerId);
  const votedPlayerIds = eligibleVoters.filter((id) => session.votes.has(`${key}:${id}`));
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
    playerAvatar: player ? player.avatar : null,
    answerText: answer ? answer.text : null,
    grade: gradeEntry ? gradeEntry.grade : null,
    points: gradeEntry ? gradeEntry.points : null,
    carnetEnabled: session.carnetEnabled,
    gradingMode: session.gradingMode,
    votedPlayerIds,
    votesNeeded: eligibleVoters.length,
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
      carnetEnabled: session.carnetEnabled,
    };
  }
  if (session.phase === 'review') {
    return reviewShowPayload(session);
  }
  if (session.phase === 'icebreaker') {
    return { phase: 'icebreaker', ...session.currentIcebreaker };
  }
  if (session.phase === 'icebreaker-results') {
    return { phase: 'icebreaker-results', ...session.currentIcebreakerResults };
  }
  if (session.phase === 'finished') {
    return { phase: 'finished', leaderboard: leaderboard(session) };
  }
  return { phase: session.phase };
}

function startSession(session, requesterSocketId, roundSeconds, carnetEnabled, gradingMode, icebreakersEnabled, questionsCount, funProportion) {
  if (requesterSocketId !== session.hostSocketId) return { error: 'Seul le chef peut lancer la partie.' };
  if (session.phase !== 'lobby') return { error: 'La partie a déjà commencé.' };
  if (session.players.size === 0) return { error: 'Attends au moins un joueur avant de lancer.' };
  const normalizedGradingMode = ['peers', 'everyone'].includes(gradingMode) ? gradingMode : 'host';
  if (normalizedGradingMode === 'peers' && session.players.size < 2) {
    return { error: 'Il faut au moins 2 joueurs pour que les autres joueurs notent.' };
  }
  const parsed = Number(roundSeconds);
  session.roundSeconds = Number.isFinite(parsed)
    ? Math.min(MAX_ROUND_SECONDS, Math.max(MIN_ROUND_SECONDS, Math.round(parsed)))
    : DEFAULT_ROUND_SECONDS;
  const parsedCount = Number(questionsCount);
  session.questionsCount = Number.isFinite(parsedCount)
    ? Math.min(MAX_QUESTIONS_COUNT, Math.max(MIN_QUESTIONS_COUNT, Math.round(parsedCount)))
    : DEFAULT_QUESTIONS_COUNT;
  const parsedFun = Number(funProportion);
  session.icebreakerChance = Number.isFinite(parsedFun)
    ? Math.min(MAX_ICEBREAKER_CHANCE, Math.max(0, parsedFun / 100))
    : DEFAULT_ICEBREAKER_CHANCE;
  session.carnetEnabled = carnetEnabled === undefined ? true : !!carnetEnabled;
  session.gradingMode = normalizedGradingMode;
  session.icebreakersEnabled = !!icebreakersEnabled;
  session.rounds = pickRounds(session.questionsCount);
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
    carnetEnabled: session.carnetEnabled,
  });
  clearTimeout(session.roundTimer);
  session.roundTimer = setTimeout(() => advanceAfterRound(session), session.roundSeconds * 1000);
}

function advanceAfterRound(session) {
  const next = session.currentRoundIndex + 1;
  const proceed = () => {
    if (next < session.rounds.length) {
      startRound(session, next);
    } else {
      startReview(session);
    }
  };
  maybeTriggerIcebreaker(session, proceed);
}

function maybeTriggerIcebreaker(session, next) {
  if (!session.icebreakersEnabled || session.playerOrder.length === 0 || Math.random() > session.icebreakerChance) {
    next();
    return;
  }
  const entry = icebreakerBank[Math.floor(Math.random() * icebreakerBank.length)];
  if (entry.type === 'vote') {
    startIcebreakerVote(session, entry, next);
  } else {
    startIcebreakerOpinion(session, entry, next);
  }
}

function armIcebreakerAdvance(session, advanceFn, durationMs) {
  const advance = () => {
    session.pendingAfterIcebreaker = null;
    clearTimeout(session.icebreakerTimer);
    advanceFn();
  };
  session.pendingAfterIcebreaker = advance;
  clearTimeout(session.icebreakerTimer);
  session.icebreakerTimer = setTimeout(advance, durationMs);
}

function startIcebreakerOpinion(session, entry, next) {
  const candidates = session.playerOrder.filter((id) => id !== session.lastIcebreakerTargetId);
  const pool = candidates.length > 0 ? candidates : session.playerOrder;
  const targetId = pool[Math.floor(Math.random() * pool.length)];
  const target = session.players.get(targetId);
  const targetName = target ? target.name : '???';
  session.lastIcebreakerTargetId = targetId;

  session.phase = 'icebreaker';
  session.currentIcebreaker = {
    type: 'opinion',
    targetPlayerId: targetId,
    targetName,
    text: entry.text.replace('{name}', targetName),
    deadline: Date.now() + ICEBREAKER_DURATION_MS,
  };
  io.to(session.code).emit('icebreaker:show', session.currentIcebreaker);
  armIcebreakerAdvance(session, () => {
    session.currentIcebreaker = null;
    next();
  }, ICEBREAKER_DURATION_MS);
}

function startIcebreakerVote(session, entry, next) {
  session.icebreakerVotes = new Map();
  const options = session.playerOrder
    .map((id) => session.players.get(id))
    .filter(Boolean)
    .map((p) => ({ id: p.id, name: p.name }));

  session.phase = 'icebreaker';
  session.currentIcebreaker = {
    type: 'vote',
    text: entry.text,
    options,
    votedPlayerIds: [],
    deadline: Date.now() + ICEBREAKER_DURATION_MS,
  };
  io.to(session.code).emit('icebreaker:show', session.currentIcebreaker);
  armIcebreakerAdvance(session, () => finishIcebreakerVote(session, next), ICEBREAKER_DURATION_MS);
}

function submitIcebreakerVote(session, socketId, { targetPlayerId, customText } = {}) {
  if (session.phase !== 'icebreaker' || !session.currentIcebreaker || session.currentIcebreaker.type !== 'vote') {
    return { error: "Ce n'est pas le moment de voter." };
  }
  const voter = findPlayerBySocket(session, socketId);
  if (!voter) return { error: 'Joueur inconnu.' };
  if (session.icebreakerVotes.has(voter.id)) return { error: 'Tu as déjà voté.' };

  const trimmedCustom = (customText || '').trim().slice(0, 120);
  if (targetPlayerId) {
    if (!session.players.has(targetPlayerId)) return { error: 'Choix invalide.' };
    session.icebreakerVotes.set(voter.id, { targetPlayerId, voterName: voter.name });
  } else if (trimmedCustom) {
    session.icebreakerVotes.set(voter.id, { customText: trimmedCustom, voterName: voter.name });
  } else {
    return { error: 'Choisis quelqu\'un ou écris une réponse.' };
  }

  session.currentIcebreaker.votedPlayerIds = [...session.icebreakerVotes.keys()];

  const requiredVoters = session.playerOrder.filter((id) => {
    const p = session.players.get(id);
    return p && p.connected;
  });
  const allVoted = requiredVoters.every((id) => session.icebreakerVotes.has(id));
  if (allVoted) {
    const advance = session.pendingAfterIcebreaker;
    if (advance) advance();
  } else {
    io.to(session.code).emit('icebreaker:show', session.currentIcebreaker);
  }
  return {};
}

function finishIcebreakerVote(session, next) {
  const tallyMap = new Map();
  const customAnswers = [];
  for (const vote of session.icebreakerVotes.values()) {
    if (vote.targetPlayerId) {
      tallyMap.set(vote.targetPlayerId, (tallyMap.get(vote.targetPlayerId) || 0) + 1);
    } else if (vote.customText) {
      customAnswers.push({ voterName: vote.voterName, text: vote.customText });
    }
  }
  const tally = session.playerOrder
    .map((id) => session.players.get(id))
    .filter(Boolean)
    .map((p) => ({ playerId: p.id, name: p.name, count: tallyMap.get(p.id) || 0 }))
    .sort((a, b) => b.count - a.count);

  // Don't reveal now — stash it and keep the round moving. It gets shown
  // during the end-of-game review, right alongside the translation reveal.
  session.icebreakerResultsLog.push({ text: session.currentIcebreaker.text, tally, customAnswers });
  session.currentIcebreaker = null;
  next();
}

function skipIcebreaker(session, requesterSocketId) {
  if (requesterSocketId !== session.hostSocketId) return { error: 'Seul le chef peut passer cette pause.' };
  if (session.phase !== 'icebreaker' && session.phase !== 'icebreaker-results') {
    return { error: "Ce n'est pas la phase de pause fun." };
  }
  clearTimeout(session.icebreakerTimer);
  const advance = session.pendingAfterIcebreaker;
  if (advance) advance();
  return {};
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
  if (session.phase !== 'review') return { error: "Ce n'est pas la phase de review." };
  if (!(grade in POINTS)) return { error: 'Note invalide.' };

  const { roundIndex, playerIdx } = session.reviewCursor;
  const answerPlayerId = session.playerOrder[playerIdx];
  const key = `${roundIndex}:${answerPlayerId}`;
  if (session.grades.has(key)) return { error: 'Déjà noté.' };

  if (session.gradingMode === 'peers' || session.gradingMode === 'everyone') {
    const voter = findPlayerBySocket(session, requesterSocketId);
    if (!voter) return { error: 'Joueur inconnu.' };
    if (session.gradingMode === 'peers' && voter.id === answerPlayerId) {
      return { error: 'Tu ne peux pas noter ta propre réponse dans ce mode.' };
    }
    const voteKey = `${key}:${voter.id}`;
    if (session.votes.has(voteKey)) return { error: 'Tu as déjà voté.' };
    session.votes.set(voteKey, grade);

    const eligibleVoters = eligibleVotersFor(session, answerPlayerId);
    const allVoted = eligibleVoters.every((id) => session.votes.has(`${key}:${id}`));
    if (!allVoted) {
      // let everyone see the vote count tick up while we wait on the rest
      emitReviewShow(session);
      return {};
    }

    const totalPoints = eligibleVoters.reduce((sum, id) => sum + POINTS[session.votes.get(`${key}:${id}`)], 0);
    const points = Math.round(totalPoints / eligibleVoters.length);
    session.grades.set(key, { grade: 'moyenne', points });
    const player = session.players.get(answerPlayerId);
    if (player) player.totalScore += points;

    io.to(session.code).emit('review:graded', { roundIndex, playerId: answerPlayerId, grade: null, points });
    setTimeout(() => advanceReviewCursor(session), 1400);
    return {};
  }

  if (requesterSocketId !== session.hostSocketId) return { error: 'Seul le chef peut noter.' };
  const player = session.players.get(answerPlayerId);
  const points = POINTS[grade];
  session.grades.set(key, { grade, points });
  if (player) player.totalScore += points;

  io.to(session.code).emit('review:graded', { roundIndex, playerId: answerPlayerId, grade, points });

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
  startIcebreakerReveal(session);
}

function startIcebreakerReveal(session) {
  session.icebreakerRevealIndex = 0;
  showNextIcebreakerReveal(session);
}

function showNextIcebreakerReveal(session) {
  if (session.icebreakerRevealIndex >= session.icebreakerResultsLog.length) {
    finishSession(session);
    return;
  }
  const result = session.icebreakerResultsLog[session.icebreakerRevealIndex];
  session.phase = 'icebreaker-results';
  session.currentIcebreakerResults = {
    ...result,
    index: session.icebreakerRevealIndex,
    total: session.icebreakerResultsLog.length,
  };
  io.to(session.code).emit('icebreaker:results', session.currentIcebreakerResults);

  armIcebreakerAdvance(session, () => {
    session.icebreakerRevealIndex += 1;
    session.currentIcebreakerResults = null;
    showNextIcebreakerReveal(session);
  }, ICEBREAKER_RESULTS_DURATION_MS);
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
      clearTimeout(session.icebreakerTimer);
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
  skipIcebreaker,
  submitIcebreakerVote,
  sendChatMessage,
  snapshotFor,
  broadcastSessionUpdate,
  disconnectSocket,
};
