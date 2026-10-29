// Fills the database with two demo users and a realistic board.
// Run with: npm run seed  (it wipes existing data first)
const bcrypt = require('bcryptjs');
const config = require('./config');
const { openDb } = require('./db');

const db = openDb(config.dbPath);

db.transaction(() => {
  db.exec('DELETE FROM activity; DELETE FROM tasks; DELETE FROM users;');
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('users','tasks','activity');");

  const addUser = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)');
  const demo = addUser.run('Demo User', 'demo@example.com', bcrypt.hashSync('demo1234', 10)).lastInsertRowid;
  const sara = addUser.run('Sara Khan', 'sara@example.com', bcrypt.hashSync('sara1234', 10)).lastInsertRowid;

  const tasks = [
    ['todo', 'Write onboarding guide for new members', 'Short guide covering board rules, labels and how we review work.', 'medium', sara, demo],
    ['todo', 'Add CSV export for the weekly report', 'Managers want to open the report in Excel.', 'high', demo, sara],
    ['todo', 'Collect feedback from site team', 'Two short calls, then a summary in the shared folder.', 'low', null, demo],
    ['todo', 'Refresh the landing page hero image', '', 'low', sara, sara],
    ['in_progress', 'Design new dashboard cards', 'Cards for open tasks, overdue items and this week.', 'high', sara, demo],
    ['in_progress', 'Fix login redirect on mobile Safari', 'After login the page sometimes stays on the form.', 'high', demo, sara],
    ['in_progress', 'Write tests for the tasks API', 'Cover create, update, move and delete.', 'medium', demo, demo],
    ['done', 'Set up project repository', 'Readme, license and basic folder structure.', 'medium', demo, demo],
    ['done', 'Choose colour palette and fonts', '', 'low', sara, sara],
    ['done', 'Database schema for users and tasks', 'SQLite with foreign keys and indexes.', 'medium', demo, demo],
  ];

  const position = { todo: 0, in_progress: 0, done: 0 };
  const addTask = db.prepare(
    `INSERT INTO tasks (title, description, priority, status, position, assignee_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?))`
  );
  const addActivity = db.prepare(
    "INSERT INTO activity (user_id, task_id, action, message, created_at) VALUES (?, ?, ?, ?, datetime('now', ?))"
  );

  tasks.forEach(([status, title, description, priority, assignee, creator], i) => {
    const age = `-${(tasks.length - i) * 37} minutes`;
    const later = `-${(tasks.length - i) * 37 - 12} minutes`;
    const touched = status === 'todo' ? age : later;
    const id = addTask.run(title, description, priority, status, position[status]++, assignee, creator, age, touched).lastInsertRowid;
    addActivity.run(creator, id, 'created', `created "${title}" in To do`, age);
    if (status !== 'todo') {
      const col = status === 'done' ? 'Done' : 'In progress';
      addActivity.run(assignee || creator, id, 'moved', `moved "${title}" to ${col}`, later);
    }
  });
})();

console.log('Seeded: demo@example.com / demo1234 and sara@example.com / sara1234 with 10 tasks');
db.close();
