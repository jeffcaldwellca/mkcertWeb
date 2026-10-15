const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { startApp } = require('./helpers');
const security = require('../src/security');
const realConfig = require('../src/config');

const noRateLimit = (req, res, next) => next();
const rateLimiters = {
  generalRateLimiter: noRateLimit,
  apiRateLimiter: noRateLimit,
  cliRateLimiter: noRateLimit
};
const passAuth = (req, res, next) => next();

const realRunTool = security.runTool;
const realCwd = process.cwd();
let workDir;
let caRoot;

// system.js destructures runTool at require time, so stub it first and load
// a fresh copy of the routes module.
function loadRoutesWithRunTool(stub) {
  security.runTool = stub;
  delete require.cache[require.resolve('../src/routes/system')];
  return require('../src/routes/system').createSystemRoutes;
}

function writeCaFiles() {
  fs.writeFileSync(path.join(caRoot, 'rootCA.pem'), '-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----\n');
  fs.writeFileSync(path.join(caRoot, 'rootCA-key.pem'), 'key');
}

async function postGenerateCa(createSystemRoutes) {
  const app = await startApp((a) => {
    a.use(createSystemRoutes(realConfig, rateLimiters, passAuth));
  });
  try {
    const res = await fetch(`${app.url}/api/generate-ca`, { method: 'POST' });
    return { status: res.status, body: await res.json() };
  } finally {
    await app.close();
  }
}

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkcertweb-genca-'));
  caRoot = path.join(workDir, 'caroot');
  fs.mkdirSync(caRoot);
  process.chdir(workDir); // the route copies the CA into <cwd>/certificates
});

afterEach(() => {
  process.chdir(realCwd);
  security.runTool = realRunTool;
  fs.rmSync(workDir, { recursive: true, force: true });
});

test('generate-ca succeeds when mkcert creates the CA but cannot update the system trust store', async () => {
  // What happens in the Docker image: non-root, no sudo. mkcert writes the
  // CA files, then fails to tee into /usr/local/share/ca-certificates.
  const createSystemRoutes = loadRoutesWithRunTool(async (tool, args) => {
    if (args[0] === '-help') return { stdout: '', stderr: '' };
    if (args[0] === '-CAROOT') return { stdout: `${caRoot}\n`, stderr: '' };
    if (args[0] === '-install') {
      writeCaFiles();
      throw {
        error: 'Command failed: mkcert -install',
        stderr: 'Created a new local CA 💥\nERROR: failed to execute "tee": exit status 1'
      };
    }
    throw new Error(`unexpected mkcert ${args.join(' ')}`);
  });

  const { status, body } = await postGenerateCa(createSystemRoutes);

  assert.strictEqual(status, 200, JSON.stringify(body));
  assert.strictEqual(body.success, true);
  assert.strictEqual(body.action, 'generated');
  assert.strictEqual(body.trustStoreInstalled, false);
  assert.match(body.message, /trust store/i);
  assert.ok(fs.existsSync(path.join(workDir, 'certificates', 'mkcert-rootCA.pem')),
    'CA certificate should be copied to the public certificates directory');
});

test('generate-ca reports trustStoreInstalled when mkcert -install fully succeeds', async () => {
  const createSystemRoutes = loadRoutesWithRunTool(async (tool, args) => {
    if (args[0] === '-help') return { stdout: '', stderr: '' };
    if (args[0] === '-CAROOT') return { stdout: `${caRoot}\n`, stderr: '' };
    if (args[0] === '-install') {
      writeCaFiles();
      return { stdout: 'The local CA is now installed in the system trust store! ⚡️', stderr: '' };
    }
    throw new Error(`unexpected mkcert ${args.join(' ')}`);
  });

  const { status, body } = await postGenerateCa(createSystemRoutes);

  assert.strictEqual(status, 200, JSON.stringify(body));
  assert.strictEqual(body.trustStoreInstalled, true);
  assert.ok(fs.existsSync(path.join(workDir, 'certificates', 'mkcert-rootCA.pem')));
});

test('generate-ca still fails when mkcert -install errors without creating the CA', async () => {
  const createSystemRoutes = loadRoutesWithRunTool(async (tool, args) => {
    if (args[0] === '-help') return { stdout: '', stderr: '' };
    if (args[0] === '-CAROOT') return { stdout: `${caRoot}\n`, stderr: '' };
    if (args[0] === '-install') throw { error: 'Command failed: mkcert -install', stderr: 'ERROR: permission denied' };
    throw new Error(`unexpected mkcert ${args.join(' ')}`);
  });

  const { status, body } = await postGenerateCa(createSystemRoutes);

  assert.strictEqual(status, 500);
  assert.strictEqual(body.success, false);
  assert.match(body.error, /permission denied/);
});
