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

// The routes resolve certificates/ from process.cwd(). Run this file in a
// private working directory so its many fixture folders don't race other
// files' GET /api/certificates scans of the shared certificates/ directory.
// process.chdir changes the cwd of the whole process, so this relies on
// node --test's default per-file process isolation: each test file runs in
// its own process. Under --test-isolation=none it would move every file's cwd.
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
    assert.deepStrictEqual(body.deletedFiles.sort(), ['tw-key.pem', 'tw.pem']);
    assert.strictEqual(read('tw.pem'), null);
    assert.strictEqual(read('tw-key.pem'), null);
    assert.strictEqual(read('archive/tw.pem'), 'ARCHIVED CERT');
    assert.strictEqual(read('archive/tw-key.pem'), 'ARCHIVED KEY');
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
    assert.strictEqual(read('tw-key.pem'), 'ARCHIVED KEY');
    assert.strictEqual(read('archive/tw.pem'), null);
    assert.strictEqual(read('archive/tw-key.pem'), null);
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

// ------------------------------------------------- swap/twin hardening

// Fail the rename picked by `shouldFail(from, to)` while a request runs.
async function withRenameFailure(shouldFail, run) {
  const realRename = fs.renameSync;
  let calls = 0;
  fs.renameSync = function (from, to) {
    calls += 1;
    if (shouldFail(String(from), String(to))) throw new Error('injected failure');
    return realRename.apply(this, arguments);
  };
  try {
    return { res: await run(), calls };
  } finally {
    fs.renameSync = realRename;
  }
}

const UNCHANGED_TWIN = (read, ls) => {
  assert.strictEqual(read('tw.pem'), 'ACTIVE CERT');
  assert.strictEqual(read('tw-key.pem'), 'ACTIVE KEY');
  assert.strictEqual(read('archive/tw.pem'), 'ARCHIVED CERT');
  assert.strictEqual(read('archive/tw-key.pem'), 'ARCHIVED KEY');
  assert.deepStrictEqual(ls('archive'), ['tw-key.pem', 'tw.pem'], 'no temp files left behind');
};

test('restore ?swap=true rolls back when step 1 (active -> temp) fails for the key', async () => {
  await withFixture('2099-03-01', TWIN, async ({ app, read, ls, folder }) => {
    // The cert pair has fully swapped by then; the active key is the next move.
    const activeKey = path.join(folder, 'tw-key.pem');
    const { res, calls } = await withRenameFailure(
      (from, to) => from.endsWith(activeKey) && to.includes('.swap-'),
      () => fetch(`${app.url}/api/certificates/${folder}/tw/restore?swap=true`, { method: 'POST' }));
    assert.strictEqual(res.status, 500);
    assert.ok(calls > 3, 'the cert swap should have completed before the failure');
    UNCHANGED_TWIN(read, ls);
  });
});

test('restore ?swap=true rolls back when step 3 (temp -> archive) fails for the key', async () => {
  await withFixture('2099-03-02', TWIN, async ({ app, read, ls, folder }) => {
    const { res, calls } = await withRenameFailure(
      (from, to) => from.includes('.swap-') && to.endsWith(path.join('archive', 'tw-key.pem')),
      () => fetch(`${app.url}/api/certificates/${folder}/tw/restore?swap=true`, { method: 'POST' }));
    assert.strictEqual(res.status, 500);
    assert.ok(calls >= 6, 'every earlier rename should have run');
    UNCHANGED_TWIN(read, ls);
  });
});

test('restore ?swap=true reports an incomplete rollback, and later restores refuse with SWAP_INCOMPLETE', async () => {
  await withFixture('2099-03-03', TWIN, async ({ app, read, ls, folder }) => {
    const activeKey = path.join(folder, 'tw-key.pem');
    const { res } = await withRenameFailure(
      (from, to) => from.includes('.swap-') && (
        to.endsWith(path.join('archive', 'tw-key.pem')) || // forward step 3
        to.endsWith(activeKey)),                           // undoing step 1
      () => fetch(`${app.url}/api/certificates/${folder}/tw/restore?swap=true`, { method: 'POST' }));
    const body = await res.json();
    assert.strictEqual(res.status, 500);
    assert.match(body.error, /could not fully roll back; check its archive folder for \.swap-\* files/);
    // Everything else was undone; the active key is stranded under its temp name.
    assert.strictEqual(read('tw.pem'), 'ACTIVE CERT');
    assert.strictEqual(read('tw-key.pem'), null);
    assert.strictEqual(read('archive/tw.pem'), 'ARCHIVED CERT');
    assert.strictEqual(read('archive/tw-key.pem'), 'ARCHIVED KEY');
    const leftovers = ls('archive').filter((f) => f.startsWith('.swap-'));
    assert.strictEqual(leftovers.length, 1);
    assert.match(leftovers[0], /^\.swap-[0-9a-f]{16}-tw-key\.pem$/);
    assert.strictEqual(read(path.join('archive', leftovers[0])), 'ACTIVE KEY');

    const again = await fetch(`${app.url}/api/certificates/${folder}/tw/restore?swap=true`, { method: 'POST' });
    const againBody = await again.json();
    assert.strictEqual(again.status, 409);
    assert.strictEqual(againBody.code, 'SWAP_INCOMPLETE');
  });
});

test('restore with an active twin that has only a key is 409 TWIN_EXISTS and changes nothing', async () => {
  const files = { 'tw-key.pem': 'ACTIVE KEY', 'archive/tw.pem': 'ARCHIVED CERT', 'archive/tw-key.pem': 'ARCHIVED KEY' };
  await withFixture('2099-03-04', files, async ({ app, read, folder }) => {
    const res = await fetch(`${app.url}/api/certificates/${folder}/tw/restore`, { method: 'POST' });
    const body = await res.json();
    assert.strictEqual(res.status, 409, JSON.stringify(body));
    assert.strictEqual(body.code, 'TWIN_EXISTS');
    assert.strictEqual(read('tw.pem'), null);
    assert.strictEqual(read('tw-key.pem'), 'ACTIVE KEY');
    assert.strictEqual(read('archive/tw.pem'), 'ARCHIVED CERT');
    assert.strictEqual(read('archive/tw-key.pem'), 'ARCHIVED KEY');
  });
});

for (const leftover of ['.swap-0123456789abcdef-tw.pem', '.swap-0123456789abcdef-tw-key.pem']) {
  test(`restore refuses with 409 SWAP_INCOMPLETE when archive/ holds ${leftover}`, async () => {
    const files = { ...TWIN, [`archive/${leftover}`]: 'STRANDED' };
    await withFixture('2099-03-05', files, async ({ app, read, ls, folder }) => {
      for (const query of ['', '?swap=true']) {
        const res = await fetch(`${app.url}/api/certificates/${folder}/tw/restore${query}`, { method: 'POST' });
        const body = await res.json();
        assert.strictEqual(res.status, 409, JSON.stringify(body));
        assert.strictEqual(body.success, false);
        assert.strictEqual(body.code, 'SWAP_INCOMPLETE');
        assert.strictEqual(body.error, 'an interrupted swap left temporary files for "tw"; resolve them manually');
      }
      assert.strictEqual(read('tw.pem'), 'ACTIVE CERT');
      assert.strictEqual(read('archive/tw.pem'), 'ARCHIVED CERT');
      assert.strictEqual(read(`archive/${leftover}`), 'STRANDED');
      assert.deepStrictEqual(ls('archive'), [leftover, 'tw-key.pem', 'tw.pem'].sort());
    });
  });
}

test('a .swap-* leftover for another name does not block restore', async () => {
  const files = { 'archive/tw.pem': 'ARCHIVED CERT', 'archive/.swap-0123456789abcdef-other.pem': 'X' };
  await withFixture('2099-03-06', files, async ({ app, read, folder }) => {
    const res = await fetch(`${app.url}/api/certificates/${folder}/tw/restore`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(read('tw.pem'), 'ARCHIVED CERT');
  });
});

test('GET /api/certificates never lists .swap-* leftovers', async () => {
  const files = { 'archive/.swap-0123456789abcdef-tw.pem': 'X', 'archive/.swap-0123456789abcdef-tw-key.pem': 'Y' };
  await withFixture('2099-03-07', files, async ({ app }) => {
    const realWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    let body;
    try {
      body = await (await fetch(`${app.url}/api/certificates`)).json();
    } finally {
      console.warn = realWarn;
    }
    assert.strictEqual(body.success, true);
    const names = body.certificates.map((c) => c.name);
    assert.ok(!names.some((n) => n.includes('.swap-')), `listed: ${names.join(', ')}`);
    assert.ok(warnings.some((w) => w.includes('.swap-0123456789abcdef-tw.pem')), warnings.join('\n'));
  });
});

const LONG = 'n'.repeat(240); // fits <name>-key.pem (255 max), not .swap-<16 hex>-<name>-key.pem

test('a plain restore works for a name too long for a swap temp name', async () => {
  const files = { [`archive/${LONG}.pem`]: 'ARCHIVED CERT', [`archive/${LONG}-key.pem`]: 'ARCHIVED KEY' };
  await withFixture('2099-03-08', files, async ({ app, read, folder }) => {
    const res = await fetch(`${app.url}/api/certificates/${folder}/${LONG}/restore`, { method: 'POST' });
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.swapped, false);
    assert.strictEqual(read(`${LONG}.pem`), 'ARCHIVED CERT');
    assert.strictEqual(read(`${LONG}-key.pem`), 'ARCHIVED KEY');
  });
});

test('a swap is refused (400) when the name is too long for the temp name, and changes nothing', async () => {
  const files = {
    [`${LONG}.pem`]: 'ACTIVE CERT', [`${LONG}-key.pem`]: 'ACTIVE KEY',
    [`archive/${LONG}.pem`]: 'ARCHIVED CERT', [`archive/${LONG}-key.pem`]: 'ARCHIVED KEY'
  };
  await withFixture('2099-03-09', files, async ({ app, read, folder }) => {
    const res = await fetch(`${app.url}/api/certificates/${folder}/${LONG}/restore?swap=true`, { method: 'POST' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(read(`${LONG}.pem`), 'ACTIVE CERT');
    assert.strictEqual(read(`archive/${LONG}.pem`), 'ARCHIVED CERT');
  });
});

for (const value of ['yes', '1', 'TRUE', '']) {
  test(`restore rejects ?swap=${value} with 400 and changes nothing`, async () => {
    await withFixture('2099-03-10', TWIN, async ({ app, read, ls, folder }) => {
      const res = await fetch(`${app.url}/api/certificates/${folder}/tw/restore?swap=${value}`, { method: 'POST' });
      const body = await res.json();
      assert.strictEqual(res.status, 400, JSON.stringify(body));
      assert.strictEqual(body.error, 'swap must be "true" or "false"');
      UNCHANGED_TWIN(read, ls);
    });
  });
}

test('restore ?swap=false with a twin is 409 TWIN_EXISTS', async () => {
  await withFixture('2099-03-11', TWIN, async ({ app, read, ls, folder }) => {
    const res = await fetch(`${app.url}/api/certificates/${folder}/tw/restore?swap=false`, { method: 'POST' });
    assert.strictEqual(res.status, 409);
    assert.strictEqual((await res.json()).code, 'TWIN_EXISTS');
    UNCHANGED_TWIN(read, ls);
  });
});

// Express decodes %25 to %, and the path helper decodes again, so
// "archive%252Ftw" would resolve to archive/tw. The active scope must never
// reach into archive/ that way.
test('a double-encoded archive%2F name cannot reach archive/ from the active scope', async () => {
  const files = { 'archive/tw.pem': 'ARCHIVED CERT', 'archive/tw-key.pem': 'ARCHIVED KEY' };
  await withFixture('2099-03-12', files, async ({ app, read, ls, folder }) => {
    const attempts = [
      ['DELETE', `/api/certificates/${folder}/archive%252Ftw?archived=false`],
      ['DELETE', `/api/certificates/${folder}/archive%252Ftw`],
      ['POST', `/api/certificates/${folder}/archive%252Ftw/archive`],
      ['POST', `/api/certificates/${folder}/archive%252Ftw/restore`]
    ];
    for (const [method, route] of attempts) {
      const res = await fetch(`${app.url}${route}`, { method });
      assert.strictEqual(res.status, 400, `${method} ${route}`);
      assert.strictEqual(read('archive/tw.pem'), 'ARCHIVED CERT', `${method} ${route}`);
      assert.strictEqual(read('archive/tw-key.pem'), 'ARCHIVED KEY', `${method} ${route}`);
    }
    assert.deepStrictEqual(ls('archive'), ['tw-key.pem', 'tw.pem']);
  });
});

test('GET /api/certificates quietly skips a file that vanishes before it is stat-ed', async () => {
  const files = { 'gone.pem': 'G', 'kept.pem': 'K' };
  await withFixture('2099-03-13', files, async ({ app, folder }) => {
    const realStat = fs.promises.stat;
    const realError = console.error;
    const errors = [];
    fs.promises.stat = function (p, ...rest) {
      if (String(p).endsWith(path.join(folder, 'gone.pem'))) {
        const err = new Error(`ENOENT: no such file or directory, stat '${p}'`);
        err.code = 'ENOENT';
        return Promise.reject(err);
      }
      return realStat.call(this, p, ...rest);
    };
    console.error = (...args) => errors.push(args.join(' '));
    let res, body;
    try {
      res = await fetch(`${app.url}/api/certificates`);
      body = await res.json();
    } finally {
      fs.promises.stat = realStat;
      console.error = realError;
    }
    assert.strictEqual(res.status, 200);
    const mine = body.certificates.filter((c) => c.folder === folder).map((c) => c.name);
    assert.deepStrictEqual(mine, ['kept']);
    assert.ok(!errors.some((e) => e.includes('gone.pem')), errors.join('\n'));
  });
});
