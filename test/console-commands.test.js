'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { runCommand } = require('../docs/assets/console-commands.js');

const REPO = 'https://github.com/jeffcaldwellca/mkcertWeb';
const DOCKERHUB = 'https://hub.docker.com/r/jeffcaldwellca/mkcertweb';

test('empty input is a no-op (no error line)', () => {
  const r = runCommand('   ');
  assert.deepStrictEqual(r, { lines: [], clear: false, navigate: null });
});

test('version prints the OS version', () => {
  assert.deepStrictEqual(runCommand('version'),
    { lines: ['MKCERT-OS v4.1.0'], clear: false, navigate: null });
});

test('help lists known commands', () => {
  const r = runCommand('help');
  assert.strictEqual(r.clear, false);
  assert.strictEqual(r.navigate, null);
  const joined = r.lines.join('\n');
  ['help', 'about', 'version', 'source', 'docker', 'vault', 'clear']
    .forEach((c) => assert.ok(joined.includes(c), 'help mentions ' + c));
});

test('about returns a one-line description', () => {
  const r = runCommand('about');
  assert.strictEqual(r.lines.length, 1);
  assert.ok(/mkcert/i.test(r.lines[0]));
});

test('source navigates to the repo', () => {
  assert.strictEqual(runCommand('source').navigate, REPO);
});

test('docker navigates to docker hub', () => {
  assert.strictEqual(runCommand('docker').navigate, DOCKERHUB);
});

test('clear signals a clear with no output', () => {
  assert.deepStrictEqual(runCommand('clear'),
    { lines: [], clear: true, navigate: null });
});

test('vault returns flavor text and no navigation', () => {
  const r = runCommand('vault');
  assert.strictEqual(r.navigate, null);
  assert.ok(r.lines.length >= 1);
});

test('input is case-insensitive and ignores extra args', () => {
  assert.deepStrictEqual(runCommand('VERSION --now'),
    { lines: ['MKCERT-OS v4.1.0'], clear: false, navigate: null });
});

test('unknown command reports not found with the typed token', () => {
  assert.deepStrictEqual(runCommand('frobnicate'),
    { lines: ['command not found: frobnicate'], clear: false, navigate: null });
});
