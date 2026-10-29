const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../auth');
const { recentActivity } = require('../activity');

const router = express.Router();

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

router.get('/', requireAuth, (req, res) => {
  const { limit } = querySchema.parse(req.query);
  res.json({ activity: recentActivity(req.app.locals.db, limit) });
});

module.exports = router;
