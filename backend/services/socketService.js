let io;
const { verifyToken } = require('./tokenService');

function init(server) {
  const SocketIO = require('socket.io');
  io = new SocketIO.Server(server, { cors: { origin: '*' } });

  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next();
    const payload = verifyToken(token);
    if (!payload) return next(new Error('Authentication error'));
    socket.user = payload;
    next();
  });

  io.on('connection', (socket) => {
    if (socket.user && socket.user.id) {
      socket.join(String(socket.user.id));
    }
    // If the connected user is an admin, join a shared 'admins' room
    try {
      if (socket.user && socket.user.role && String(socket.user.role).toLowerCase() === 'admin') {
        socket.join('admins');
      }
    } catch (e) { }
    socket.on('disconnect', () => {});
  });
}

function getIO() {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
}

function emitToUser(userId, event, payload) {
  if (!io) return;
  io.to(String(userId)).emit(event, payload);
}
function emitToAdmins(event, payload) {
  if (!io) return;
  io.to('admins').emit(event, payload);
}
module.exports = { init, getIO, emitToUser, emitToAdmins };
