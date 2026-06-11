// SCEP PKIOperation enrollment authorization — must fail closed.
const { test } = require('node:test');
const assert = require('node:assert');
const pkcs7Utils = require('../src/utils/pkcs7');

const future = () => new Date(Date.now() + 60_000);

function storeWith(password) {
  const store = new Map();
  store.set('device-1', { password, expiresAt: future(), used: false });
  return store;
}

test('rejects enrollment when challenge store is empty and open enrollment is not enabled', () => {
  const ok = pkcs7Utils.isEnrollmentAuthorized({
    challengePassword: null,
    challengeStore: new Map(),
    allowOpenEnrollment: false
  });
  assert.strictEqual(ok, false);
});

test('rejects enrollment with a challenge password when store is empty and open enrollment is off', () => {
  const ok = pkcs7Utils.isEnrollmentAuthorized({
    challengePassword: 'anything',
    challengeStore: new Map(),
    allowOpenEnrollment: false
  });
  assert.strictEqual(ok, false);
});

test('allows enrollment without a challenge only when open enrollment is explicitly enabled', () => {
  const ok = pkcs7Utils.isEnrollmentAuthorized({
    challengePassword: null,
    challengeStore: new Map(),
    allowOpenEnrollment: true
  });
  assert.strictEqual(ok, true);
});

test('allows enrollment with a valid, unexpired, unused challenge', () => {
  const ok = pkcs7Utils.isEnrollmentAuthorized({
    challengePassword: 'secret-123',
    challengeStore: storeWith('secret-123'),
    allowOpenEnrollment: false
  });
  assert.strictEqual(ok, true);
});

test('rejects enrollment with a wrong challenge even when open enrollment is enabled', () => {
  // An invalid challenge is an explicit failure, not a fall-through to open mode.
  const ok = pkcs7Utils.isEnrollmentAuthorized({
    challengePassword: 'wrong',
    challengeStore: storeWith('secret-123'),
    allowOpenEnrollment: true
  });
  assert.strictEqual(ok, false);
});

test('rejects a reused challenge', () => {
  const store = storeWith('secret-123');
  const args = { challengePassword: 'secret-123', challengeStore: store, allowOpenEnrollment: false };
  assert.strictEqual(pkcs7Utils.isEnrollmentAuthorized(args), true);
  assert.strictEqual(pkcs7Utils.isEnrollmentAuthorized(args), false);
});

test('rejects an expired challenge', () => {
  const store = new Map();
  store.set('device-1', { password: 'secret-123', expiresAt: new Date(Date.now() - 1000), used: false });
  const ok = pkcs7Utils.isEnrollmentAuthorized({
    challengePassword: 'secret-123',
    challengeStore: store,
    allowOpenEnrollment: false
  });
  assert.strictEqual(ok, false);
});
