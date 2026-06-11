const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

// Stub the security module before the route module loads it, so no real
// mkcert/openssl process is ever spawned.
const security = require('../src/security');
const { createCertificateRoutes } = require('../src/routes/certificates');

const noRateLimit = (req, res, next) => next();
const passAuth = (req, res, next) => next();
const rateLimiters = {
  cliRateLimiter: noRateLimit,
  generalRateLimiter: noRateLimit,
  apiRateLimiter: noRateLimit
};

function makeConfig(authEnabled) {
  return {
    auth: { enabled: authEnabled },
    oidc: { enabled: false },
    paths: { certificates: 'certificates' }
  };
}

let originalExecute;
let lastCommand;
before(() => {
  originalExecute = security.executeCommand;
});
after(() => {
  security.executeCommand = originalExecute;
});
beforeEach(() => {
  lastCommand = null;
  security.executeCommand = async (cmd) => {
    lastCommand = cmd;
    return { stdout: `ran: ${cmd}`, stderr: '' };
  };
});

async function withApp(config, fn) {
  const app = await startApp((a) => {
    a.use(createCertificateRoutes(config, rateLimiters, passAuth));
  });
  try {
    return await fn(app);
  } finally {
    await app.close();
  }
}

test('caroot command returns the command output (no TDZ ReferenceError)', async () => {
  await withApp(makeConfig(true), async (app) => {
    const res = await fetch(`${app.url}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'caroot' })
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.success, true);
    assert.strictEqual(lastCommand, 'mkcert -CAROOT');
    assert.strictEqual(body.output, 'ran: mkcert -CAROOT', 'output must come from stdout, not result.output');
  });
});

test('list command succeeds and surfaces output', async () => {
  await withApp(makeConfig(true), async (app) => {
    const res = await fetch(`${app.url}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'list' })
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.ok(body.output.startsWith('ran: '), 'output should be populated');
  });
});

test('uninstall-ca without confirm is rejected with 400, not run', async () => {
  await withApp(makeConfig(true), async (app) => {
    const res = await fetch(`${app.url}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'uninstall-ca' })
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(lastCommand, null, 'mkcert -uninstall must not have run');
  });
});

test('uninstall-ca is forbidden when auth is disabled even with confirm', async () => {
  await withApp(makeConfig(false), async (app) => {
    const res = await fetch(`${app.url}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'uninstall-ca', confirm: true })
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(lastCommand, null);
  });
});

test('uninstall-ca runs only with auth enabled and confirm:true', async () => {
  await withApp(makeConfig(true), async (app) => {
    const res = await fetch(`${app.url}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'uninstall-ca', confirm: true })
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(lastCommand, 'mkcert -uninstall');
  });
});
