const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const db = require('./server/db');
const { registerSocketHandlers } = require('./server/sockets');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/jouer', (req, res) => {
  res.sendFile(path.join(__dirname, 'jouer.html'));
});

app.use(express.static(__dirname));

registerSocketHandlers(io);

const PORT = process.env.PORT || 3000;

db.init()
  .catch((err) => console.error('[db] init failed', err))
  .finally(() => {
    server.listen(PORT, () => {
      console.log(`Listening on port ${PORT}`);
    });
  });
