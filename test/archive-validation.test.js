const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
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
