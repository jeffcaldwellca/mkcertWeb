const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startApp } = require('./helpers');
const { createFileRoutes } = require('../src/routes/files');

const noRateLimit = (req, res, next) => next();
const passAuth = (req, res, next) => next();
const rateLimiters = { generalRateLimiter: noRateLimit, apiRateLimiter: noRateLimit };

// The upload route writes into process.cwd(); run it inside a scratch dir.
let origCwd, tmp;
before(() => {
  origCwd = process.cwd();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mkcertweb-upload-'));
  process.chdir(tmp);
});
after(() => {
  process.chdir(origCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function upload(app, names) {
  const form = new FormData();
  for (const name of names) {
    form.append('certificates', new Blob(['-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----\n']), name);
  }
  return fetch(`${app.url}/api/upload`, { method: 'POST', body: form });
}

test('uploading __proto__.pem / constructor.pem does not pollute Object.prototype', async () => {
  const config = { paths: { uploaded: 'uploaded' } };
  const app = await startApp((a) => a.use(createFileRoutes(config, rateLimiters, passAuth)));
  try {
    const res = await upload(app, ['__proto__.pem', '__proto__-key.pem', 'constructor.pem']);
    const text = await res.text();
    assert.strictEqual(res.status, 200, text);
    const body = JSON.parse(text);
    assert.strictEqual(body.success, true);

    // No gadget left behind on the prototype chain.
    assert.strictEqual(({}).cert, undefined);
    assert.strictEqual(({}).key, undefined);
    assert.strictEqual(({}).p12, undefined);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(Object.prototype, 'cert'), false);

    // The pair was grouped normally under its own base name.
    assert.strictEqual(body.data ? body.data.completePairs : body.completePairs, 1);
  } finally {
    delete Object.prototype.cert; delete Object.prototype.key; delete Object.prototype.p12;
    await app.close();
  }
});
