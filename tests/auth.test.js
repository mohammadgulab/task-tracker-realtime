process.env.NODE_ENV = 'test';
const request = require('supertest');
const { makeApp, registerUser } = require('./helpers');

describe('auth', () => {
  let app;
  beforeEach(() => {
    ({ app } = makeApp());
  });

  test('registers a user and returns a token without the password hash', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Amina', email: 'Amina@Example.com', password: 'secret123' });

    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ name: 'Amina', email: 'amina@example.com' });
    expect(res.body.user.password_hash).toBeUndefined();
  });

  test('rejects a duplicate email (case insensitive) with 409', async () => {
    await registerUser(app, { email: 'dup@example.com' });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Other', email: 'DUP@example.com', password: 'secret123' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/);
  });

  test('returns field errors for invalid register input', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'A', email: 'not-an-email', password: '123' });
    expect(res.status).toBe(400);
    const fields = res.body.details.map((d) => d.field).sort();
    expect(fields).toEqual(['email', 'name', 'password']);
  });

  test('logs in with the right password', async () => {
    await registerUser(app, { email: 'login@example.com', password: 'secret123' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
  });

  test('rejects a wrong password and an unknown email with the same 401', async () => {
    await registerUser(app, { email: 'login@example.com', password: 'secret123' });
    const wrong = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'nope-nope' });
    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@example.com', password: 'secret123' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toBe(unknown.body.error);
  });

  test('GET /me returns the current user', async () => {
    const { token } = await registerUser(app, { name: 'Me Myself', email: 'me@example.com' });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ name: 'Me Myself', email: 'me@example.com' });
  });

  test('GET /me needs a valid token', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    const bad = await request(app).get('/api/auth/me').set('Authorization', 'Bearer abc.def.ghi');
    expect(bad.status).toBe(401);
  });

  test('bad JSON gets a clear 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JSON/);
  });

  test('unknown API routes return JSON 404', async () => {
    const res = await request(app).get('/api/nothing-here');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Route not found/);
  });
});
