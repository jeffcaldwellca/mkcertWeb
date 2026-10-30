const test = require('node:test');
const assert = require('node:assert');
const m = require('../public/js/settings-model.js');

test('diffSettings finds nested changes', () => {
  const saved = { email: { smtp: { port: 587, host: 'a' } } };
  const current = { email: { smtp: { port: '587', host: 'b' } } };
  assert.deepStrictEqual(m.diffSettings(saved, current), ['email.smtp.host']);
});

test('diffSettings counts added and removed keys', () => {
  assert.deepStrictEqual(m.diffSettings({ a: 1 }, { b: 1 }), ['a', 'b']);
});

test('sectionFromHash accepts only known section ids', () => {
  assert.strictEqual(m.sectionFromHash('#section=ntfy'), 'ntfy');
  assert.strictEqual(m.sectionFromHash('#section=../x'), null);
  assert.strictEqual(m.sectionFromHash(''), null);
});

test('matchesSetting is case-insensitive over label and key', () => {
  const s = { label: 'Host', key: 'email.smtp.host' };
  assert.strictEqual(m.matchesSetting(s, 'smtp'), true);
  assert.strictEqual(m.matchesSetting(s, 'HOST'), true);
  assert.strictEqual(m.matchesSetting(s, 'ntfy'), false);
});

test('flatten keeps arrays as values; groups and enable keys are exposed', () => {
  assert.deepStrictEqual(m.flatten({ a: { b: [1, 2] }, c: 1 }), { 'a.b': [1, 2], c: 1 });
  assert.strictEqual(m.ENABLE_KEY.auth, 'auth.enabled');
  assert.deepStrictEqual(m.SECTION_GROUPS.map((g) => g.label), ['SERVER', 'ACCESS', 'ALERTS', 'APPEARANCE']);
});
