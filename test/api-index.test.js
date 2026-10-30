// GET /api lists every API route the server declares, and nothing else.
// Routes are read from source: router.<method>('/…') in src/routes (settings
// is mounted under /api/settings) and app.<method>('/api…') in server.js.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startApp } = require('./helpers');
const { createSystemRoutes } = require('../src/routes/system');
const realConfig = require('../src/config');

const ROOT = path.join(__dirname, '..');
const noRateLimit = (req, res, next) => next();
const passAuth = (req, res, next) => next();
const rateLimiters = { generalRateLimiter: noRateLimit, apiRateLimiter: noRateLimit, cliRateLimiter: noRateLimit };

const MOUNTS = { 'settings.js': '/api/settings' };
const ROUTE = /\b(?:router|app)\.(get|post|put|delete)\(\s*'([^']+)'/g;

function declaredRoutes() {
  const sources = [['server.js', '']];
  for (const f of fs.readdirSync(path.join(ROOT, 'src/routes'))) {
    sources.push([path.join('src/routes', f), MOUNTS[f] || '']);
  }
  const routes = new Set();
  for (const [rel, prefix] of sources) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const [, method, p] of src.matchAll(ROUTE)) {
      const full = (prefix + (p === '/' && prefix ? '' : p));
      if (full === '/api' || full.startsWith('/api/') || full === '/scep') {
        routes.add(`${method.toUpperCase()} ${full}`);
      }
    }
  }
  return routes;
}

test('GET /api lists exactly the declared API routes', async () => {
  const app = await startApp((a) => a.use(createSystemRoutes(realConfig, rateLimiters, passAuth)));
  try {
    const body = await (await fetch(`${app.url}/api`)).json();
    const listed = new Set(Object.values(body.endpoints).flatMap((group) => Object.keys(group)));
    const declared = declaredRoutes();
    assert.ok(declared.size > 40, `found only ${declared.size} routes; is the source scan broken?`);
    assert.deepStrictEqual([...listed].filter((r) => !declared.has(r)).sort(), [], 'listed but not declared');
    assert.deepStrictEqual([...declared].filter((r) => !listed.has(r)).sort(), [], 'declared but not listed');
  } finally {
    await app.close();
  }
});
