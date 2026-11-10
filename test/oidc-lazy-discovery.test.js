// OIDC discovery must not be a one-shot at boot (#59). If the provider is
// down when mkcert-web starts, the strategy is registered later, on the first
// /auth/oidc request that finds the provider reachable, and until then SSO
// attempts land back on the login page instead of a 500.
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const passport = require('passport');
const { startApp } = require('./helpers');
const { createOidcManager } = require('../src/utils/oidcStrategy');

const quiet = { log() {}, warn() {}, error() {} };

// A fake identity provider whose discovery endpoint can be switched between
// down (503), up (valid document) and hanging (never answers).
async function startProvider() {
  const state = { mode: 'down', hits: 0 };
  const server = http.createServer((req, res) => {
    if (req.url !== '/.well-known/openid-configuration') {
      res.writeHead(404).end();
      return;
    }
    state.hits += 1;
    if (state.mode === 'hang') return;
    if (state.mode === 'down') {
      res.writeHead(503).end();
      return;
    }
    const base = `http://127.0.0.1:${server.address().port}`;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      userinfo_endpoint: `${base}/userinfo`,
      end_session_endpoint: `${base}/logout`
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    state,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    })
  };
}

function managerFor(provider, overrides = {}) {
  const pp = new passport.Passport();
  const manager = createOidcManager({
    passport: pp,
    issuer: provider.url,
    clientId: 'client',
    clientSecret: 'secret',
    callbackUrl: 'http://127.0.0.1/auth/oidc/callback',
    scope: 'openid profile email',
    retryCooldownMs: 0,
    logger: quiet,
    ...overrides
  });
  return { pp, manager };
}

// The /auth/oidc route as server.js mounts it: the guard, then passport.
function startLoginApp(pp, manager) {
  const session = require('express-session');
  return startApp((a) => {
    a.use(session({ secret: 't', resave: false, saveUninitialized: false }));
    a.use(pp.initialize());
    a.get('/auth/oidc', manager.requireStrategy, (req, res, next) => pp.authenticate('oidc')(req, res, next));
  });
}

test('provider down at startup: /auth/oidc returns to the login page instead of a 500', async () => {
  const provider = await startProvider();
  const { pp, manager } = managerFor(provider);
  const app = await startLoginApp(pp, manager);
  try {
    assert.strictEqual(await manager.ensureConfigured(), false, 'startup discovery fails');

    const res = await fetch(`${app.url}/auth/oidc`, { redirect: 'manual' });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), '/login?error=oidc_unavailable');
  } finally {
    await app.close();
    await provider.close();
  }
});

test('provider comes up after startup: the next /auth/oidc request registers the strategy and redirects to it', async () => {
  const provider = await startProvider();
  const { pp, manager } = managerFor(provider);
  const app = await startLoginApp(pp, manager);
  try {
    assert.strictEqual(await manager.ensureConfigured(), false, 'startup discovery fails');
    assert.strictEqual(manager.endSessionEndpoint(), null);

    provider.state.mode = 'up';
    const res = await fetch(`${app.url}/auth/oidc`, { redirect: 'manual' });
    assert.strictEqual(res.status, 302);
    assert.ok(res.headers.get('location').startsWith(`${provider.url}/authorize?`), res.headers.get('location'));
    assert.strictEqual(manager.isConfigured(), true);
    assert.strictEqual(manager.endSessionEndpoint(), `${provider.url}/logout`);
  } finally {
    await app.close();
    await provider.close();
  }
});

test('once configured, discovery is not fetched again', async () => {
  const provider = await startProvider();
  provider.state.mode = 'up';
  const { manager } = managerFor(provider);
  try {
    assert.strictEqual(await manager.ensureConfigured(), true);
    assert.strictEqual(await manager.ensureConfigured(), true);
    assert.strictEqual(provider.state.hits, 1);
  } finally {
    await provider.close();
  }
});

test('concurrent requests share one discovery attempt', async () => {
  const provider = await startProvider();
  provider.state.mode = 'up';
  const { manager } = managerFor(provider);
  try {
    const results = await Promise.all([manager.ensureConfigured(), manager.ensureConfigured(), manager.ensureConfigured()]);
    assert.deepStrictEqual(results, [true, true, true]);
    assert.strictEqual(provider.state.hits, 1);
  } finally {
    await provider.close();
  }
});

test('a failed discovery is not retried until the cooldown has passed', async () => {
  const provider = await startProvider();
  let clock = 1_000_000;
  const { manager } = managerFor(provider, { retryCooldownMs: 10_000, now: () => clock });
  try {
    assert.strictEqual(await manager.ensureConfigured(), false);
    provider.state.mode = 'up';

    clock += 9_999;
    assert.strictEqual(await manager.ensureConfigured(), false, 'still cooling down');
    assert.strictEqual(provider.state.hits, 1, 'provider not contacted during the cooldown');

    clock += 1;
    assert.strictEqual(await manager.ensureConfigured(), true, 'retried after the cooldown');
    assert.strictEqual(provider.state.hits, 2);
  } finally {
    await provider.close();
  }
});

test('a provider that never answers fails after the discovery timeout', async () => {
  const provider = await startProvider();
  provider.state.mode = 'hang';
  const { manager } = managerFor(provider, { discoveryTimeoutMs: 100 });
  try {
    const started = Date.now();
    assert.strictEqual(await manager.ensureConfigured(), false);
    assert.ok(Date.now() - started < 2000, 'gave up at the timeout rather than hanging');
  } finally {
    await provider.close();
  }
});
