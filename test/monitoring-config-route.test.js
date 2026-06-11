const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');
const createNotificationRoutes = require('../src/routes/notifications');

const noRateLimit = (req, res, next) => next();
const passAuth = (req, res, next) => next();
const rateLimiters = { apiRateLimiter: noRateLimit, cliRateLimiter: noRateLimit };

// Stub monitoring service that records whether reconfiguration was attempted.
function makeStubService() {
  return {
    reconfigured: false,
    updateConfiguration() { this.reconfigured = true; },
    start() {}, stop() {},
    getStatus() { return {}; }
  };
}

function makeConfig() {
  return { monitoring: { enabled: true, checkInterval: '0 8 * * *', warningDays: 30, criticalDays: 7 } };
}

async function startMonApp(config, service) {
  return startApp((a) => {
    a.use(createNotificationRoutes(config, rateLimiters, passAuth, {}, service, null, null));
  });
}

test('PUT /api/monitoring/config rejects an invalid cron string with 400 and does not mutate config', async () => {
  const config = makeConfig();
  const service = makeStubService();
  const app = await startMonApp(config, service);
  try {
    const res = await fetch(`${app.url}/api/monitoring/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkInterval: 'every 5 minutes' })
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(config.monitoring.checkInterval, '0 8 * * *', 'config must be unchanged');
    assert.strictEqual(service.reconfigured, false, 'service must not be reconfigured with a bad interval');
  } finally {
    await app.close();
  }
});

test('PUT /api/monitoring/config accepts a valid cron string', async () => {
  const config = makeConfig();
  const service = makeStubService();
  const app = await startMonApp(config, service);
  try {
    const res = await fetch(`${app.url}/api/monitoring/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkInterval: '*/30 * * * *' })
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(config.monitoring.checkInterval, '*/30 * * * *');
    assert.strictEqual(service.reconfigured, true);
  } finally {
    await app.close();
  }
});
