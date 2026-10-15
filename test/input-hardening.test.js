const { test } = require('node:test');
const assert = require('node:assert');
const security = require('../src/security');
const scepUtils = require('../src/utils/scep');

test('validateFilename still rejects trailing whitespace and trailing dots', () => {
  assert.throws(() => security.validateFilename('cert.pem '), /unsafe pattern/);
  assert.throws(() => security.validateFilename('cert.pem\t'), /unsafe pattern/);
  assert.throws(() => security.validateFilename('cert.pem.'), /unsafe pattern/);
  assert.throws(() => security.validateFilename('cert..'), /unsafe pattern/);
  assert.strictEqual(security.validateFilename('cert.pem'), 'cert.pem');
});

test('validateFilename rejects oversized input before pattern matching (ReDoS)', () => {
  const evil = 'a' + ' '.repeat(100000) + 'a';
  const start = process.hrtime.bigint();
  assert.throws(() => security.validateFilename(evil), /too long/);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 100, `validateFilename took ${ms}ms on a long input`);
});

test('processSCEPCertificateRequest rejects path-traversal common names', async () => {
  for (const commonName of ['../../etc', 'a/../../b', '..', '/abs/path']) {
    await assert.rejects(
      scepUtils.processSCEPCertificateRequest({ commonName }),
      /Invalid common name/,
      `expected ${commonName} to be rejected`
    );
  }
});

test('getSCEPCertificateDetails rejects path-traversal common names', async () => {
  await assert.rejects(scepUtils.getSCEPCertificateDetails('../../etc'), /Invalid common name/);
});
