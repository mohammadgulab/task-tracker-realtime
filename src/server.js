const http = require('http');
const config = require('./config');
const { openDb } = require('./db');
const { createApp } = require('./app');
const { attachSocket } = require('./socket');

const db = openDb(config.dbPath);
const app = createApp({ db });
const server = http.createServer(app);
attachSocket(server, app);

server.listen(config.port, () => {
  console.log(`Task board running on http://localhost:${config.port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
