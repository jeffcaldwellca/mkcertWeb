// Success bodies carry no server internals the UI doesn't use: no absolute
// paths, pid, memory or command lines. /api/status in particular is public
// (no requireAuth), even with ENABLE_AUTH=true.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startApp } = require('./helpers');
const security = require('../src/security');

const pass = (req, res, next) => next();
const deny = (req, res) => res.status(401).json({ success: false, error: 'Authentication required' });
const rateLimiters = { cliRateLimiter: pass, generalRateLimiter: pass, apiRateLimiter: pass };

function absolutePaths(text) {
  return text.match(/(?:^|["'\s:=])\/(?:Users|home|var|tmp|private|opt|app|srv|etc|root)\/[^"'\s]*/g) || [];
}

async function withStubbedSecurity(stubs, fn) {
  const saved = { runTool: security.runTool, executeCommand: security.executeCommand };
  Object.assign(security, stubs);
  delete require.cache[require.resolve('../src/routes/system')];
  delete require.cache[require.resolve('../src/routes/certificates')];
  try {
    return await fn();
  } finally {
    Object.assign(security, saved);
    delete require.cache[require.resolve('../src/routes/system')];
    delete require.cache[require.resolve('../src/routes/certificates')];
  }
}

test('GET /api/status is public and returns no paths, pid, memory or Node version', async () => {
  const caRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'status-caroot-'));
  fs.writeFileSync(path.join(caRoot, 'rootCA.pem'), 'C');
  fs.writeFileSync(path.join(caRoot, 'rootCA-key.pem'), 'K');
  const config = {
    auth: { enabled: true },
    oidc: { enabled: true, issuer: 'https://idp.dev.local/realms/x', clientId: 'mkcert-client-id-secretish' }
  };
  try {
    await withStubbedSecurity({
      executeCommand: async (cmd) => (cmd === 'mkcert -CAROOT' ? { stdout: `${caRoot}\n`, stderr: '' } : { stdout: 'ok', stderr: '' })
    }, async () => {
      const { createSystemRoutes } = require('../src/routes/system');
      const app = await startApp((a) => a.use(createSystemRoutes(config, rateLimiters, deny)));
      try {
        const r = await fetch(`${app.url}/api/status`);
        const text = await r.text();
        assert.strictEqual(r.status, 200, 'status stays public: the shell shows tool dots before login');
        const body = JSON.parse(text);
        // What the UI uses (shell.js, root-ca.js).
        assert.strictEqual(body.mkcertInstalled, true);
        assert.strictEqual(body.opensslAvailable, true);
        assert.strictEqual(body.caExists, true);
        // What it must not disclose.
        assert.ok(!text.includes(caRoot), 'CA root path');
        assert.ok(!text.includes(process.cwd()), 'working directory');
        assert.deepStrictEqual(absolutePaths(text), []);
        for (const key of ['caRoot', 'pid', 'memory', 'workingDir', 'root']) {
          assert.ok(!new RegExp(`"${key}"`).test(text), `field ${key}`);
        }
        assert.ok(!text.includes(process.version), 'Node version');
        assert.ok(!text.includes('mkcert-client-id-secretish'), 'OIDC client id');
        assert.strictEqual(body.features.oidc, true, 'features.oidc is a boolean');
      } finally {
        await app.close();
      }
    });
  } finally {
    fs.rmSync(caRoot, { recursive: true, force: true });
  }
});

test('GET /api/system has no workingDirectory', async () => {
  const { createSystemRoutes } = require('../src/routes/system');
  const app = await startApp((a) => a.use(createSystemRoutes({ auth: { enabled: false }, oidc: {} }, rateLimiters, pass)));
  try {
    const text = await (await fetch(`${app.url}/api/system`)).text();
    assert.ok(!/"workingDirectory"/.test(text), text);
    assert.ok(!text.includes(process.cwd()), text);
  } finally {
    await app.close();
  }
});

test('POST /api/execute generate: no certificateDir or command in the body', async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-internals-'));
  const realCwd = process.cwd();
  process.chdir(workDir);
  try {
    await withStubbedSecurity({
      executeCommand: async () => ({ stdout: 'Created a new certificate valid for the following names', stderr: '' })
    }, async () => {
      const { createCertificateRoutes } = require('../src/routes/certificates');
      const config = { auth: { enabled: true }, oidc: { enabled: false }, paths: { certificates: 'certificates' } };
      const app = await startApp((a) => a.use(createCertificateRoutes(config, rateLimiters, pass)));
      try {
        const r = await fetch(`${app.url}/api/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'generate', input: 'internals.dev.local', format: 'pem' })
        });
        const text = await r.text();
        assert.strictEqual(r.status, 200, text);
        const body = JSON.parse(text);
        assert.strictEqual(body.success, true);
        assert.strictEqual(body.format, 'pem');
        assert.ok(!('certificateDir' in body) && !('command' in body), text);
        assert.ok(!text.includes(workDir) && !text.includes(fs.realpathSync(workDir)), text);
      } finally {
        await app.close();
      }
    });
  } finally {
    process.chdir(realCwd);
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('GET /api/certificates: no absolute path per file (relativePath stays)', async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'list-internals-'));
  const realCwd = process.cwd();
  process.chdir(workDir);
  try {
    const dir = path.join(workDir, 'certificates', '2099-06-06');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'site.pem'), 'not a real cert');
    fs.writeFileSync(path.join(dir, 'site-key.pem'), 'key');
    delete require.cache[require.resolve('../src/routes/certificates')];
    const { createCertificateRoutes } = require('../src/routes/certificates');
    const config = { auth: { enabled: true }, oidc: { enabled: false }, paths: { certificates: 'certificates' } };
    const app = await startApp((a) => a.use(createCertificateRoutes(config, rateLimiters, pass)));
    const origErr = console.error;
    console.error = () => {};
    try {
      const text = await (await fetch(`${app.url}/api/certificates`)).text();
      const body = JSON.parse(text);
      assert.ok(body.certificates.length > 0, text);
      assert.ok(!text.includes(workDir) && !text.includes(fs.realpathSync(workDir)), text);
      assert.deepStrictEqual(absolutePaths(text), []);
    } finally {
      console.error = origErr;
      await app.close();
    }
  } finally {
    process.chdir(realCwd);
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
