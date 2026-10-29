// Uploads are staged by multer in a private os.tmpdir() directory, never in
// the working directory (the code tree under systemd), and the staging
// directory is removed once the files are moved into the uploaded folder.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startApp } = require('./helpers');
const { createFileRoutes, UPLOAD_STAGING_PREFIX } = require('../src/routes/files');

const noRateLimit = (req, res, next) => next();
const passAuth = (req, res, next) => next();
const rateLimiters = { generalRateLimiter: noRateLimit, apiRateLimiter: noRateLimit };

// process.chdir and TMPDIR are process-wide; node --test runs each file in
// its own process. A private TMPDIR keeps other test files' uploads out of
// the staging-directory count.
let origCwd, origTmpdir, tmp, privateTmp, app;
before(async () => {
  origCwd = process.cwd();
  origTmpdir = process.env.TMPDIR;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mkcertweb-staging-test-'));
  privateTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mkcertweb-staging-tmpdir-'));
  process.env.TMPDIR = privateTmp;
  assert.strictEqual(os.tmpdir(), privateTmp);
  process.chdir(tmp);
  const config = { paths: { uploaded: 'certificates/uploaded' } };
  app = await startApp((a) => a.use(createFileRoutes(config, rateLimiters, passAuth)));
});
after(async () => {
  await app.close();
  process.chdir(origCwd);
  if (origTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = origTmpdir;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(privateTmp, { recursive: true, force: true });
});

const stagingDirs = () => fs.readdirSync(privateTmp).filter((f) => f.startsWith(UPLOAD_STAGING_PREFIX));

async function upload(files) {
  const form = new FormData();
  for (const [name, body] of Object.entries(files)) form.append('certificates', new Blob([body]), name);
  return fetch(`${app.url}/api/upload`, { method: 'POST', body: form });
}

test('an upload lands in the uploaded folder and leaves no staging files behind', async () => {
  assert.ok(UPLOAD_STAGING_PREFIX && UPLOAD_STAGING_PREFIX.startsWith('mkcertweb-'));
  const before = stagingDirs();
  const res = await upload({ 'site.pem': 'CERT BODY', 'site-key.pem': 'KEY BODY' });
  const body = await res.json();
  assert.strictEqual(res.status, 200, JSON.stringify(body));
  assert.strictEqual(body.completePairs, 1);

  const uploaded = path.join(tmp, 'certificates', 'uploaded');
  assert.strictEqual(fs.readFileSync(path.join(uploaded, 'site.pem'), 'utf8'), 'CERT BODY');
  assert.strictEqual(fs.readFileSync(path.join(uploaded, 'site-key.pem'), 'utf8'), 'KEY BODY');
  // Nothing staged in the working directory itself.
  assert.deepStrictEqual(fs.readdirSync(tmp), ['certificates']);
  // The per-request staging directory is gone.
  assert.deepStrictEqual(before, []);
  assert.deepStrictEqual(stagingDirs(), []);
});

test('a rejected upload leaves no staging files behind', async () => {
  const before = stagingDirs();
  const res = await upload({ 'ok.pem': 'CERT', 'notes.txt': 'not a cert' });
  assert.strictEqual(res.status, 400);
  assert.deepStrictEqual(fs.readdirSync(tmp).filter((f) => f !== 'certificates'), []);
  assert.deepStrictEqual(stagingDirs(), before);
});
