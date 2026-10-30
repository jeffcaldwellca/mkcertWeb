// v5.0 removed the legacy root-directory file endpoints and the informational
// /api/commands listing. They must stay gone: each answers 404 even when the
// file it names exists, and the legacy DELETE leaves that file alone.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startApp } = require('./helpers');
const { createCertificateRoutes } = require('../src/routes/certificates');
const { createFileRoutes } = require('../src/routes/files');
const { createSystemRoutes } = require('../src/routes/system');
const { createNotesStore } = require('../src/services/notesStore');
const realConfig = require('../src/config');

const noRateLimit = (req, res, next) => next();
const passAuth = (req, res, next) => next();
const rateLimiters = { generalRateLimiter: noRateLimit, apiRateLimiter: noRateLimit, cliRateLimiter: noRateLimit };

// The legacy routes resolved files against process.cwd(). Seed a scratch cwd
// with a file they would have served, so a 404 proves the route is gone.
// process.chdir is process-wide; node --test runs each test file in its own
// process, so this does not leak into other files.
let origCwd, tmp, app;
before(async () => {
  origCwd = process.cwd();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mkcertweb-removed-'));
  process.chdir(tmp);
  fs.writeFileSync(path.join(tmp, 'legacy.pem'), 'LEGACY CERT');
  fs.writeFileSync(path.join(tmp, 'legacy-key.pem'), 'LEGACY KEY');
  const store = createNotesStore(path.join(tmp, 'notes.json'));
  // Same mount order as server.js: system routes (with the /api/* catch-all) last.
  app = await startApp((a) => {
    a.use(createCertificateRoutes(realConfig, rateLimiters, passAuth, store));
    a.use(createFileRoutes(realConfig, rateLimiters, passAuth));
    a.use(createSystemRoutes(realConfig, rateLimiters, passAuth));
  });
});
after(async () => {
  await app.close();
  process.chdir(origCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
});

const REMOVED = [
  ['GET', '/api/files'],
  ['GET', '/api/file/legacy.pem/content'],
  ['GET', '/download/legacy.pem'],
  ['GET', '/api/certificate/legacy.pem'],
  ['DELETE', '/api/certificate/legacy.pem'],
  ['GET', '/api/commands']
];

for (const [method, route] of REMOVED) {
  test(`${method} ${route} is removed (404)`, async () => {
    const res = await fetch(`${app.url}${route}`, { method });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(fs.readFileSync(path.join(tmp, 'legacy.pem'), 'utf8'), 'LEGACY CERT');
    assert.strictEqual(fs.readFileSync(path.join(tmp, 'legacy-key.pem'), 'utf8'), 'LEGACY KEY');
  });
}

test('GET /api lists no removed endpoint', async () => {
  const body = await (await fetch(`${app.url}/api`)).json();
  const listed = JSON.stringify(body.endpoints);
  for (const [, route] of REMOVED) {
    const pattern = route.replace('legacy.pem', ':filename');
    assert.ok(!listed.includes(pattern), `${pattern} is still listed`);
  }
});
