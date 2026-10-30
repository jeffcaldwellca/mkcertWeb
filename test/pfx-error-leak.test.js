const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { startApp } = require('./helpers');

const security = require('../src/security');
const { createCertificateRoutes } = require('../src/routes/certificates');

const pass = (req, res, next) => next();
const rateLimiters = { cliRateLimiter: pass, generalRateLimiter: pass, apiRateLimiter: pass };
const config = { auth: { enabled: true }, oidc: { enabled: false }, paths: { certificates: 'certificates' } };

const certDir = path.join(process.cwd(), 'certificates');
const certFile = path.join(certDir, 'pfxleak-test.pem');
const keyFile = path.join(certDir, 'pfxleak-test-key.pem');
let originalExecute;
let createdDir = false;

before(() => {
  originalExecute = security.executeCommand;
  if (!fs.existsSync(certDir)) { fs.mkdirSync(certDir, { recursive: true }); createdDir = true; }
  fs.writeFileSync(certFile, 'x');
  fs.writeFileSync(keyFile, 'x');
});
after(() => {
  security.executeCommand = originalExecute;
  for (const f of [certFile, keyFile]) { try { fs.unlinkSync(f); } catch (_) {} }
  if (createdDir) { try { fs.rmdirSync(certDir); } catch (_) {} }
});

test('password-PFX failure returns a generic error with no server paths', async () => {
  const leaky = `Command failed: openssl pkcs12 -export -out "${certDir}/pfxleak-test.pfx" -passout file:"/tmp/mkcertweb-pfxpass-abc"`;
  security.executeCommand = async () => { throw new Error(leaky); };
  const logged = [];
  const origErr = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  const app = await startApp((a) => { a.use(createCertificateRoutes(config, rateLimiters, pass)); });
  try {
    const res = await fetch(`${app.url}/api/generate/pfx/legacy/pfxleak-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'secret' })
    });
    const text = await res.text();
    console.error = origErr;
    assert.strictEqual(res.status, 500);
    assert.strictEqual(JSON.parse(text).error, 'failed to generate PFX');
    assert.ok(!text.includes(process.cwd()), 'body must not contain cwd');
    assert.ok(!/\//.test(JSON.parse(text).error), 'error must contain no path');
    assert.ok(!text.includes('openssl') && !text.includes('/tmp'), 'no command line or temp path');
    const { ref } = JSON.parse(text);
    assert.match(ref, /^[0-9a-f]{8}$/);
    assert.ok(logged.some(l => l.includes(ref) && l.includes(leaky)), 'full error still logged server-side under the ref');
  } finally {
    console.error = origErr;
    await app.close();
  }
});
