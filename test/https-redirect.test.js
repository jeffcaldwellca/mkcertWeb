const { test } = require('node:test');
const assert = require('node:assert');
const { buildHttpsRedirectUrl } = require('../src/utils/httpsRedirect');

test('appends the configured HTTPS port to a host that has a port', () => {
  assert.strictEqual(
    buildHttpsRedirectUrl('example.com:80', '/dashboard', 3443),
    'https://example.com:3443/dashboard'
  );
});

test('does not corrupt an IP whose octets contain the HTTP port digits', () => {
  // The old host.replace(PORT, HTTPS_PORT) turned 192.168.80.5 into 192.168.3443.5
  assert.strictEqual(
    buildHttpsRedirectUrl('192.168.80.5', '/', 3443),
    'https://192.168.80.5:3443/'
  );
});

test('adds the HTTPS port when the host has no explicit port', () => {
  assert.strictEqual(
    buildHttpsRedirectUrl('myhost', '/path', 3443),
    'https://myhost:3443/path'
  );
});

test('omits the port when HTTPS runs on the standard 443', () => {
  assert.strictEqual(
    buildHttpsRedirectUrl('example.com:80', '/', 443),
    'https://example.com/'
  );
});

test('preserves a bracketed IPv6 host and replaces its port', () => {
  assert.strictEqual(
    buildHttpsRedirectUrl('[::1]:80', '/x', 3443),
    'https://[::1]:3443/x'
  );
});

test('returns null when the Host header is missing', () => {
  assert.strictEqual(buildHttpsRedirectUrl(undefined, '/x', 3443), null);
  assert.strictEqual(buildHttpsRedirectUrl('', '/x', 3443), null);
});
