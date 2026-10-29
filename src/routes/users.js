const express = require('express');
const { requireAuth } = require('../auth');

const router = express.Router();

// Team members, used for the assignee picker.
router.get('/', requireAuth, (req, res) => {
  const users = req.app.locals.db
    .prepare('SELECT id, name, email FROM users ORDER BY name')
    .all();
  res.json({ users });
});

module.exports = router;
