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
const http = require('node:http');
const express = require('express');
const { startApp } = require('./helpers');
const { createHttpsRedirect } = require('../src/utils/httpsRedirect');

// Same setup as server.js: trust proxy, then the redirect, then static files
// and routes. `clientAddress` makes the socket look like it comes from that
// address (the test client itself is always loopback).
async function withRedirectApp(options, fn, clientAddress) {
  const app = await startApp((a) => {
    a.set('trust proxy', 'loopback,linklocal,uniquelocal');
    if (clientAddress) {
      a.use((req, res, next) => {
        Object.defineProperty(req.socket, 'remoteAddress', { value: clientAddress, configurable: true });
        next();
      });
    }
    a.use(createHttpsRedirect({ httpsPort: 3443, ...options }));
    a.use(express.static(path.join(__dirname, '..', 'public')));
    a.get('/', (req, res) => res.send('index'));
    a.get('/api/status', (req, res) => res.json({ success: true }));
    a.get('/api/health', (req, res) => res.json({ success: true, status: 'ok' }));
    a.post('/scep', (req, res) => res.send('scep'));
  });
  try { return await fn(app); } finally { await app.close(); }
}

// fetch can't set Host, so use http.request.
function request(url, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => { res.resume(); resolve(res); });
    req.on('error', reject);
    req.end();
  });
}

const PUBLIC_CLIENT = '203.0.113.7'; // not a trusted proxy

test('FORCE_HTTPS: GET /, /api/status and assets over HTTP are 301 to https on the HTTPS port', async () => {
  await withRedirectApp({}, async (app) => {
    for (const p of ['/', '/api/status?x=1', '/css/app.css']) {
      const res = await request(app.url + p, { headers: { host: 'certs.dev.local:3000' } });
      assert.strictEqual(res.statusCode, 301, p);
      assert.strictEqual(res.headers.location, 'https://certs.dev.local:3443' + p);
    }
  }, PUBLIC_CLIENT);
});

test('FORCE_HTTPS: GET and HEAD get 301; other methods get 308 so the method and body survive', async () => {
  await withRedirectApp({}, async (app) => {
    const headers = { host: 'certs.dev.local:3000' };
    for (const method of ['GET', 'HEAD']) {
      const res = await request(app.url + '/api/status', { method, headers });
      assert.strictEqual(res.statusCode, 301, method);
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const res = await request(app.url + '/api/certificates/x/y/archive', { method, headers });
      assert.strictEqual(res.statusCode, 308, method);
      assert.strictEqual(res.headers.location, 'https://certs.dev.local:3443/api/certificates/x/y/archive', method);
    }
  }, PUBLIC_CLIENT);
});

test('FORCE_HTTPS: a loopback client is redirected too (a reverse proxy on the same host)', async () => {
  await withRedirectApp({}, async (app) => {
    const res = await request(app.url + '/', { headers: { host: 'certs.dev.local' } });
    assert.strictEqual(res.statusCode, 301);
    assert.strictEqual(res.headers.location, 'https://certs.dev.local:3443/');
  });
});

test('FORCE_HTTPS: /api/health and /scep are not redirected', async () => {
  await withRedirectApp({}, async (app) => {
    assert.strictEqual((await request(app.url + '/api/health')).statusCode, 200);
    assert.strictEqual((await request(app.url + '/scep?operation=PKIOperation', { method: 'POST' })).statusCode, 200);
  });
});

test('FORCE_HTTPS: X-Forwarded-Proto from a client that is not a trusted proxy is ignored', async () => {
  await withRedirectApp({}, async (app) => {
    const res = await request(app.url + '/', { headers: { host: 'certs.dev.local', 'x-forwarded-proto': 'https' } });
    assert.strictEqual(res.statusCode, 301);
  }, PUBLIC_CLIENT);
});

test('FORCE_HTTPS: X-Forwarded-Proto: https from a trusted proxy passes', async () => {
  await withRedirectApp({}, async (app) => {
    const res = await request(app.url + '/api/status', { headers: { 'x-forwarded-proto': 'https' } });
    assert.strictEqual(res.statusCode, 200);
  });
});

test('FORCE_HTTPS: nothing is redirected until the HTTPS server is up', async () => {
  let up = false;
  await withRedirectApp({ isActive: () => up }, async (app) => {
    assert.strictEqual((await request(app.url + '/')).statusCode, 200);
    up = true;
    assert.strictEqual((await request(app.url + '/')).statusCode, 301);
  });
});

test('server.js registers the HTTPS redirect before static files and routes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const redirect = src.indexOf('app.use(createHttpsRedirect(');
  assert.ok(redirect > 0, 'server.js must use createHttpsRedirect');
  for (const marker of ['app.use(express.static(', "app.get('/'", 'app.use(createCertificateRoutes(']) {
    const i = src.indexOf(marker);
    assert.ok(i > 0, marker);
    assert.ok(redirect < i, 'redirect must be registered before ' + marker);
  }
});

test('Docker health checks probe /api/health, which FORCE_HTTPS never redirects', () => {
  const root = path.join(__dirname, '..');
  assert.match(fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8'), /HEALTHCHECK[\s\S]*http:\/\/localhost:3000\/api\/health/);
  assert.match(fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8'), /healthcheck:[\s\S]*"http:\/\/localhost:3000\/api\/health"/);
});

test('server.js logs the HTTP redirect only once HTTPS is listening, and warns when HTTPS failed', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const httpListen = src.slice(src.indexOf('httpServer.listen(PORT'), src.indexOf('// Start HTTPS server if enabled'));
  assert.ok(httpListen.length > 0, 'HTTP listen block not found');
  assert.doesNotMatch(httpListen, /redirect/i, 'the HTTP listen log must not claim redirects before HTTPS is up');

  const httpsListen = src.slice(src.indexOf('httpsServer.listen(HTTPS_PORT'), src.indexOf("httpsServer.on('error'"));
  assert.match(httpsListen, /httpsListening = true[\s\S]*FORCE_HTTPS[\s\S]*redirect/i);

  const sslCatch = src.slice(src.indexOf('} catch (sslError) {'), src.indexOf('} else {', src.indexOf('} catch (sslError) {')));
  assert.match(sslCatch, /if \(FORCE_HTTPS\)[\s\S]*console\.warn\([^)]*not redirected/i,
    'a failed HTTPS start with FORCE_HTTPS must warn that redirects are off');
});
