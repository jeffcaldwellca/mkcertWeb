const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startApp } = require('./helpers');
const { securityHeaders } = require('../src/config/securityHeaders');

async function fetchCsp() {
  const app = await startApp((a) => {
    a.use(securityHeaders());
    a.get('/', (req, res) => res.json({ ok: true }));
  });
  try {
    const res = await fetch(app.url + '/');
    return res.headers.get('content-security-policy');
  } finally {
    await app.close();
  }
}

test('CSP keeps inline event-handler attributes blocked (script-src-attr none)', async () => {
  // Regression guard for issue #42: the frontend must be wired via
  // addEventListener, never by relaxing this directive.
  const csp = await fetchCsp();
  assert.match(csp, /script-src-attr 'none'/);
});

test('CSP still carries the app-specific directives', async () => {
  const csp = await fetchCsp();
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  // Inline <script> blocks (scep.html) must keep working.
  assert.match(csp, /script-src 'self' 'unsafe-inline'/);
});

test('no inline event-handler attributes in frontend sources', () => {
  // With script-src-attr 'none' enforced, any on*="" attribute is a silently
  // dead button. There is no DOM test infra, so guard at the source level.
  const publicDir = path.join(__dirname, '..', 'public');
  const files = fs.readdirSync(publicDir)
    .filter((f) => f.endsWith('.js') || f.endsWith('.html'));
  assert.ok(files.length > 0, 'expected frontend sources in public/');
  for (const file of files) {
    const src = fs.readFileSync(path.join(publicDir, file), 'utf8');
    const match = src.match(/\son[a-z]+\s*=\s*["']/i);
    assert.strictEqual(
      match, null,
      `${file} contains an inline event handler (${match && match[0].trim()}) — ` +
      'blocked by CSP script-src-attr \'none\'; use addEventListener instead'
    );
  }
});
