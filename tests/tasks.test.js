process.env.NODE_ENV = 'test';
const request = require('supertest');
const { makeApp, registerUser } = require('./helpers');

describe('tasks API', () => {
  let app;
  let token;
  let user;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const create = (body) => request(app).post('/api/tasks').set(auth()).send(body);

  beforeEach(async () => {
    ({ app } = makeApp());
    ({ token, user } = await registerUser(app, { name: 'Owner' }));
  });

  test('every task route needs a token (401)', async () => {
    const calls = [
      request(app).get('/api/tasks'),
      request(app).post('/api/tasks').send({ title: 'x' }),
      request(app).patch('/api/tasks/1').send({ title: 'x' }),
      request(app).delete('/api/tasks/1'),
      request(app).get('/api/activity'),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(401);
  });

  test('creates a task with defaults', async () => {
    const res = await create({ title: '  Plan sprint  ' });
    expect(res.status).toBe(201);
    expect(res.body.task).toMatchObject({
      title: 'Plan sprint',
      description: '',
      priority: 'medium',
      status: 'todo',
      position: 0,
      assignee: null,
      created_by: { id: user.id, name: 'Owner' },
    });
  });

  test('new tasks go to the end of their column', async () => {
    await create({ title: 'A' });
    await create({ title: 'B' });
    const c = await create({ title: 'C' });
    expect(c.body.task.position).toBe(2);
  });

  test('validates title, priority and status', async () => {
    const res = await create({ title: '', priority: 'urgent', status: 'later' });
    expect(res.status).toBe(400);
    const fields = res.body.details.map((d) => d.field).sort();
    expect(fields).toEqual(['priority', 'status', 'title']);
  });

  test('rejects an assignee that does not exist', async () => {
    const res = await create({ title: 'X', assignee_id: 999 });
    expect(res.status).toBe(400);
    expect(res.body.details[0].field).toBe('assignee_id');
  });

  test('lists tasks ordered by column and position', async () => {
    const other = await registerUser(app, { name: 'Helper' });
    await create({ title: 'One', assignee_id: other.user.id });
    await create({ title: 'Two', status: 'done', priority: 'high' });
    const res = await request(app).get('/api/tasks').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(2);
    expect(res.body.tasks.find((t) => t.title === 'One').assignee.name).toBe('Helper');
  });

  test('edits fields with PATCH', async () => {
    const { body } = await create({ title: 'Old title' });
    const res = await request(app)
      .patch(`/api/tasks/${body.task.id}`)
      .set(auth())
      .send({ title: 'New title', priority: 'high', description: 'Details' });
    expect(res.status).toBe(200);
    expect(res.body.task).toMatchObject({ title: 'New title', priority: 'high', description: 'Details' });
  });

  test('moves a task to another column at a given position and renumbers both columns', async () => {
    const a = (await create({ title: 'A' })).body.task;
    const b = (await create({ title: 'B' })).body.task;
    const c = (await create({ title: 'C' })).body.task;
    const d = (await create({ title: 'D', status: 'done' })).body.task;

    const res = await request(app)
      .patch(`/api/tasks/${b.id}`)
      .set(auth())
      .send({ status: 'done', position: 0 });
    expect(res.status).toBe(200);
    expect(res.body.task).toMatchObject({ status: 'done', position: 0 });

    const all = (await request(app).get('/api/tasks').set(auth())).body.tasks;
    const pos = Object.fromEntries(all.map((t) => [t.id, [t.status, t.position]]));
    expect(pos[a.id]).toEqual(['todo', 0]);
    expect(pos[c.id]).toEqual(['todo', 1]);
    expect(pos[b.id]).toEqual(['done', 0]);
    expect(pos[d.id]).toEqual(['done', 1]);
  });

  test('reorders inside the same column', async () => {
    const a = (await create({ title: 'A' })).body.task;
    await create({ title: 'B' });
    const c = (await create({ title: 'C' })).body.task;
    await request(app).patch(`/api/tasks/${c.id}`).set(auth()).send({ position: 0 });
    const all = (await request(app).get('/api/tasks').set(auth())).body.tasks;
    expect(all.map((t) => t.title)).toEqual(['C', 'A', 'B']);
    expect(all.find((t) => t.id === a.id).position).toBe(1);
  });

  test('a position past the end is clamped', async () => {
    const a = (await create({ title: 'A' })).body.task;
    const res = await request(app)
      .patch(`/api/tasks/${a.id}`)
      .set(auth())
      .send({ status: 'in_progress', position: 50 });
    expect(res.body.task.position).toBe(0);
  });

  test('PATCH rejects an empty body and unknown fields', async () => {
    const a = (await create({ title: 'A' })).body.task;
    const empty = await request(app).patch(`/api/tasks/${a.id}`).set(auth()).send({});
    expect(empty.status).toBe(400);
    const extra = await request(app).patch(`/api/tasks/${a.id}`).set(auth()).send({ owner: 1 });
    expect(extra.status).toBe(400);
  });

  test('404 for a task that does not exist, 400 for a bad id', async () => {
    expect((await request(app).patch('/api/tasks/999').set(auth()).send({ title: 'x' })).status).toBe(404);
    expect((await request(app).delete('/api/tasks/999').set(auth())).status).toBe(404);
    expect((await request(app).get('/api/tasks/abc').set(auth())).status).toBe(400);
  });

  test('deletes a task and closes the gap in its column', async () => {
    const a = (await create({ title: 'A' })).body.task;
    const b = (await create({ title: 'B' })).body.task;
    const res = await request(app).delete(`/api/tasks/${a.id}`).set(auth());
    expect(res.status).toBe(204);
    const all = (await request(app).get('/api/tasks').set(auth())).body.tasks;
    expect(all).toEqual([expect.objectContaining({ id: b.id, position: 0 })]);
  });

  test('activity feed records changes newest first', async () => {
    const a = (await create({ title: 'Write docs' })).body.task;
    await request(app).patch(`/api/tasks/${a.id}`).set(auth()).send({ status: 'done' });
    await request(app).delete(`/api/tasks/${a.id}`).set(auth());

    const res = await request(app).get('/api/activity?limit=10').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.activity.map((x) => x.action)).toEqual(['deleted', 'moved', 'created']);
    expect(res.body.activity[1].message).toBe('moved "Write docs" to Done');
    expect(res.body.activity[0].user_name).toBe('Owner');
  });

  test('activity limit is validated', async () => {
    const res = await request(app).get('/api/activity?limit=0').set(auth());
    expect(res.status).toBe(400);
  });
});
