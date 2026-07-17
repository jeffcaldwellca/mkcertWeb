const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { createCertificateRoutes } = require('../src/routes/certificates');
const { apiResponse } = require('../src/utils/responses');

const noRateLimit = (req, res, next) => next();
const passAuth = (req, res, next) => next();
const rateLimiters = { cliRateLimiter: noRateLimit, generalRateLimiter: noRateLimit };
const config = { auth: { enabled: true }, oidc: { enabled: false }, paths: { certificates: 'certificates' } };

async function startCertApp() {
  const app = express();
  app.use(express.json());
  app.use(createCertificateRoutes(config, rateLimiters, passAuth));
  // Mirror the production central error handler so a forwarded error is a 500,
  // proving the route returns 400 by design rather than by accident.
  app.use((err, req, res, next) => apiResponse.serverError(res, 'Internal server error', err));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

test('DELETE removes an archived certificate (files live in the archive subfolder)', async () => {
  // "Delete Forever" is only offered on archived cards, whose files the
  // archive endpoint moved into <folder>/archive/ — the route must look there.
  const folder = '2099-01-01';
  const folderDir = path.join(process.cwd(), 'certificates', folder);
  const archiveDir = path.join(folderDir, 'archive');
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(path.join(archiveDir, 'test-cert.pem'), 'dummy cert');
  fs.writeFileSync(path.join(archiveDir, 'test-cert-key.pem'), 'dummy key');

  const app = await startCertApp();
  try {
    const res = await fetch(`${app.url}/api/certificates/${folder}/test-cert`, { method: 'DELETE' });
    const body = await res.json();
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
    assert.strictEqual(body.success, true);
    assert.strictEqual(fs.existsSync(path.join(archiveDir, 'test-cert.pem')), false);
    assert.strictEqual(fs.existsSync(path.join(archiveDir, 'test-cert-key.pem')), false);
  } finally {
    await app.close();
    fs.rmSync(folderDir, { recursive: true, force: true });
  }
});

test('DELETE still removes an active (non-archived) certificate', async () => {
  const folder = '2099-01-02';
  const folderDir = path.join(process.cwd(), 'certificates', folder);
  fs.mkdirSync(folderDir, { recursive: true });
  fs.writeFileSync(path.join(folderDir, 'test-cert.pem'), 'dummy cert');
  fs.writeFileSync(path.join(folderDir, 'test-cert-key.pem'), 'dummy key');

  const app = await startCertApp();
  try {
    const res = await fetch(`${app.url}/api/certificates/${folder}/test-cert`, { method: 'DELETE' });
    const body = await res.json();
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
    assert.strictEqual(fs.existsSync(path.join(folderDir, 'test-cert.pem')), false);
    assert.strictEqual(fs.existsSync(path.join(folderDir, 'test-cert-key.pem')), false);
  } finally {
    await app.close();
    fs.rmSync(folderDir, { recursive: true, force: true });
  }
});

test('archive endpoint returns 400 (not 500) for an invalid certificate name', async () => {
  const app = await startCertApp();
  try {
    // 'bad<name' contains a character validateFilename rejects by throwing.
    const res = await fetch(`${app.url}/api/certificates/2026-06-10/${encodeURIComponent('bad<name')}/archive`, {
      method: 'POST'
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.success, false);
  } finally {
    await app.close();
  }
});
