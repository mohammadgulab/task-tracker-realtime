const express = require('express');
const bcrypt = require('bcryptjs');
const { registerSchema, loginSchema } = require('../validation');
const { signToken, requireAuth, publicUser } = require('../auth');
const { HttpError } = require('../errors');

const router = express.Router();

router.post('/register', (req, res) => {
  const { name, email, password } = registerSchema.parse(req.body);
  const db = req.app.locals.db;

  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    throw new HttpError(409, 'An account with this email already exists');
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run(name, email, hash);
  const user = publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid));

  res.status(201).json({ token: signToken(user), user });
});

router.post('/login', (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const row = req.app.locals.db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  // Same message for unknown email and wrong password, so emails can't be probed.
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    throw new HttpError(401, 'Email or password is incorrect');
  }

  const user = publicUser(row);
  res.json({ token: signToken(user), user });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
