const { test } = require('node:test');
const assert = require('node:assert');
const m = require('../public/js/scep-model.js');

const now = new Date('2026-10-29T12:00:00Z');
const inMin = (n) => new Date(now.getTime() + n * 60000).toISOString();

test('challengeState: pending, expired, used', () => {
  assert.strictEqual(m.challengeState({ expiresAt: inMin(60), expired: false }, now), 'pending');
  assert.strictEqual(m.challengeState({ expiresAt: inMin(-5), expired: true }, now), 'expired');
  assert.strictEqual(m.challengeState({ expiresAt: inMin(60), used: true }, now), 'used');
  assert.strictEqual(m.challengeState({ expiresAt: inMin(-5), used: true, expired: true }, now), 'used');
});

test('challengeState: past expiresAt but fetched as not expired -> expired', () => {
  assert.strictEqual(m.challengeState({ expiresAt: inMin(-1), expired: false }, now), 'expired');
  assert.strictEqual(m.challengeState({ expiresAt: now.toISOString(), expired: false }, now), 'expired');
});

test('challengeState: the same challenge flips as time passes', () => {
  const c = { expiresAt: inMin(60), expired: false };
  assert.strictEqual(m.challengeState(c, now), 'pending');
  assert.strictEqual(m.challengeState(c, new Date(now.getTime() + 61 * 60000)), 'expired');
});

test('challengeState: server expired flag wins; bad dates fall back to it', () => {
  assert.strictEqual(m.challengeState({ expiresAt: inMin(60), expired: true }, now), 'expired');
  assert.strictEqual(m.challengeState({ expiresAt: 'nope', expired: false }, now), 'pending');
  assert.strictEqual(m.challengeState({ expiresAt: 'nope', expired: true }, now), 'expired');
});

test('relExpiry formats the remaining time', () => {
  assert.strictEqual(m.relExpiry(inMin(-1), now), 'expired');
  assert.strictEqual(m.relExpiry(now.toISOString(), now), 'expired');
  assert.strictEqual(m.relExpiry(new Date(now.getTime() + 30000).toISOString(), now), '<1m');
  assert.strictEqual(m.relExpiry(inMin(45), now), '45m');
  assert.strictEqual(m.relExpiry(inMin(90), now), '1h 30m');
  assert.strictEqual(m.relExpiry(inMin(3 * 24 * 60 + 120), now), '3d 2h');
  assert.strictEqual(m.relExpiry('nope', now), 'unknown');
});

test('activeCount counts pending challenges only', () => {
  const list = [
    { expiresAt: inMin(60) },
    { expiresAt: inMin(-1), expired: false },
    { expiresAt: inMin(60), used: true }
  ];
  assert.strictEqual(m.activeCount(list, now), 1);
  assert.strictEqual(m.activeCount([], now), 0);
});
