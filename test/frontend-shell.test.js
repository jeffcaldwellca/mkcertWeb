const { test } = require('node:test');
const assert = require('node:assert');
const shell = require('../public/js/shell.js');

const auth = { authEnabled: true, authenticated: true, username: 'admin' };
const status = { mkcertInstalled: true, caExists: false, opensslAvailable: true };

test('renderShell marks the active tab', () => {
  const html = shell.renderShell({ active: 'scep', status, auth });
  assert.strictEqual((html.match(/aria-current="page"/g) || []).length, 1);
  assert.match(html, /<a class="nav-tab" href="\/scep\.html" aria-current="page">/);
});

test('renderShell escapes username', () => {
  const html = shell.renderShell({ active: 'scep', status, auth: { authEnabled: true, username: '<b>x</b>' } });
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(!html.includes('<b>'));
});

test('renderShell hides logout when auth disabled', () => {
  const html = shell.renderShell({ active: 'scep', status, auth: { authEnabled: false } });
  assert.ok(!html.includes('data-shell="logout"'));
});

test('renderShell shows unknown dots while loading', () => {
  const html = shell.renderShell({ active: 'scep', status: null, auth: null });
  assert.strictEqual((html.match(/dot--off/g) || []).length, 3);
});

test('renderShell shows ok and err dots', () => {
  const html = shell.renderShell({ active: 'scep', status, auth });
  assert.strictEqual((html.match(/dot--ok/g) || []).length, 2);
  assert.strictEqual((html.match(/dot--err/g) || []).length, 1);
});
