const request = require('supertest');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');

// Fresh in-memory app for each test file.
function makeApp() {
  const db = openDb(':memory:');
  const app = createApp({ db });
  return { app, db };
}

async function registerUser(app, overrides = {}) {
  const body = {
    name: 'Test User',
    email: `user${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: 'secret123',
    ...overrides,
  };
  const res = await request(app).post('/api/auth/register').send(body);
  return { ...res.body, password: body.password };
}

module.exports = { makeApp, registerUser };
