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

test('a rejected file type keeps its 400 message', async () => {
  const res = await upload({ 'notes.txt': 'not a cert' });
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).error, /Only certificate files/);
});

test('an unexpected upload failure is a generic 500 with a ref, not the fs error', async () => {
  const realMkdtemp = fs.mkdtempSync;
  fs.mkdtempSync = () => {
    throw Object.assign(new Error(`ENOSPC: no space left on device, mkdtemp '${privateTmp}/x'`), { code: 'ENOSPC' });
  };
  const origErr = console.error;
  console.error = () => {};
  try {
    const res = await upload({ 'site.pem': 'CERT' });
    const text = await res.text();
    assert.strictEqual(res.status, 500, text);
    const body = JSON.parse(text);
    assert.strictEqual(body.error, 'File upload failed');
    assert.match(body.ref, /^[0-9a-f]{8}$/);
    assert.ok(!text.includes('/') && !text.includes('ENOSPC'), text);
  } finally {
    fs.mkdtempSync = realMkdtemp;
    console.error = origErr;
  }
});

test('a file that cannot be saved is reported without the fs error text', async () => {
  const realCopy = fs.promises.copyFile;
  fs.promises.copyFile = async (from, to) => {
    throw Object.assign(new Error(`EACCES: permission denied, copyfile '${from}' -> '${to}'`), { code: 'EACCES' });
  };
  const origErr = console.error;
  console.error = () => {};
  try {
    const res = await upload({ 'locked.pem': 'CERT' });
    const text = await res.text();
    const body = JSON.parse(text);
    assert.deepStrictEqual(body.errors, ['Failed to save locked.pem']);
    assert.ok(!text.includes(tmp) && !text.includes(privateTmp), text);
  } finally {
    fs.promises.copyFile = realCopy;
    console.error = origErr;
  }
});

async function rawUpload(contentType, body) {
  return fetch(`${app.url}/api/upload`, { method: 'POST', headers: { 'Content-Type': contentType }, body });
}

test('a malformed multipart body is a 400 "Malformed upload", not a 500', async () => {
  const origErr = console.error;
  console.error = () => {};
  try {
    const truncated = await rawUpload('multipart/form-data; boundary=XYZ',
      '--XYZ\r\nContent-Disposition: form-data; name="certificates"; filename="a.pem"\r\n\r\npartial');
    assert.strictEqual(truncated.status, 400);
    assert.deepStrictEqual(await truncated.json(), { success: false, error: 'Malformed upload' });

    const noBoundary = await rawUpload('multipart/form-data', 'whatever');
    assert.strictEqual(noBoundary.status, 400);
    assert.deepStrictEqual(await noBoundary.json(), { success: false, error: 'Malformed upload' });
  } finally {
    console.error = origErr;
  }
  assert.deepStrictEqual(stagingDirs(), []);
});
