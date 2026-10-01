const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const session = require('express-session');
const { startApp } = require('./helpers');
const { verifyCsrf, issueCsrfToken } = require('../src/middleware/csrf');

// Same order as server.js: session, then verifyCsrf in front of every route.
let app;
beforeEach(async () => {
  app = await startApp((a) => {
    a.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
    a.use(verifyCsrf);
    a.get('/api/csrf-token', (req, res) => res.json({ csrfToken: issueCsrfToken(req) }));
    a.post('/api/certificates', (req, res) => res.json({ ok: true }));
    a.delete('/api/certificates/x', (req, res) => res.json({ ok: true }));
    a.post('/api/auth/login', (req, res) => res.json({ ok: true }));
  });
});
afterEach(() => app.close());

// Fetch a token, returning it with the session cookie it belongs to.
async function getToken() {
  const res = await fetch(`${app.url}/api/csrf-token`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { csrfToken } = await res.json();
  return { cookie, csrfToken };
}

const post = (path, { cookie, token, body } = {}, method = 'POST') => fetch(`${app.url}${path}`, {
  method,
  headers: {
    'content-type': 'application/json',
    ...(cookie && { cookie }),
    ...(token && { 'x-csrf-token': token })
  },
  body: JSON.stringify(body || {})
});

test('rejects a state-changing request with no session or token', async () => {
  const res = await post('/api/certificates');
  assert.strictEqual(res.status, 403);
  assert.strictEqual((await res.json()).code, 'CSRF_INVALID');
});

test('rejects a request with a session but no token (the cross-site case)', async () => {
  const { cookie } = await getToken();
  const res = await post('/api/certificates', { cookie });
  assert.strictEqual(res.status, 403);
});

test('rejects a forged token', async () => {
  const { cookie } = await getToken();
  const res = await post('/api/certificates', { cookie, token: 'not-a-real-token' });
  assert.strictEqual(res.status, 403);
});

test("rejects a valid token from another session", async () => {
  const mine = await getToken();
  const theirs = await getToken();
  const res = await post('/api/certificates', { cookie: mine.cookie, token: theirs.csrfToken });
  assert.strictEqual(res.status, 403);
});

test('accepts a valid token in the X-CSRF-Token header', async () => {
  const { cookie, csrfToken } = await getToken();
  const res = await post('/api/certificates', { cookie, token: csrfToken });
  assert.strictEqual(res.status, 200);
});

test('accepts a valid token in the _csrf body field', async () => {
  const { cookie, csrfToken } = await getToken();
  const res = await post('/api/certificates', { cookie, body: { _csrf: csrfToken } });
  assert.strictEqual(res.status, 200);
});

test('protects DELETE as well as POST', async () => {
  const { cookie, csrfToken } = await getToken();
  assert.strictEqual((await post('/api/certificates/x', { cookie }, 'DELETE')).status, 403);
  assert.strictEqual((await post('/api/certificates/x', { cookie, token: csrfToken }, 'DELETE')).status, 200);
});

test('lets safe methods and the login POST through without a token', async () => {
  assert.strictEqual((await fetch(`${app.url}/api/csrf-token`)).status, 200);
  assert.strictEqual((await post('/api/auth/login')).status, 200);
});
