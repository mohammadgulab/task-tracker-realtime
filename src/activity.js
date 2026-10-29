const config = require('./config');

function logActivity(db, { userId, taskId = null, action, message }) {
  const info = db
    .prepare('INSERT INTO activity (user_id, task_id, action, message) VALUES (?, ?, ?, ?)')
    .run(userId, taskId, action, message);
  return getActivity(db, info.lastInsertRowid);
}

function getActivity(db, id) {
  return db
    .prepare(
      `SELECT a.id, a.task_id, a.action, a.message, a.created_at, u.id AS user_id, u.name AS user_name
       FROM activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.id = ?`
    )
    .get(id);
}

function recentActivity(db, limit = config.activityLimit) {
  return db
    .prepare(
      `SELECT a.id, a.task_id, a.action, a.message, a.created_at, u.id AS user_id, u.name AS user_name
       FROM activity a LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.id DESC LIMIT ?`
    )
    .all(limit);
}

module.exports = { logActivity, recentActivity };
