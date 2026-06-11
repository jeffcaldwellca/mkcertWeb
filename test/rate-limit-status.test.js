const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');
const { createSystemRoutes } = require('../src/routes/system');
const realConfig = require('../src/config');

const noRateLimit = (req, res, next) => next();
const rateLimiters = {
  generalRateLimiter: noRateLimit,
  apiRateLimiter: noRateLimit,
  cliRateLimiter: noRateLimit
};
const passAuth = (req, res, next) => next();

test('GET /api/rate-limit/status returns the configured limits (no 500)', async () => {
  const app = await startApp((a) => {
    a.use(createSystemRoutes(realConfig, rateLimiters, passAuth));
  });
  try {
    const res = await fetch(`${app.url}/api/rate-limit/status`);
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.success, true);
    assert.ok(body.rateLimiting.limits.general.includes('requests per'));
    assert.ok(body.rateLimiting.limits.api.includes('requests per'));
    assert.ok(body.rateLimiting.limits.cli.includes('requests per'));
    assert.ok(body.rateLimiting.limits.auth.includes('requests per'));
    // Must reflect real config numbers, not "undefined requests per NaN".
    assert.ok(!/undefined|NaN/.test(JSON.stringify(body.rateLimiting.limits)));
  } finally {
    await app.close();
  }
});
