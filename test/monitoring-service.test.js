const { test } = require('node:test');
const assert = require('node:assert');
const { CertificateMonitoringService } = require('../src/services/certificateMonitoringService');

function makeService(checkInterval) {
  // enabled:false so the constructor does not auto-start; we drive start() directly.
  const config = { monitoring: { enabled: false, checkInterval, warningDays: 30, criticalDays: 7 } };
  return new CertificateMonitoringService(config, null, null, null);
}

test('start() throws on an invalid cron expression instead of silently failing', () => {
  const svc = makeService('every 5 minutes'); // not a valid cron string
  assert.throws(() => svc.start(), /cron|interval|schedule/i);
  assert.strictEqual(svc.isRunning, false);
});

test('start() succeeds with a valid cron expression and is reflected in isRunning', () => {
  const svc = makeService('0 8 * * *');
  try {
    svc.start();
    assert.strictEqual(svc.isRunning, true);
  } finally {
    svc.stop();
  }
  assert.strictEqual(svc.isRunning, false);
});
