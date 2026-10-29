// Same-name ("twin") active + archived certificates: an active
// <folder>/<name>.pem and an archived <folder>/archive/<name>.pem.
// Delete, restore and archive must never overwrite or co-delete the twin.
const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCertificateRoutes } = require('../src/routes/certificates');
const { createNotesStore } = require('../src/services/notesStore');
const { apiResponse } = require('../src/utils/responses');

const noRateLimit = (req, res, next) => next();
const passAuth = (req, res, next) => next();
const rateLimiters = { cliRateLimiter: noRateLimit, generalRateLimiter: noRateLimit };
const config = { auth: { enabled: true }, oidc: { enabled: false }, paths: { certificates: 'certificates' } };

// The routes resolve certificates/ from process.cwd(). node --test runs each
// file in its own process, so run this one in a private working directory:
// its many fixture folders must not race other files' GET /api/certificates
// scans of the shared certificates/ directory.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-twins-'));
process.chdir(workDir);
process.on('exit', () => fs.rmSync(workDir, { recursive: true, force: true }));

async function startCertApp(store) {
  const app = express();
  app.use(express.json());
  app.use(createCertificateRoutes(config, rateLimiters, passAuth, store));
  app.use((err, req, res, next) => apiResponse.serverError(res, 'Internal server error', err));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

// One fixture per test: its own 2099-… folder and its own notes file.
// files: { 'x.pem': 'contents', 'archive/x.pem': 'contents', ... }
async function withFixture(folder, files, fn) {
  const folderDir = path.join(process.cwd(), 'certificates', folder);
  const archiveDir = path.join(folderDir, 'archive');
  fs.mkdirSync(archiveDir, { recursive: true });
  for (const [rel, body] of Object.entries(files)) fs.writeFileSync(path.join(folderDir, rel), body);
  const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twins-notes-'));
  const store = createNotesStore(path.join(notesDir, 'notes.json'));
  const app = await startCertApp(store);
  const read = (rel) => (fs.existsSync(path.join(folderDir, rel)) ? fs.readFileSync(path.join(folderDir, rel), 'utf8') : null);
  const ls = (rel = '') => fs.readdirSync(path.join(folderDir, rel)).sort();
  try {
    await fn({ app, store, read, ls, folder });
  } finally {
    await app.close();
    fs.rmSync(folderDir, { recursive: true, force: true });
    fs.rmSync(notesDir, { recursive: true, force: true });
  }
}

const TWIN = {
  'tw.pem': 'ACTIVE CERT',
  'tw-key.pem': 'ACTIVE KEY',
  'archive/tw.pem': 'ARCHIVED CERT',
  'archive/tw-key.pem': 'ARCHIVED KEY'
};

// ---------------------------------------------------------------- DELETE

test('DELETE ?archived=true with a twin removes only the archive copy and keeps the note', async () => {
  await withFixture('2099-02-01', TWIN, async ({ app, store, read, folder }) => {
    store.set(`${folder}/tw`, 'shared note');
    const res = await fetch(`${app.url}/api/certificates/${folder}/tw?archived=true`, { method: 'DELETE' });
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.scope, 'archived');
    assert.deepStrictEqual(body.deletedFiles.sort(), ['tw-key.pem', 'tw.pem']);
    assert.strictEqual(read('archive/tw.pem'), null);
    assert.strictEqual(read('archive/tw-key.pem'), null);
    assert.strictEqual(read('tw.pem'), 'ACTIVE CERT');
    assert.strictEqual(read('tw-key.pem'), 'ACTIVE KEY');
    assert.strictEqual(store.get(`${folder}/tw`), 'shared note');
  });
});

test('DELETE with a twin and no query param removes only the active copy', async () => {
  await withFixture('2099-02-02', TWIN, async ({ app, store, read, folder }) => {
    store.set(`${folder}/tw`, 'shared note');
    const res = await fetch(`${app.url}/api/certificates/${folder}/tw`, { method: 'DELETE' });
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.scope, 'active');
    assert.strictEqual(read('tw.pem'), null);
    assert.strictEqual(read('tw-key.pem'), null);
    assert.strictEqual(read('archive/tw.pem'), 'ARCHIVED CERT');
    assert.strictEqual(read('archive/tw-key.pem'), 'ARCHIVED KEY');
    assert.strictEqual(store.get(`${folder}/tw`), 'shared note', 'note must survive while the archived twin exists');
  });
});

test('DELETE ?archived=false with a twin removes only the active copy', async () => {
  await withFixture('2099-02-03', TWIN, async ({ app, read, folder }) => {
    const res = await fetch(`${app.url}/api/certificates/${folder}/tw?archived=false`, { method: 'DELETE' });
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.scope, 'active');
    assert.strictEqual(read('tw.pem'), null);
    assert.strictEqual(read('archive/tw.pem'), 'ARCHIVED CERT');
  });
});

test('DELETE ?archived=true when only an active copy exists is 404 and leaves it untouched', async () => {
  await withFixture('2099-02-04', { 'tw.pem': 'ACTIVE CERT', 'tw-key.pem': 'ACTIVE KEY' }, async ({ app, store, read, folder }) => {
    store.set(`${folder}/tw`, 'keep me');
    const res = await fetch(`${app.url}/api/certificates/${folder}/tw?archived=true`, { method: 'DELETE' });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(read('tw.pem'), 'ACTIVE CERT');
    assert.strictEqual(read('tw-key.pem'), 'ACTIVE KEY');
    assert.strictEqual(store.get(`${folder}/tw`), 'keep me');
  });
});

test('DELETE ?archived=false when only an archived copy exists is 404 and leaves it untouched', async () => {
  await withFixture('2099-02-05', { 'archive/tw.pem': 'ARCHIVED CERT' }, async ({ app, read, folder }) => {
    const res = await fetch(`${app.url}/api/certificates/${folder}/tw?archived=false`, { method: 'DELETE' });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(read('archive/tw.pem'), 'ARCHIVED CERT');
  });
});

test('DELETE removes the note once the last copy is gone', async () => {
  await withFixture('2099-02-06', { 'archive/tw.pem': 'ARCHIVED CERT', 'archive/tw-key.pem': 'K' }, async ({ app, store, read, folder }) => {
    store.set(`${folder}/tw`, 'bye');
    const res = await fetch(`${app.url}/api/certificates/${folder}/tw?archived=true`, { method: 'DELETE' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(read('archive/tw.pem'), null);
    assert.strictEqual(store.get(`${folder}/tw`), undefined);
  });
});

test('DELETE rejects an archived value other than true/false', async () => {
  await withFixture('2099-02-07', TWIN, async ({ app, read, folder }) => {
    const res = await fetch(`${app.url}/api/certificates/${folder}/tw?archived=yes`, { method: 'DELETE' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(read('tw.pem'), 'ACTIVE CERT');
    assert.strictEqual(read('archive/tw.pem'), 'ARCHIVED CERT');
  });
});

// --------------------------------------------------------------- RESTORE

test('restore with a twin and no swap is 409 TWIN_EXISTS and changes nothing', async () => {
  await withFixture('2099-02-10', TWIN, async ({ app, read, folder }) => {
    const res = await fetch(`${app.url}/api/certificates/${folder}/tw/restore`, { method: 'POST' });
    const body = await res.json();
    assert.strictEqual(res.status, 409, JSON.stringify(body));
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.code, 'TWIN_EXISTS');
    assert.strictEqual(body.error, 'an active "tw" already exists in this folder');
    assert.strictEqual(read('tw.pem'), 'ACTIVE CERT');
    assert.strictEqual(read('tw-key.pem'), 'ACTIVE KEY');
    assert.strictEqual(read('archive/tw.pem'), 'ARCHIVED CERT');
    assert.strictEqual(read('archive/tw-key.pem'), 'ARCHIVED KEY');
  });
});

test('restore ?swap=true with a twin exchanges cert and key, leaving no temp files', async () => {
  await withFixture('2099-02-11', TWIN, async ({ app, read, ls, folder }) => {
    const res = await fetch(`${app.url}/api/certificates/${folder}/tw/restore?swap=true`, { method: 'POST' });
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.swapped, true);
    assert.strictEqual(read('tw.pem'), 'ARCHIVED CERT');
    assert.strictEqual(read('tw-key.pem'), 'ARCHIVED KEY');
    assert.strictEqual(read('archive/tw.pem'), 'ACTIVE CERT');
    assert.strictEqual(read('archive/tw-key.pem'), 'ACTIVE KEY');
    assert.deepStrictEqual(ls('archive'), ['tw-key.pem', 'tw.pem']);
    assert.deepStrictEqual(ls(), ['archive', 'tw-key.pem', 'tw.pem']);
  });
});

test('restore ?swap=true swaps a partial pair (one file missing on each side) correctly', async () => {
  await withFixture('2099-02-12', { 'tw.pem': 'ACTIVE CERT', 'archive/tw-key.pem': 'ARCHIVED KEY' }, async ({ app, read, ls, folder }) => {
    const res = await fetch(`${app.url}/api/certificates/${folder}/tw/restore?swap=true`, { method: 'POST' });
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.swapped, true);
    assert.strictEqual(read('tw.pem'), null);
    assert.strictEqual(read('tw-key.pem'), 'ARCHIVED KEY');
    assert.strictEqual(read('archive/tw.pem'), 'ACTIVE CERT');
    assert.strictEqual(read('archive/tw-key.pem'), null);
    assert.deepStrictEqual(ls('archive'), ['tw.pem']);
  });
});

test('restore ?swap=true rolls back and returns 500 when a rename fails mid-swap', async () => {
  await withFixture('2099-02-13', TWIN, async ({ app, read, ls, folder }) => {
    // Fail the first rename that moves an archived file back into the folder
    // (step 2 of the key swap, after the cert pair has fully swapped).
    const realRename = fs.renameSync;
    let calls = 0;
    fs.renameSync = function (from, to) {
      calls += 1;
      if (String(from).endsWith(path.join('archive', 'tw-key.pem'))) throw new Error('injected failure');
      return realRename.apply(this, arguments);
    };
    let res;
    try {
      res = await fetch(`${app.url}/api/certificates/${folder}/tw/restore?swap=true`, { method: 'POST' });
    } finally {
      fs.renameSync = realRename;
    }
    assert.strictEqual(res.status, 500);
    assert.ok(calls > 1, 'the swap should have started before failing');
    assert.strictEqual(read('tw.pem'), 'ACTIVE CERT');
    assert.strictEqual(read('tw-key.pem'), 'ACTIVE KEY');
    assert.strictEqual(read('archive/tw.pem'), 'ARCHIVED CERT');
    assert.strictEqual(read('archive/tw-key.pem'), 'ARCHIVED KEY');
    assert.deepStrictEqual(ls('archive'), ['tw-key.pem', 'tw.pem'], 'no temp files left behind');
  });
});

test('restore without a twin moves the archived pair back (unchanged behaviour)', async () => {
  await withFixture('2099-02-14', { 'archive/tw.pem': 'ARCHIVED CERT', 'archive/tw-key.pem': 'ARCHIVED KEY' }, async ({ app, read, folder }) => {
    const res = await fetch(`${app.url}/api/certificates/${folder}/tw/restore`, { method: 'POST' });
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.swapped, false);
    assert.strictEqual(read('tw.pem'), 'ARCHIVED CERT');
    assert.strictEqual(read('tw-key.pem'), 'ARCHIVED KEY');
    assert.strictEqual(read('archive/tw.pem'), null);
  });
});

test('restore ?swap=true without a twin is a plain restore', async () => {
  await withFixture('2099-02-15', { 'archive/tw.pem': 'ARCHIVED CERT', 'archive/tw-key.pem': 'ARCHIVED KEY' }, async ({ app, read, folder }) => {
    const res = await fetch(`${app.url}/api/certificates/${folder}/tw/restore?swap=true`, { method: 'POST' });
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.swapped, false);
    assert.strictEqual(read('tw.pem'), 'ARCHIVED CERT');
    assert.strictEqual(read('archive/tw.pem'), null);
  });
});

// --------------------------------------------------------------- ARCHIVE

test('archive when an archived copy exists is 409 TWIN_EXISTS and changes nothing', async () => {
  await withFixture('2099-02-20', TWIN, async ({ app, read, folder }) => {
    const res = await fetch(`${app.url}/api/certificates/${folder}/tw/archive`, { method: 'POST' });
    const body = await res.json();
    assert.strictEqual(res.status, 409, JSON.stringify(body));
    assert.strictEqual(body.code, 'TWIN_EXISTS');
    assert.strictEqual(body.error, 'an archived "tw" already exists in this folder');
    assert.strictEqual(read('tw.pem'), 'ACTIVE CERT');
    assert.strictEqual(read('tw-key.pem'), 'ACTIVE KEY');
    assert.strictEqual(read('archive/tw.pem'), 'ARCHIVED CERT');
    assert.strictEqual(read('archive/tw-key.pem'), 'ARCHIVED KEY');
  });
});

test('archive is 409 when only the archived key exists', async () => {
  await withFixture('2099-02-21', { 'tw.pem': 'ACTIVE CERT', 'tw-key.pem': 'ACTIVE KEY', 'archive/tw-key.pem': 'ARCHIVED KEY' }, async ({ app, read, folder }) => {
    const res = await fetch(`${app.url}/api/certificates/${folder}/tw/archive`, { method: 'POST' });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(read('tw-key.pem'), 'ACTIVE KEY');
    assert.strictEqual(read('archive/tw-key.pem'), 'ARCHIVED KEY');
  });
});

test('archive without a twin moves the pair into archive/ (unchanged behaviour)', async () => {
  await withFixture('2099-02-22', { 'tw.pem': 'ACTIVE CERT', 'tw-key.pem': 'ACTIVE KEY' }, async ({ app, read, folder }) => {
    const res = await fetch(`${app.url}/api/certificates/${folder}/tw/archive`, { method: 'POST' });
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(read('tw.pem'), null);
    assert.strictEqual(read('archive/tw.pem'), 'ACTIVE CERT');
    assert.strictEqual(read('archive/tw-key.pem'), 'ACTIVE KEY');
  });
});

test('restore ?swap=true with no archived copy is 404 and leaves the active copy in place', async () => {
  await withFixture('2099-02-16', { 'tw.pem': 'ACTIVE CERT', 'tw-key.pem': 'ACTIVE KEY' }, async ({ app, read, ls, folder }) => {
    const res = await fetch(`${app.url}/api/certificates/${folder}/tw/restore?swap=true`, { method: 'POST' });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(read('tw.pem'), 'ACTIVE CERT');
    assert.strictEqual(read('tw-key.pem'), 'ACTIVE KEY');
    assert.deepStrictEqual(ls('archive'), []);
  });
});
