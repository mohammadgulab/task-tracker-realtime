const { Server } = require('socket.io');
const { verifyToken, publicUser } = require('./auth');

// Attaches Socket.io to an HTTP server. Clients must send their JWT in the handshake:
//   io({ auth: { token } })
function attachSocket(httpServer, app) {
  const db = app.locals.db;
  const io = new Server(httpServer, { cors: { origin: false } });

  // userId -> { user, sockets }
  const online = new Map();

  const onlineList = () =>
    [...online.values()].map((o) => o.user).sort((a, b) => a.name.localeCompare(b.name));

  io.use((socket, next) => {
    const userId = verifyToken(socket.handshake.auth && socket.handshake.auth.token);
    const row = userId && db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!row) return next(new Error('unauthorized'));
    const user = publicUser(row);
    socket.data.user = { id: user.id, name: user.name };
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    const entry = online.get(user.id) || { user, sockets: 0 };
    entry.sockets += 1;
    online.set(user.id, entry);
    socket.join('board');
    io.to('board').emit('presence:update', { users: onlineList() });

    socket.on('disconnect', () => {
      const current = online.get(user.id);
      if (!current) return;
      current.sockets -= 1;
      if (current.sockets <= 0) online.delete(user.id);
      io.to('board').emit('presence:update', { users: onlineList() });
    });
  });

  app.locals.broadcast = (event, payload) => io.to('board').emit(event, payload);
  return io;
}

module.exports = { attachSocket };
