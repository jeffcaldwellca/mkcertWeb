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

test('status dots carry their state as text, not colour only', () => {
  const html = shell.renderShell({ active: 'scep', status, auth });
  assert.match(html, /mkcert<span class="sr-only">: installed<\/span>/);
  assert.match(html, /CA<span class="sr-only">: missing<\/span>/);
  assert.match(html, /openssl<span class="sr-only">: installed<\/span>/);
  assert.match(html, /title="CA: missing"/);
  // The status only says the CA files exist in CAROOT, not that the CA is in
  // a trust store, so the CA dot says "present" (as root-ca does).
  const withCa = shell.renderShell({ active: 'scep', status: { ...status, caExists: true }, auth });
  assert.match(withCa, /CA<span class="sr-only">: present<\/span>/);
  assert.match(withCa, /title="CA: present"/);
  assert.match(withCa, /mkcert<span class="sr-only">: installed<\/span>/);
  const loading = shell.renderShell({ active: 'scep', status: null, auth: null });
  assert.strictEqual((loading.match(/<span class="sr-only">: unknown<\/span>/g) || []).length, 3);
  assert.match(loading, /title="mkcert: unknown"/);
});

test('theme toggle accessible name contains its visible text', () => {
  const html = shell.renderShell({ active: 'scep', status, auth });
  const m = /data-shell="theme" aria-label="([^"]*)">([^<]*)</.exec(html);
  assert.ok(m, 'theme button rendered');
  assert.ok(m[1].includes(m[2]), `aria-label "${m[1]}" should contain "${m[2]}"`);
});
