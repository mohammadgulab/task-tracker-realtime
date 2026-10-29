// Data access for tasks. Positions are kept as 0..n-1 inside each column.

const SELECT = `
  SELECT t.*, a.name AS assignee_name, c.name AS creator_name
  FROM tasks t
  LEFT JOIN users a ON a.id = t.assignee_id
  LEFT JOIN users c ON c.id = t.created_by
`;

function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    position: row.position,
    assignee: row.assignee_id ? { id: row.assignee_id, name: row.assignee_name } : null,
    created_by: { id: row.created_by, name: row.creator_name },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function listTasks(db) {
  return db.prepare(`${SELECT} ORDER BY t.status, t.position, t.id`).all().map(shape);
}

function getTask(db, id) {
  return shape(db.prepare(`${SELECT} WHERE t.id = ?`).get(id));
}

function columnIds(db, status, exceptId) {
  return db
    .prepare('SELECT id FROM tasks WHERE status = ? AND id != ? ORDER BY position, id')
    .all(status, exceptId || 0)
    .map((r) => r.id);
}

function writeOrder(db, status, ids) {
  const stmt = db.prepare('UPDATE tasks SET status = ?, position = ? WHERE id = ?');
  ids.forEach((id, index) => stmt.run(status, index, id));
}

function createTask(db, data, userId) {
  const next = db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM tasks WHERE status = ?')
    .get(data.status).pos;
  const info = db
    .prepare(
      `INSERT INTO tasks (title, description, priority, status, position, assignee_id, created_by)
       VALUES (@title, @description, @priority, @status, @position, @assignee_id, @created_by)`
    )
    .run({ ...data, position: next, created_by: userId });
  return getTask(db, info.lastInsertRowid);
}

// Updates fields and, if status or position changed, re-numbers the affected columns.
const updateTask = (db, id, changes) =>
  db.transaction(() => {
    const current = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!current) return null;

    const fields = ['title', 'description', 'priority', 'assignee_id'].filter((f) => f in changes);
    if (fields.length) {
      const sets = fields.map((f) => `${f} = @${f}`).join(', ');
      db.prepare(`UPDATE tasks SET ${sets} WHERE id = @id`).run({ ...changes, id });
    }

    const status = changes.status || current.status;
    const moved = status !== current.status || 'position' in changes;
    if (moved) {
      const target = columnIds(db, status, id);
      const index = 'position' in changes ? Math.min(changes.position, target.length) : target.length;
      target.splice(index, 0, id);
      writeOrder(db, status, target);
      if (status !== current.status) writeOrder(db, current.status, columnIds(db, current.status, id));
    }

    db.prepare("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?").run(id);
    return { task: getTask(db, id), previous: current, moved };
  })();

const deleteTask = (db, id) =>
  db.transaction(() => {
    const current = getTask(db, id);
    if (!current) return null;
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    writeOrder(db, current.status, columnIds(db, current.status, id));
    return current;
  })();

// Small summary of where every card sits, sent to clients after a move.
function positions(db) {
  return db.prepare('SELECT id, status, position FROM tasks ORDER BY status, position').all();
}

module.exports = { listTasks, getTask, createTask, updateTask, deleteTask, positions };
