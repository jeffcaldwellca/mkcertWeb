// TRUST_PROXY: which proxies may set X-Forwarded-For / X-Forwarded-Proto.
const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { parseTrustProxy, DEFAULT_TRUST_PROXY } = require('../src/config/trustProxy');

test('the default is the previous hard-coded value', () => {
  assert.strictEqual(DEFAULT_TRUST_PROXY, 'loopback,linklocal,uniquelocal');
  assert.strictEqual(parseTrustProxy(undefined), DEFAULT_TRUST_PROXY);
  assert.strictEqual(parseTrustProxy(''), DEFAULT_TRUST_PROXY);
  assert.strictEqual(parseTrustProxy('   '), DEFAULT_TRUST_PROXY);
});

test('true/false parse as booleans', () => {
  assert.strictEqual(parseTrustProxy('false'), false);
  assert.strictEqual(parseTrustProxy('FALSE'), false);
  assert.strictEqual(parseTrustProxy('true'), true);
  assert.strictEqual(parseTrustProxy(' True '), true);
});

test('a whole number is a hop count', () => {
  assert.strictEqual(parseTrustProxy('1'), 1);
  assert.strictEqual(parseTrustProxy('0'), 0);
  assert.strictEqual(parseTrustProxy(' 2 '), 2);
});

test('anything else is a trimmed comma-separated list of addresses, CIDRs or named ranges', () => {
  assert.strictEqual(parseTrustProxy('loopback'), 'loopback');
  assert.strictEqual(parseTrustProxy(' 10.0.0.5 , 172.18.0.0/16,loopback '), '10.0.0.5,172.18.0.0/16,loopback');
  assert.strictEqual(parseTrustProxy('::1, fd00::/8'), '::1,fd00::/8');
});

test('an invalid value fails loudly instead of trusting the wrong clients', () => {
  assert.throws(() => parseTrustProxy('not-an-ip'), /TRUST_PROXY/);
  assert.throws(() => parseTrustProxy('10.0.0.0/99'), /TRUST_PROXY/);
  assert.throws(() => parseTrustProxy('-1'), /TRUST_PROXY/);
  assert.throws(() => parseTrustProxy('1.5'), /TRUST_PROXY/);
});

function trustFn(value) {
  const app = express();
  app.set('trust proxy', value);
  return app.get('trust proxy fn');
}

test("app.get('trust proxy fn') reflects the parsed setting", () => {
  const def = trustFn(parseTrustProxy(undefined));
  assert.strictEqual(def('127.0.0.1', 0), true);
  assert.strictEqual(def('192.168.1.20', 0), true, 'the default trusts private LAN addresses');
  assert.strictEqual(def('203.0.113.9', 0), false);

  const loop = trustFn(parseTrustProxy('loopback'));
  assert.strictEqual(loop('127.0.0.1', 0), true);
  assert.strictEqual(loop('192.168.1.20', 0), false, 'loopback does not trust LAN clients');

  const exact = trustFn(parseTrustProxy('172.18.0.2'));
  assert.strictEqual(exact('172.18.0.2', 0), true);
  assert.strictEqual(exact('172.18.0.3', 0), false);

  const none = trustFn(parseTrustProxy('false'));
  assert.strictEqual(none('127.0.0.1', 0), false);

  const hops = trustFn(parseTrustProxy('1'));
  assert.strictEqual(hops('203.0.113.9', 0), true);
  assert.strictEqual(hops('203.0.113.9', 1), false);
});

test('config.server.trustProxy comes from TRUST_PROXY only', () => {
  const prev = process.env.TRUST_PROXY;
  const load = () => {
    delete require.cache[require.resolve('../src/config')];
    return require('../src/config');
  };
  const log = console.log;
  console.log = () => {};
  try {
    delete process.env.TRUST_PROXY;
    assert.strictEqual(load().server.trustProxy, DEFAULT_TRUST_PROXY);
    process.env.TRUST_PROXY = 'loopback';
    assert.strictEqual(load().server.trustProxy, 'loopback');
    process.env.TRUST_PROXY = 'false';
    assert.strictEqual(load().server.trustProxy, false);
  } finally {
    console.log = log;
    if (prev === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = prev;
    delete require.cache[require.resolve('../src/config')];
  }
});

test('server.js takes trust proxy from config, not a hard-coded value', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /app\.set\('trust proxy',\s*config\.server\.trustProxy\)/);
  assert.doesNotMatch(src, /app\.set\('trust proxy',\s*'/);
});
