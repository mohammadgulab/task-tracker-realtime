const express = require('express');
const { requireAuth } = require('../auth');
const { createTaskSchema, updateTaskSchema, idParam } = require('../validation');
const { HttpError } = require('../errors');
const tasks = require('../tasks');
const { logActivity } = require('../activity');

const router = express.Router();
router.use(requireAuth);

const COLUMN_NAMES = { todo: 'To do', in_progress: 'In progress', done: 'Done' };

function checkAssignee(db, assigneeId) {
  if (assigneeId == null) return;
  if (!db.prepare('SELECT id FROM users WHERE id = ?').get(assigneeId)) {
    throw new HttpError(400, 'Validation failed', [
      { field: 'assignee_id', message: 'Assignee does not exist' },
    ]);
  }
}

function loadId(req) {
  const parsed = idParam.safeParse(req.params.id);
  if (!parsed.success) throw new HttpError(400, 'Task id must be a positive number');
  return parsed.data;
}

router.get('/', (req, res) => {
  res.json({ tasks: tasks.listTasks(req.app.locals.db) });
});

router.get('/:id', (req, res) => {
  const task = tasks.getTask(req.app.locals.db, loadId(req));
  if (!task) throw new HttpError(404, 'Task not found');
  res.json({ task });
});

router.post('/', (req, res) => {
  const db = req.app.locals.db;
  const data = createTaskSchema.parse(req.body);
  checkAssignee(db, data.assignee_id);

  const task = tasks.createTask(db, data, req.user.id);
  const activity = logActivity(db, {
    userId: req.user.id,
    taskId: task.id,
    action: 'created',
    message: `created "${task.title}" in ${COLUMN_NAMES[task.status]}`,
  });

  const broadcast = req.app.locals.broadcast;
  broadcast('task:created', { task, by: req.user });
  broadcast('activity:new', activity);
  res.status(201).json({ task });
});

router.patch('/:id', (req, res) => {
  const db = req.app.locals.db;
  const id = loadId(req);
  const changes = updateTaskSchema.parse(req.body);
  if ('assignee_id' in changes) checkAssignee(db, changes.assignee_id);

  const result = tasks.updateTask(db, id, changes);
  if (!result) throw new HttpError(404, 'Task not found');
  const { task, previous, moved } = result;

  const message =
    previous.status !== task.status
      ? `moved "${task.title}" to ${COLUMN_NAMES[task.status]}`
      : moved && Object.keys(changes).length === 1
        ? `reordered "${task.title}" in ${COLUMN_NAMES[task.status]}`
        : `updated "${task.title}"`;
  const activity = logActivity(db, {
    userId: req.user.id,
    taskId: task.id,
    action: previous.status !== task.status ? 'moved' : 'updated',
    message,
  });

  const broadcast = req.app.locals.broadcast;
  if (moved) {
    broadcast('task:moved', { task, positions: tasks.positions(db), by: req.user });
  } else {
    broadcast('task:updated', { task, by: req.user });
  }
  broadcast('activity:new', activity);
  res.json({ task });
});

router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  const id = loadId(req);
  const task = tasks.deleteTask(db, id);
  if (!task) throw new HttpError(404, 'Task not found');

  const activity = logActivity(db, {
    userId: req.user.id,
    taskId: null,
    action: 'deleted',
    message: `deleted "${task.title}"`,
  });

  const broadcast = req.app.locals.broadcast;
  broadcast('task:deleted', { id, by: req.user });
  broadcast('activity:new', activity);
  res.status(204).end();
});

module.exports = router;
