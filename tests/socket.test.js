process.env.NODE_ENV = 'test';
const http = require('http');
const request = require('supertest');
const { io: connect } = require('socket.io-client');
const { makeApp, registerUser } = require('./helpers');
const { attachSocket } = require('../src/socket');

// Waits for one event, or fails after a timeout.
function once(socket, event, ms = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

describe('Socket.io live updates', () => {
  let server;
  let io;
  let app;
  let url;
  const clients = [];

  beforeAll(async () => {
    ({ app } = makeApp());
    server = http.createServer(app);
    io = attachSocket(server, app);
    await new Promise((resolve) => server.listen(0, resolve));
    url = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(() => {
    while (clients.length) clients.pop().close();
  });

  afterAll(async () => {
    io.close();
    await new Promise((resolve) => server.close(resolve));
  });

  function client(token) {
    const socket = connect(url, { auth: { token }, transports: ['websocket'], reconnection: false });
    clients.push(socket);
    return socket;
  }

  test('rejects a connection without a valid token', async () => {
    const socket = client('not-a-token');
    const err = await once(socket, 'connect_error');
    expect(err.message).toBe('unauthorized');
  });

  test('a task created over REST is broadcast to a connected client', async () => {
    const alice = await registerUser(app, { name: 'Alice' });
    const bob = await registerUser(app, { name: 'Bob' });

    const socket = client(bob.token);
    await once(socket, 'connect');

    const created = once(socket, 'task:created');
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ title: 'Ship the release', priority: 'high' });
    expect(res.status).toBe(201);

    const event = await created;
    expect(event.task).toMatchObject({ id: res.body.task.id, title: 'Ship the release', priority: 'high' });
    expect(event.by.name).toBe('Alice');
  });

  test('moves, deletes and activity are broadcast too', async () => {
    const alice = await registerUser(app, { name: 'Alice' });
    const socket = client(alice.token);
    await once(socket, 'connect');
    const auth = { Authorization: `Bearer ${alice.token}` };

    const task = (await request(app).post('/api/tasks').set(auth).send({ title: 'Move me' })).body.task;

    const moved = once(socket, 'task:moved');
    const activity = once(socket, 'activity:new');
    await request(app).patch(`/api/tasks/${task.id}`).set(auth).send({ status: 'done', position: 0 });
    const event = await moved;
    expect(event.task.status).toBe('done');
    expect(event.positions).toEqual(expect.arrayContaining([{ id: task.id, status: 'done', position: 0 }]));
    expect((await activity).message).toContain('moved "Move me" to Done');

    const deleted = once(socket, 'task:deleted');
    await request(app).delete(`/api/tasks/${task.id}`).set(auth);
    expect((await deleted).id).toBe(task.id);
  });

  test('presence lists online users and drops them on disconnect', async () => {
    const carol = await registerUser(app, { name: 'Carol' });
    const dan = await registerUser(app, { name: 'Dan' });

    const first = client(carol.token);
    await once(first, 'presence:update');

    const update = once(first, 'presence:update');
    const second = client(dan.token);
    const withDan = await update;
    expect(withDan.users.map((u) => u.name)).toEqual(expect.arrayContaining(['Carol', 'Dan']));

    const afterLeave = once(first, 'presence:update');
    second.close();
    const users = (await afterLeave).users.map((u) => u.name);
    expect(users).toContain('Carol');
    expect(users).not.toContain('Dan');
  });
});
