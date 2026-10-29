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

// ---- FORCE_HTTPS middleware ----
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { startApp } = require('./helpers');
const { createHttpsRedirect, isLoopbackAddress } = require('../src/utils/httpsRedirect');

// Same order as server.js: redirect first, then static files, then routes.
async function withRedirectApp(options, fn) {
  const app = await startApp((a) => {
    a.use(createHttpsRedirect({ httpsPort: 3443, ...options }));
    a.use(express.static(path.join(__dirname, '..', 'public')));
    a.get('/', (req, res) => res.send('index'));
    a.get('/api/status', (req, res) => res.json({ success: true }));
    a.post('/scep', (req, res) => res.send('scep'));
  });
  try { return await fn(app); } finally { await app.close(); }
}

const http = require('node:http');
const noFollow = { redirect: 'manual' };

// fetch can't set Host, so use http.request for the Location check.
function getWithHost(url, host) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers: { host } }, (res) => { res.resume(); resolve(res); }).on('error', reject);
  });
}

test('FORCE_HTTPS: GET / and GET /api/status over HTTP are 301 to https on the HTTPS port', async () => {
  await withRedirectApp({ exemptLoopback: false }, async (app) => {
    for (const p of ['/', '/api/status?x=1', '/css/app.css']) {
      const res = await getWithHost(app.url + p, 'certs.dev.local:3000');
      assert.strictEqual(res.statusCode, 301, p);
      assert.strictEqual(res.headers.location, 'https://certs.dev.local:3443' + p);
    }
  });
});

test('FORCE_HTTPS: requests already on HTTPS (or via an HTTPS proxy) and /scep pass through', async () => {
  await withRedirectApp({ exemptLoopback: false }, async (app) => {
    const proxied = await fetch(app.url + '/api/status', { redirect: 'manual', headers: { 'x-forwarded-proto': 'https' } });
    assert.strictEqual(proxied.status, 200);
    const scep = await fetch(app.url + '/scep?operation=PKIOperation', { method: 'POST', redirect: 'manual' });
    assert.strictEqual(scep.status, 200);
  });
});

test('FORCE_HTTPS: loopback clients (the Docker health check) are not redirected by default', async () => {
  await withRedirectApp({}, async (app) => {
    assert.strictEqual((await fetch(app.url + '/', { redirect: 'manual' })).status, 200);
  });
  assert.ok(isLoopbackAddress('127.0.0.1') && isLoopbackAddress('::1') && isLoopbackAddress('::ffff:127.0.0.1'));
  assert.ok(!isLoopbackAddress('192.168.1.20') && !isLoopbackAddress('::ffff:10.0.0.5') && !isLoopbackAddress(undefined));
});

test('FORCE_HTTPS: nothing is redirected until the HTTPS server is up', async () => {
  let up = false;
  await withRedirectApp({ exemptLoopback: false, isActive: () => up }, async (app) => {
    assert.strictEqual((await fetch(app.url + '/', noFollow)).status, 200);
    up = true;
    assert.strictEqual((await fetch(app.url + '/', noFollow)).status, 301);
  });
});

test('server.js registers the HTTPS redirect before static files and routes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const redirect = src.indexOf('app.use(createHttpsRedirect(');
  assert.ok(redirect > 0, 'server.js must use createHttpsRedirect');
  for (const marker of ["app.use(express.static('public'))", "app.get('/'", 'app.use(createCertificateRoutes(']) {
    const i = src.indexOf(marker);
    assert.ok(i > 0, marker);
    assert.ok(redirect < i, 'redirect must be registered before ' + marker);
  }
});
