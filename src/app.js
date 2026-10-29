const path = require('path');
const express = require('express');
const { notFound, errorHandler } = require('./errors');

// Builds the Express app. The database is passed in so tests can use their own.
function createApp({ db }) {
  const app = express();
  app.disable('x-powered-by');
  app.locals.db = db;
  // Replaced by the socket layer once it is attached; a no-op keeps REST usable alone.
  app.locals.broadcast = () => {};

  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/tasks', require('./routes/tasks'));
  app.use('/api/activity', require('./routes/activity'));
  app.use('/api/users', require('./routes/users'));

  app.use('/api', notFound);
  // Anything else is the single page app.
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
