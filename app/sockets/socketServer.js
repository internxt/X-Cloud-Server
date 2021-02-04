const io = require('socket.io');
const StorageListener = require('./storage');

module.exports = (App, Service) => {
  const socketServer = io(App.instance, {
    path: '/api/sockets',
    cors: {
      origin: '*'
    },
    pingTimeout: 40000000
  });
  socketServer.on('connection', (socket) => {
    App.logger.info('Socket connected!');
    StorageListener(App, Service, socket);
  });
};
