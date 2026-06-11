const { test } = require('node:test');
const assert = require('node:assert');
const { sanitizeSettings, filterAllowedSettings, stripPlaceholderSecrets, SECRET_PATHS } = require('../src/utils/settingsSecurity');

test('masks every known secret field, not just four', () => {
  const input = {
    auth: { password: 'pw', sessionSecret: 'sess' },
    oidc: { clientSecret: 'oidc-secret' },
    email: { smtp: { auth: { pass: 'smtp-pw' } } },
    ntfy: { token: 'ntfy-token', password: 'ntfy-pw', username: 'visible' },
    webhook: { headers: { Authorization: 'Bearer abc', 'X-Api-Key': 'k' } }
  };
  const out = sanitizeSettings(input);

  assert.strictEqual(out.auth.password, '');
  assert.strictEqual(out.auth.sessionSecret, '********');
  assert.strictEqual(out.oidc.clientSecret, '********');
  assert.strictEqual(out.email.smtp.auth.pass, '********');
  assert.strictEqual(out.ntfy.token, '********');
  assert.strictEqual(out.ntfy.password, '********');
  assert.strictEqual(out.ntfy.username, 'visible', 'non-secret fields must remain');
  assert.strictEqual(out.webhook.headers.Authorization, '********');
  assert.strictEqual(out.webhook.headers['X-Api-Key'], '********');
});

test('does not mutate the input object', () => {
  const input = { ntfy: { token: 'real-token' } };
  sanitizeSettings(input);
  assert.strictEqual(input.ntfy.token, 'real-token');
});

test('leaves missing secret fields absent (no undefined keys)', () => {
  const out = sanitizeSettings({ theme: { mode: 'dark' } });
  assert.deepStrictEqual(out, { theme: { mode: 'dark' } });
});

test('SECRET_PATHS documents ntfy and webhook secrets', () => {
  assert.ok(SECRET_PATHS.some((p) => p.join('.') === 'ntfy.token'));
  assert.ok(SECRET_PATHS.some((p) => p.join('.') === 'webhook.headers'));
});

test('filterAllowedSettings keeps UI-managed sections and drops unknown ones', () => {
  const out = filterAllowedSettings({
    theme: { mode: 'dark' },
    email: { enabled: true },
    paths: { certificates: '/srv/certs' },   // UI-managed -> kept
    arbitrary: { y: 2 },                      // not in the schema -> dropped
    scep: { allowOpenEnrollment: true }       // not UI-managed -> dropped
  });
  assert.deepStrictEqual(Object.keys(out).sort(), ['email', 'paths', 'theme']);
  assert.strictEqual(out.paths.certificates, '/srv/certs');
});

test('filterAllowedSettings drops nested keys outside the allowed leaf set', () => {
  const out = filterAllowedSettings({
    server: { port: 8443, httpsPort: 9443, evil: 'x' }
  });
  assert.deepStrictEqual(out, { server: { port: 8443, httpsPort: 9443 } });
});

test('filterAllowedSettings ignores prototype-polluting keys', () => {
  const out = filterAllowedSettings(JSON.parse('{"__proto__":{"polluted":true},"theme":{"mode":"x"}}'));
  assert.strictEqual(({}).polluted, undefined);
  assert.deepStrictEqual(out, { theme: { mode: 'x' } });
});

test('stripPlaceholderSecrets deletes round-tripped masks so real secrets persist', () => {
  const settings = {
    auth: { password: '********', sessionSecret: '********', username: 'admin' },
    oidc: { clientSecret: '********' },
    email: { smtp: { auth: { pass: '********', user: 'bob' } } },
    ntfy: { token: '********', password: '********', topic: 'alerts' },
    webhook: { headers: { Authorization: '********', 'X-Trace': 'keep-me' } }
  };
  stripPlaceholderSecrets(settings);

  assert.ok(!('password' in settings.auth), 'masked password should be dropped');
  assert.ok(!('sessionSecret' in settings.auth));
  assert.ok(!('clientSecret' in settings.oidc));
  assert.ok(!('pass' in settings.email.smtp.auth));
  assert.ok(!('token' in settings.ntfy));
  assert.ok(!('password' in settings.ntfy));
  assert.ok(!('Authorization' in settings.webhook.headers), 'masked header should be dropped');
  // Non-secret and real values are untouched.
  assert.strictEqual(settings.auth.username, 'admin');
  assert.strictEqual(settings.email.smtp.auth.user, 'bob');
  assert.strictEqual(settings.ntfy.topic, 'alerts');
  assert.strictEqual(settings.webhook.headers['X-Trace'], 'keep-me');
});

test('stripPlaceholderSecrets keeps genuinely new secret values', () => {
  const settings = { ntfy: { token: 'a-real-new-token' } };
  stripPlaceholderSecrets(settings);
  assert.strictEqual(settings.ntfy.token, 'a-real-new-token');
});

test('stripPlaceholderSecrets also drops empty auth.password', () => {
  const settings = { auth: { password: '' } };
  stripPlaceholderSecrets(settings);
  assert.ok(!('password' in settings.auth));
});
