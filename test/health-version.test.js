const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');
const realConfig = require('../src/config');
const pkg = require('../package.json');

const noRateLimit = (req, res, next) => next();
const rateLimiters = {
  generalRateLimiter: noRateLimit,
  apiRateLimiter: noRateLimit,
  cliRateLimiter: noRateLimit
};
const passAuth = (req, res, next) => next();

test('GET /api/health reports the package.json version when not started via npm', async () => {
  // The Docker image runs `node server.js` directly, so npm_package_version
  // is not set. (`npm test` sets it, which would hide the bug.)
  const saved = process.env.npm_package_version;
  delete process.env.npm_package_version;
  delete require.cache[require.resolve('../src/routes/system')];
  const { createSystemRoutes } = require('../src/routes/system');

  const app = await startApp((a) => {
    a.use(createSystemRoutes(realConfig, rateLimiters, passAuth));
  });
  try {
    const body = await (await fetch(`${app.url}/api/health`)).json();
    assert.strictEqual(body.version, pkg.version);
  } finally {
    await app.close();
    if (saved !== undefined) process.env.npm_package_version = saved;
  }
});
