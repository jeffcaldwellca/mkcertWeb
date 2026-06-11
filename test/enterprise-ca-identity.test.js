const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const enterpriseCA = require('../src/utils/enterpriseCA');

test('assertSafeIdentity accepts a normal hostname CN and DNS SANs', () => {
  assert.doesNotThrow(() => enterpriseCA.assertSafeIdentity({
    commonName: 'device01.internal.example.com',
    subjectAltNames: ['device01.internal.example.com', 'alt.example.com']
  }));
});

test('assertSafeIdentity accepts a valid UPN', () => {
  assert.doesNotThrow(() => enterpriseCA.assertSafeIdentity({
    commonName: 'Jane Doe',
    upn: 'jane.doe@example.com'
  }));
});

test('assertSafeIdentity rejects a newline in the common name', () => {
  assert.throws(() => enterpriseCA.assertSafeIdentity({
    commonName: 'ok\nbasicConstraints = CA:TRUE'
  }), /common name/i);
});

test('assertSafeIdentity rejects a newline in a SAN (config injection)', () => {
  assert.throws(() => enterpriseCA.assertSafeIdentity({
    commonName: 'ok.example.com',
    subjectAltNames: ['evil.example.com\nbasicConstraints = CA:TRUE']
  }), /subject alt|SAN/i);
});

test('assertSafeIdentity rejects shell metacharacters in the common name', () => {
  assert.throws(() => enterpriseCA.assertSafeIdentity({
    commonName: 'a.com"; rm -rf /'
  }));
});

test('assertSafeIdentity rejects a malformed UPN', () => {
  assert.throws(() => enterpriseCA.assertSafeIdentity({
    commonName: 'ok.example.com',
    upn: 'not-a-upn'
  }), /UPN/i);
});

test('createOpenSSLConfig refuses to write a config for a malicious SAN', async () => {
  const configPath = path.join(os.tmpdir(), `mkcertweb-conf-${Date.now()}.conf`);
  await assert.rejects(() => enterpriseCA.createOpenSSLConfig({
    commonName: 'ok.example.com',
    template: enterpriseCA.certificateTemplates.Computer,
    subjectAltNames: ['evil.com\notherName = injected'],
    configPath
  }));
  assert.strictEqual(fs.existsSync(configPath), false, 'no config file should be written on rejection');
});
