const gameManager = require('./gameManager');

function registerSocketHandlers(io) {
  gameManager.attach(io);

  io.on('connection', (socket) => {
    socket.on('session:create', ({ hostName } = {}, ack) => {
      const session = gameManager.createSession(socket.id, hostName);
      socket.join(session.code);
      ack && ack({ code: session.code, playerId: session.hostPlayerId });
      gameManager.broadcastSessionUpdate(session);
    });

    socket.on('session:join', ({ code, name } = {}, ack) => {
      const session = gameManager.getSession(code);
      if (!session) return ack && ack({ error: 'Code de partie introuvable.' });
      const result = gameManager.joinSession(session, socket.id, name);
      if (result.error) return ack && ack({ error: result.error });
      socket.join(session.code);
      ack && ack({ playerId: result.playerId, snapshot: gameManager.snapshotFor(session) });
      gameManager.broadcastSessionUpdate(session);
    });

    socket.on('session:rejoin', ({ code, name } = {}, ack) => {
      const session = gameManager.getSession(code);
      if (!session) return ack && ack({ error: 'Code de partie introuvable.' });
      const result = gameManager.rejoinSession(session, socket.id, name);
      if (result.error) return ack && ack({ error: result.error });
      socket.join(session.code);
      ack && ack({ playerId: result.playerId, snapshot: gameManager.snapshotFor(session) });
      gameManager.broadcastSessionUpdate(session);
    });

    socket.on('session:start', ({ code, roundSeconds } = {}, ack) => {
      const session = gameManager.getSession(code);
      if (!session) return ack && ack({ error: 'Code de partie introuvable.' });
      const result = gameManager.startSession(session, socket.id, roundSeconds);
      ack && ack(result);
    });

    socket.on('answer:submit', ({ code, text } = {}, ack) => {
      const session = gameManager.getSession(code);
      if (!session) return ack && ack({ error: 'Code de partie introuvable.' });
      const result = gameManager.submitAnswer(session, socket.id, text);
      ack && ack(result);
    });

    socket.on('review:grade', ({ code, grade } = {}, ack) => {
      const session = gameManager.getSession(code);
      if (!session) return ack && ack({ error: 'Code de partie introuvable.' });
      const result = gameManager.gradeAnswer(session, socket.id, grade);
      ack && ack(result);
    });

    socket.on('chat:send', ({ code, text } = {}, ack) => {
      const session = gameManager.getSession(code);
      if (!session) return ack && ack({ error: 'Code de partie introuvable.' });
      const result = gameManager.sendChatMessage(session, socket.id, text);
      ack && ack(result);
    });

    socket.on('disconnect', () => {
      gameManager.disconnectSocket(socket.id);
    });
  });
}

module.exports = { registerSocketHandlers };
