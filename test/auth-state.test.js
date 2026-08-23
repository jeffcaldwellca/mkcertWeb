const { test } = require('node:test');
const assert = require('node:assert');
const { getAuthState } = require('../src/utils/authState');

test('basic-auth session is authenticated with its username', () => {
  const req = { session: { authenticated: true, username: 'admin' } };
  assert.deepStrictEqual(getAuthState(req), { authenticated: true, username: 'admin' });
});

test('OIDC (passport) login is authenticated even without session.authenticated (#43)', () => {
  const req = {
    session: { passport: { user: { id: 'abc' } } },
    user: { id: 'abc', name: 'Jane', email: 'jane@example.test', provider: 'oidc' },
    isAuthenticated: () => true
  };
  assert.deepStrictEqual(getAuthState(req), { authenticated: true, username: 'Jane' });
});

test('OIDC user falls back to email when no display name', () => {
  const req = {
    session: {},
    user: { id: 'abc', name: undefined, email: 'jane@example.test', provider: 'oidc' },
    isAuthenticated: () => true
  };
  assert.deepStrictEqual(getAuthState(req), { authenticated: true, username: 'jane@example.test' });
});

test('no session and no passport user is unauthenticated', () => {
  assert.deepStrictEqual(getAuthState({ session: {} }), { authenticated: false, username: null });
  assert.deepStrictEqual(getAuthState({}), { authenticated: false, username: null });
});

test('passport user present but isAuthenticated() false is unauthenticated', () => {
  const req = { session: {}, user: { name: 'x' }, isAuthenticated: () => false };
  assert.deepStrictEqual(getAuthState(req), { authenticated: false, username: null });
});

// Integration: a real passport req.login() (what the OIDC callback does) must
// be reported as authenticated by a status endpoint built on getAuthState.
test('passport req.login() session is reported authenticated on a later request', async () => {
  const session = require('express-session');
  const passport = require('passport');
  const { startApp } = require('./helpers');

  const pp = new passport.Passport();
  pp.serializeUser((u, done) => done(null, u));
  pp.deserializeUser((u, done) => done(null, u));

  const app = await startApp((a) => {
    a.use(session({ secret: 't', resave: false, saveUninitialized: false }));
    a.use(pp.initialize());
    a.use(pp.session());
    a.get('/fake-oidc-callback', (req, res) => {
      req.login({ id: '1', name: 'Jane', provider: 'oidc' }, (err) => {
        if (err) return res.status(500).end();
        res.json({ ok: true });
      });
    });
    a.get('/api/auth/status', (req, res) => res.json({ ...getAuthState(req), authEnabled: true }));
  });
  try {
    const login = await fetch(`${app.url}/fake-oidc-callback`);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const status = await fetch(`${app.url}/api/auth/status`, { headers: { cookie } });
    assert.deepStrictEqual(await status.json(), { authenticated: true, username: 'Jane', authEnabled: true });
  } finally {
    await app.close();
  }
});

test('rate limiter keys OIDC users by their display name, not "anonymous"', () => {
  // Mirrors the keyGenerator in src/middleware/rateLimiting.js
  const req = { session: {}, user: { id: '1', name: 'Jane', provider: 'oidc' }, isAuthenticated: () => true };
  assert.strictEqual(getAuthState(req).username || 'anonymous', 'Jane');
});

test('isAuthenticated() agrees with getAuthState() for every request shape', () => {
  const { isAuthenticated } = require('../src/utils/authState');
  const shapes = [
    {},
    { session: {} },
    { session: { authenticated: true, username: 'admin' } },
    { session: {}, user: { name: 'x' }, isAuthenticated: () => true },
    { session: {}, user: { name: 'x' }, isAuthenticated: () => false }
  ];
  for (const req of shapes) {
    assert.strictEqual(isAuthenticated(req), getAuthState(req).authenticated);
  }
});
