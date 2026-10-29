// Routes that must never be open without a login: the settings API and
// mkcert -uninstall. OIDC is only mounted when ENABLE_AUTH=true (server.js),
// and requireAuth is a no-op without it, so ENABLE_OIDC alone protects nothing.
// Each guard must therefore key on auth.enabled, not on the OIDC flag.
const { test, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const session = require('express-session');
const { startApp } = require('./helpers');
const security = require('../src/security');
const { createRequireAuth } = require('../src/utils/authState');
const createSettingsRoutes = require('../src/routes/settings');

const noRateLimit = (req, res, next) => next();
const rateLimiters = { generalRateLimiter: noRateLimit, apiRateLimiter: noRateLimit, cliRateLimiter: noRateLimit };

const OIDC_ONLY = { auth: { enabled: false }, oidc: { enabled: true, issuer: 'https://login.dev.local', clientId: 'x', clientSecret: 'y' } };
const AUTH_ON = { auth: { enabled: true }, oidc: { enabled: false } };

// Record every mkcert/openssl call instead of running it.
const calls = [];
const realRunTool = security.runTool;
const realExecute = security.executeCommand;
security.runTool = async (tool, args) => { calls.push([tool, ...args].join(' ')); return { stdout: '', stderr: '' }; };
security.executeCommand = async (cmd) => { calls.push(cmd); return { stdout: '', stderr: '' }; };
after(() => { security.runTool = realRunTool; security.executeCommand = realExecute; });
// system.js destructures runTool when it loads, so load it after the stub.
delete require.cache[require.resolve('../src/routes/system')];
const { createSystemRoutes } = require('../src/routes/system');
const { createCertificateRoutes } = require('../src/routes/certificates');

// Same wiring as server.js: session, a way to log in, requireAuth from config.
async function withApp(config, mount, fn) {
  const app = await startApp((a) => {
    a.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
    a.post('/test-login', (req, res) => { req.session.authenticated = true; req.session.username = 'demo'; res.json({ ok: true }); });
    mount(a, createRequireAuth(config.auth.enabled));
  });
  try { return await fn(app); } finally { await app.close(); }
}

async function login(app) {
  const res = await fetch(app.url + '/test-login', { method: 'POST' });
  return res.headers.get('set-cookie').split(';')[0];
}


test('settings API: OIDC configured but ENABLE_AUTH off is refused (GET and POST)', async () => {
  await withApp(OIDC_ONLY, (a, ra) => a.use('/api/settings', createSettingsRoutes(OIDC_ONLY, rateLimiters, ra)), async (app) => {
    const get = await fetch(app.url + '/api/settings');
    assert.strictEqual(get.status, 403);
    assert.match((await get.json()).error, /ENABLE_AUTH=true/);
    const post = await fetch(app.url + '/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: { mode: 'dark' } })
    });
    assert.strictEqual(post.status, 403);
    for (const p of ['/running', '/export']) assert.strictEqual((await fetch(app.url + '/api/settings' + p)).status, 403, p);
  });
});

test('settings API: auth enabled without a session is 401', async () => {
  await withApp(AUTH_ON, (a, ra) => a.use('/api/settings', createSettingsRoutes(AUTH_ON, rateLimiters, ra)), async (app) => {
    const res = await fetch(app.url + '/api/settings');
    assert.strictEqual(res.status, 401);
    assert.strictEqual((await res.json()).redirectTo, '/login');
  });
});

test('settings API: auth enabled with a session is 200', async () => {
  await withApp(AUTH_ON, (a, ra) => a.use('/api/settings', createSettingsRoutes(AUTH_ON, rateLimiters, ra)), async (app) => {
    const cookie = await login(app);
    const res = await fetch(app.url + '/api/settings/running', { headers: { cookie } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).success, true);
  });
});

test('POST /api/uninstall-ca: OIDC configured but ENABLE_AUTH off is refused and never runs', async () => {
  calls.length = 0;
  await withApp(OIDC_ONLY, (a, ra) => a.use(createSystemRoutes(OIDC_ONLY, rateLimiters, ra)), async (app) => {
    const res = await fetch(app.url + '/api/uninstall-ca', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true })
    });
    assert.strictEqual(res.status, 403);
    assert.match((await res.json()).error, /ENABLE_AUTH=true/);
  });
  assert.deepStrictEqual(calls, []);
});

test('POST /api/uninstall-ca: auth enabled needs a session, then runs with confirm', async () => {
  calls.length = 0;
  await withApp(AUTH_ON, (a, ra) => a.use(createSystemRoutes(AUTH_ON, rateLimiters, ra)), async (app) => {
    const body = JSON.stringify({ confirm: true });
    const headers = { 'Content-Type': 'application/json' };
    assert.strictEqual((await fetch(app.url + '/api/uninstall-ca', { method: 'POST', headers, body })).status, 401);
    assert.deepStrictEqual(calls, []);
    const cookie = await login(app);
    const res = await fetch(app.url + '/api/uninstall-ca', { method: 'POST', headers: { ...headers, cookie }, body });
    assert.strictEqual(res.status, 200);
  });
  assert.deepStrictEqual(calls, ['mkcert -uninstall']);
});

test('POST /api/execute uninstall-ca: OIDC configured but ENABLE_AUTH off is refused and never runs', async () => {
  calls.length = 0;
  await withApp(OIDC_ONLY, (a, ra) => a.use(createCertificateRoutes(OIDC_ONLY, rateLimiters, ra, { get() {}, set() {}, remove() {} })), async (app) => {
    const res = await fetch(app.url + '/api/execute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'uninstall-ca', confirm: true })
    });
    assert.strictEqual(res.status, 403);
  });
  assert.deepStrictEqual(calls, []);
});

test('createRequireAuth: a no-op when auth is off, 401 without a session when on', async () => {
  const run = (enabled, req) => new Promise((resolve) => {
    const res = { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    createRequireAuth(enabled)(req, res, () => resolve('next'));
  });
  assert.strictEqual(await run(false, {}), 'next');
  assert.strictEqual((await run(true, { session: {} })).code, 401);
  assert.strictEqual(await run(true, { session: { authenticated: true } }), 'next');
});
