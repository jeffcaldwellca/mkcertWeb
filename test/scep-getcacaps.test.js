const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');
const { createSCEPRoutes } = require('../src/routes/scep');

const noRateLimit = (req, res, next) => next();
const rateLimiters = { cliRateLimiter: noRateLimit, apiRateLimiter: noRateLimit };
const passAuth = (req, res, next) => next();
const config = { scep: { allowOpenEnrollment: false, allowedDomains: [] } };

test('GetCACaps does not advertise weak SHA-1 or DES3', async () => {
  const app = await startApp((a) => {
    a.use(createSCEPRoutes(config, rateLimiters, passAuth));
  });
  try {
    const res = await fetch(`${app.url}/scep?operation=GetCACaps`);
    const text = await res.text();
    const caps = text.split('\n').map((s) => s.trim()).filter(Boolean);

    assert.strictEqual(res.status, 200);
    assert.ok(!caps.includes('SHA-1'), `SHA-1 should not be advertised: ${caps.join(',')}`);
    assert.ok(!caps.includes('DES3'), `DES3 should not be advertised: ${caps.join(',')}`);
    // Still advertises strong algorithms.
    assert.ok(caps.includes('SHA-256'));
    assert.ok(caps.includes('AES'));
  } finally {
    await app.close();
  }
});
