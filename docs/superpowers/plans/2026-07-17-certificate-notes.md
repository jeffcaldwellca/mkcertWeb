# Certificate Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One editable plain-text note per certificate card, persisted in `data/certificate-notes.json` (issue #41).

**Architecture:** A small file-backed store module (`src/services/notesStore.js`) is injected into the certificate routes. `GET /api/certificates` merges notes into the grouped cert objects; a new `PUT /api/certificates/:folder/:certname/notes` saves them; the two delete routes clean up entries. The frontend renders a notes block on each card and drives it through the existing delegated `data-action` click handler.

**Tech Stack:** Node/Express, vanilla JS frontend, node:test + fetch for tests.

**Spec:** `docs/superpowers/specs/2026-07-17-certificate-notes-design.md`

## Global Constraints

- Note max length: 2,000 characters (server rejects with 400; textarea `maxlength`).
- Empty or whitespace-only note = delete the entry (server responds 200 with `{ note: '' }`).
- Note key: `<folder>/<certname>` where folder ∈ `YYYY-MM-DD` | `interface-ssl` | `legacy` | `root-ca`.
- No inline event handlers anywhere (CSP `script-src-attr 'none'`; `test/security-headers.test.js` enforces at source level).
- All user-supplied text rendered via `escapeHtml`/`escapeAttr` (`public/script.js:7-17`).
- No `Co-Authored-By` trailers in commits.

---

### Task 1: notesStore module

**Files:**
- Create: `src/services/notesStore.js`
- Test: `test/notes-store.test.js`

**Interfaces:**
- Produces: `createNotesStore(filePath) -> { get(key): string|undefined, set(key, note): string, remove(key): void, all(): object }` and `DEFAULT_NOTES_FILE` (string). `set` returns the stored note, or `''` when the note was empty/whitespace and the entry was removed. Task 2 consumes both exports.

- [ ] **Step 1: Write the failing tests**

```js
// test/notes-store.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createNotesStore } = require('../src/services/notesStore');

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-store-'));
  return path.join(dir, 'certificate-notes.json');
}

test('set/get round-trips through a reload from disk', () => {
  const file = tempFile();
  const store = createNotesStore(file);
  store.set('2099-01-01/web', 'staging nginx');
  const reloaded = createNotesStore(file);
  assert.strictEqual(reloaded.get('2099-01-01/web'), 'staging nginx');
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test('set with whitespace-only note removes the entry and returns empty string', () => {
  const file = tempFile();
  const store = createNotesStore(file);
  store.set('a/b', 'something');
  assert.strictEqual(store.set('a/b', '   \n'), '');
  assert.strictEqual(store.get('a/b'), undefined);
  assert.strictEqual(createNotesStore(file).get('a/b'), undefined);
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test('remove deletes an entry and persists the deletion', () => {
  const file = tempFile();
  const store = createNotesStore(file);
  store.set('a/b', 'x');
  store.remove('a/b');
  assert.strictEqual(createNotesStore(file).get('a/b'), undefined);
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test('a malformed store file is treated as empty without crashing', () => {
  const file = tempFile();
  fs.writeFileSync(file, '{not json');
  const store = createNotesStore(file);
  assert.strictEqual(store.get('anything'), undefined);
  store.set('a/b', 'recovered');            // first successful save overwrites
  assert.strictEqual(createNotesStore(file).get('a/b'), 'recovered');
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test('creates the parent directory on first save', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-store-'));
  const file = path.join(dir, 'nested', 'certificate-notes.json');
  const store = createNotesStore(file);
  store.set('a/b', 'x');
  assert.ok(fs.existsSync(file));
  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/notes-store.test.js`
Expected: FAIL — `Cannot find module '../src/services/notesStore'`

- [ ] **Step 3: Write the implementation**

```js
// src/services/notesStore.js
// File-backed store for per-certificate notes (issue #41). One JSON file,
// loaded once, rewritten atomically on every mutation. Keys are
// "<folder>/<certname>" using the same folder identifiers the UI passes
// (YYYY-MM-DD, interface-ssl, legacy, root-ca).
const fs = require('fs');
const path = require('path');

const DEFAULT_NOTES_FILE = path.join(process.cwd(), 'data', 'certificate-notes.json');

function createNotesStore(filePath = DEFAULT_NOTES_FILE) {
  let notes = {};
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('store root is not an object');
      }
      notes = parsed;
    }
  } catch (err) {
    // Fail safe, not fast: a broken notes file must not take down cert
    // listing. The bad file stays on disk until the first successful save.
    console.error(`certificate-notes: could not read ${filePath}, starting empty: ${err.message}`);
    notes = {};
  }

  function persist() {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    // Atomic write: rename within the same directory replaces the old file
    // all-or-nothing, so a crash mid-write can't corrupt existing notes.
    const tmp = path.join(dir, `.${path.basename(filePath)}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(notes, null, 2));
    fs.renameSync(tmp, filePath);
  }

  return {
    get(key) {
      return notes[key] ? notes[key].note : undefined;
    },
    set(key, note) {
      if (typeof note !== 'string' || note.trim() === '') {
        this.remove(key);
        return '';
      }
      notes[key] = { note, updatedAt: new Date().toISOString() };
      persist();
      return note;
    },
    remove(key) {
      if (notes[key]) {
        delete notes[key];
        persist();
      }
    },
    all() {
      return { ...notes };
    }
  };
}

module.exports = { createNotesStore, DEFAULT_NOTES_FILE };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/notes-store.test.js`
Expected: 5 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add src/services/notesStore.js test/notes-store.test.js
git commit -m "feat: file-backed notes store for certificate notes (#41)"
```

---

### Task 2: notes API — PUT route, GET merge, delete cleanup

**Files:**
- Modify: `src/routes/certificates.js` (factory signature line 10; GET list ~line 249; both DELETE routes ~lines 282 and 520; new PUT route after the restore route ~line 588)
- Test: `test/certificate-notes-route.test.js`

**Interfaces:**
- Consumes: `createNotesStore`, `DEFAULT_NOTES_FILE` from Task 1.
- Produces: `createCertificateRoutes(config, rateLimiters, requireAuth, notesStore?)` — 4th param optional, defaults to a store on `DEFAULT_NOTES_FILE`; existing callers (`server.js:466`, existing tests) need no change. HTTP surface: `PUT /api/certificates/:folder/:certname/notes` body `{note}` → `{ success, data: { note } }`; grouped certs from `GET /api/certificates` gain an optional `note` string field (absent when no note). Task 3 consumes both.

- [ ] **Step 1: Write the failing tests**

```js
// test/certificate-notes-route.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { createCertificateRoutes } = require('../src/routes/certificates');
const { createNotesStore } = require('../src/services/notesStore');
const { apiResponse } = require('../src/utils/responses');

const noRateLimit = (req, res, next) => next();
const passAuth = (req, res, next) => next();
const rateLimiters = { cliRateLimiter: noRateLimit, generalRateLimiter: noRateLimit };
const config = { auth: { enabled: true }, oidc: { enabled: false }, paths: { certificates: 'certificates' } };

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-route-'));
  return { store: createNotesStore(path.join(dir, 'notes.json')), dir };
}

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

test('PUT stores a note and GET /api/certificates returns it on the right cert', async () => {
  const folder = '2099-01-04';
  const folderDir = path.join(process.cwd(), 'certificates', folder);
  fs.mkdirSync(folderDir, { recursive: true });
  // GET inspects certs with openssl, so the fixture must be a real cert.
  execSync(
    `openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=note-test" ` +
    `-keyout "${path.join(folderDir, 'note-test-key.pem')}" -out "${path.join(folderDir, 'note-test.pem')}"`,
    { stdio: 'ignore' }
  );
  const { store, dir } = tempStore();
  const app = await startCertApp(store);
  try {
    const put = await fetch(`${app.url}/api/certificates/${folder}/note-test/notes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'prod loadbalancer cert' })
    });
    assert.strictEqual(put.status, 200);
    const putBody = await put.json();
    // apiResponse.success spreads data at the top level: { success, note }
    assert.strictEqual(putBody.note, 'prod loadbalancer cert');

    const list = await (await fetch(`${app.url}/api/certificates`)).json();
    const cert = list.certificates.find((c) => c.name === 'note-test' && c.folder === folder);
    assert.ok(cert, 'fixture cert missing from listing');
    assert.strictEqual(cert.note, 'prod loadbalancer cert');
  } finally {
    await app.close();
    fs.rmSync(folderDir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('PUT with an empty note removes a previously stored note', async () => {
  const { store, dir } = tempStore();
  const app = await startCertApp(store);
  try {
    store.set('2099-01-05/gone', 'delete me');
    const res = await fetch(`${app.url}/api/certificates/2099-01-05/gone/notes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: '' })
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(store.get('2099-01-05/gone'), undefined);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('PUT validation: non-string, oversize, bad folder, bad certname all 400', async () => {
  const { store, dir } = tempStore();
  const app = await startCertApp(store);
  const put = (folder, name, body) => fetch(`${app.url}/api/certificates/${folder}/${name}/notes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  try {
    assert.strictEqual((await put('2099-01-06', 'a', { note: 42 })).status, 400);
    assert.strictEqual((await put('2099-01-06', 'a', { note: 'x'.repeat(2001) })).status, 400);
    assert.strictEqual((await put('not-a-folder', 'a', { note: 'x' })).status, 400);
    assert.strictEqual((await put('2099-01-06', encodeURIComponent('bad<name'), { note: 'x' })).status, 400);
    // 2000 chars exactly is accepted
    assert.strictEqual((await put('2099-01-06', 'a', { note: 'x'.repeat(2000) })).status, 200);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('PUT accepts the special folders interface-ssl, legacy, root-ca', async () => {
  const { store, dir } = tempStore();
  const app = await startCertApp(store);
  try {
    for (const folder of ['interface-ssl', 'legacy', 'root-ca']) {
      const res = await fetch(`${app.url}/api/certificates/${folder}/server/notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: `note for ${folder}` })
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(store.get(`${folder}/server`), `note for ${folder}`);
    }
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deleting a certificate also removes its note', async () => {
  const folder = '2099-01-07';
  const folderDir = path.join(process.cwd(), 'certificates', folder);
  fs.mkdirSync(folderDir, { recursive: true });
  fs.writeFileSync(path.join(folderDir, 'doomed.pem'), 'dummy');
  const { store, dir } = tempStore();
  store.set(`${folder}/doomed`, 'about to vanish');
  const app = await startCertApp(store);
  try {
    const res = await fetch(`${app.url}/api/certificates/${folder}/doomed`, { method: 'DELETE' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(store.get(`${folder}/doomed`), undefined);
  } finally {
    await app.close();
    fs.rmSync(folderDir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/certificate-notes-route.test.js`
Expected: FAIL — PUT endpoints 404 (route doesn't exist), note merge missing, note survives delete.

- [ ] **Step 3: Implement in `src/routes/certificates.js`**

3a. Top of file, add the require (next to the other `../` requires):

```js
const { createNotesStore } = require('../services/notesStore');
```

3b. Change the factory signature (line 10):

```js
const createCertificateRoutes = (config, rateLimiters, requireAuth, notesStore = createNotesStore()) => {
```

3c. Add the key helper near the top of the factory body — it must mirror the
frontend's folderParam derivation (`public/script.js` displayCertificates):

```js
  // Note-store key for a grouped certificate. Mirrors the folder identifiers
  // the frontend uses for API calls (public/script.js displayCertificates).
  const noteKeyForCert = (group) => {
    let folder;
    if (group.isInterfaceSSL) folder = 'interface-ssl';
    else if (group.folder) folder = group.folder;
    else if (group.name === 'mkcert-rootCA') folder = 'root-ca';
    else folder = 'legacy';
    return `${folder}/${group.name}`;
  };
```

3d. In `GET /api/certificates`, after `const groupedCertificates = certificateUtils.groupCertificates(certificates);` (~line 249):

```js
    for (const group of groupedCertificates) {
      const note = notesStore.get(noteKeyForCert(group));
      if (note !== undefined) group.note = note;
    }
```

3e. New PUT route, placed after the restore route:

```js
  // Save (or clear) the per-certificate note. Notes are UI metadata, so this
  // is allowed even for read-only certificates and does not require the cert
  // files to exist — orphaned entries are invisible and cleaned on delete.
  router.put('/api/certificates/:folder/:certname/notes', requireAuth, generalRateLimiter, asyncHandler(async (req, res) => {
    const { folder, certname } = req.params;

    const folderOk = folder === 'interface-ssl' || folder === 'legacy' || folder === 'root-ca'
      || /^\d{4}-\d{2}-\d{2}$/.test(folder);
    if (!folderOk) {
      return apiResponse.badRequest(res, 'Invalid folder parameter');
    }
    try {
      security.validateFilename(`${certname}.pem`);
    } catch (error) {
      return apiResponse.badRequest(res, 'Invalid certificate name');
    }

    const note = req.body ? req.body.note : undefined;
    if (typeof note !== 'string') {
      return apiResponse.badRequest(res, 'note must be a string');
    }
    if (note.length > 2000) {
      return apiResponse.badRequest(res, 'note must be 2000 characters or fewer');
    }

    const saved = notesStore.set(`${folder}/${certname}`, note);
    apiResponse.success(res, { note: saved });
  }));
```

Check the names used for `generalRateLimiter`/`cliRateLimiter` destructuring at the top of the factory and use whatever the existing routes use.

3f. In `DELETE /api/certificates/:folder/:certname` (~line 520), right before the success response (after `deletedFiles.length === 0` check):

```js
      notesStore.remove(`${folder}/${certname}`);
```

3g. In `DELETE /api/certificate/:filename` (~line 282), after the successful delete and companion cleanup, before the success response. This route deletes files in the certificates root, where the UI folder key is `interface-ssl` or `legacy` — remove both candidates:

```js
    const base = path.basename(req.params.filename).replace(/(-key)?\.(pem|crt|key|p12|pfx)$/i, '');
    notesStore.remove(`interface-ssl/${base}`);
    notesStore.remove(`legacy/${base}`);
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/certificate-notes-route.test.js`
Expected: 5 pass. Then run the whole suite: `npm test` — everything green (existing 3-arg `createCertificateRoutes` callers still work via the default parameter).

- [ ] **Step 5: Commit**

```bash
git add src/routes/certificates.js test/certificate-notes-route.test.js
git commit -m "feat: notes API — save, list-merge, and delete cleanup (#41)"
```

---

### Task 3: frontend — notes block on certificate cards

**Files:**
- Modify: `public/script.js` (card template in displayCertificates; `handleCertificateAction`; new note functions near it; module state near the top)
- Modify: `public/styles.css` (notes block styles, appended at the end)

**Interfaces:**
- Consumes: `cert.note` from `GET /api/certificates` (Task 2); `PUT /api/certificates/:folder/:certname/notes` via the existing `apiRequest` helper (which attaches Content-Type, credentials, and the CSRF token for PUT).
- Produces: delegated actions `edit-note`, `save-note`, `cancel-note` on buttons inside a `.certificate-notes` container carrying `data-folder`/`data-name`.

- [ ] **Step 1: Add module-level note state**

Near the other state declarations at the top of `public/script.js` (below `let csrfToken = null;`):

```js
// Current note per certificate, keyed "<folderParam>/<name>". Populated on
// each render from the API response; read back when opening the editor so we
// never re-parse note text out of the DOM.
const certNotes = new Map();
```

- [ ] **Step 2: Render the notes block in the card template**

In `displayCertificates`, where `attrFolder`/`attrName` are computed, record the note:

```js
        certNotes.set(folderParam + '/' + cert.name, cert.note || '');
```

Then insert the block between the closing `</div>` of `certificate-info` and `'<div class="certificate-actions">'`:

```js
               '<div class="certificate-notes" data-folder="' + attrFolder + '" data-name="' + attrName + '">' +
               renderNoteContent(cert.note || '') +
               '</div>' +
```

- [ ] **Step 3: Add the note render/edit/save functions**

Place next to `handleCertificateAction`:

```js
// --- Certificate notes (issue #41) ---

function renderNoteContent(note) {
    if (note) {
        return '<div class="note-text">' + escapeHtml(note) + '</div>' +
               '<button data-action="edit-note" class="btn btn-secondary btn-small" title="Edit note">' +
               '<i class="fas fa-pen"></i> Edit Note</button>';
    }
    return '<button data-action="edit-note" class="btn btn-secondary btn-small note-add" title="Add a note">' +
           '<i class="fas fa-sticky-note"></i> Add Note</button>';
}

function noteKeyOf(container) {
    return container.dataset.folder + '/' + container.dataset.name;
}

function openNoteEditor(container) {
    const current = certNotes.get(noteKeyOf(container)) || '';
    container.innerHTML =
        '<textarea class="note-editor" maxlength="2000" rows="3" placeholder="Notes about this certificate…"></textarea>' +
        '<div class="note-editor-actions">' +
        '<button data-action="save-note" class="btn btn-primary btn-small"><i class="fas fa-save"></i> Save</button>' +
        '<button data-action="cancel-note" class="btn btn-secondary btn-small">Cancel</button>' +
        '</div>';
    const textarea = container.querySelector('.note-editor');
    textarea.value = current;   // set via DOM, not innerHTML — no escaping pitfalls
    textarea.focus();
}

function closeNoteEditor(container) {
    container.innerHTML = renderNoteContent(certNotes.get(noteKeyOf(container)) || '');
}

async function saveNote(container) {
    const note = container.querySelector('.note-editor').value;
    const folder = container.dataset.folder;
    const name = container.dataset.name;
    try {
        const response = await apiRequest(
            '/certificates/' + encodeURIComponent(folder) + '/' + encodeURIComponent(name) + '/notes',
            { method: 'PUT', body: JSON.stringify({ note: note }) }
        );
        certNotes.set(folder + '/' + name, response.note || '');
        closeNoteEditor(container);
    } catch (error) {
        // Keep the editor (and the typed text) so the user can retry.
        showAlert('Failed to save note: ' + error.message, 'error');
    }
}
```

Note: `apiResponse.success(res, { note })` spreads its data at the top level of the JSON (`src/utils/responses.js:11-16`), and `apiRequest` returns the parsed body — so `response.note` is correct.

- [ ] **Step 4: Wire the actions into the delegated handler**

In `handleCertificateAction`, the existing `switch` reads `btn.dataset`. Note buttons carry no folder/name themselves — the enclosing `.certificate-notes` container does. Add before the existing `switch`:

```js
    if (action === 'edit-note' || action === 'save-note' || action === 'cancel-note') {
        const container = btn.closest('.certificate-notes');
        if (!container) return;
        if (action === 'edit-note') openNoteEditor(container);
        else if (action === 'save-note') saveNote(container);
        else closeNoteEditor(container);
        return;
    }
```

- [ ] **Step 5: Styles**

Append to `public/styles.css`, following its existing custom-property conventions (check variable names used by `.certificate-info` and reuse the same border/muted-text variables rather than hardcoding colors):

```css
/* Certificate notes (issue #41) */
.certificate-notes {
    margin: 10px 0;
    padding-top: 10px;
    border-top: 1px solid var(--border-color);
}
.certificate-notes .note-text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin-bottom: 8px;
}
.certificate-notes .note-editor {
    width: 100%;
    resize: vertical;
    margin-bottom: 8px;
}
.certificate-notes .note-editor-actions {
    display: flex;
    gap: 8px;
}
```

If `--border-color` doesn't exist, use whatever border variable `.certificate-card` uses.

- [ ] **Step 6: Static checks**

Run: `node --check public/script.js && npm test`
Expected: syntax OK; the no-inline-handler source guard and full suite pass.

- [ ] **Step 7: Commit**

```bash
git add public/script.js public/styles.css
git commit -m "feat: notes block on certificate cards (#41)"
```

---

### Task 4: end-to-end verification + docs

**Files:**
- Modify: `README.md` (feature list — add a notes bullet)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Docker walkthrough (matches how users deploy)**

```bash
docker build -t mkcertweb:notes-dev .
docker run -d --rm --name mkcertweb-notes -p 3000:3000 -e ENABLE_AUTH=false mkcertweb:notes-dev
```

Then with Playwright against http://localhost:3000:
1. Generate Root CA, generate a cert (`localhost`).
2. Card shows "Add Note" → click, type a multi-line note, Save → note text renders with line breaks, Edit Note button appears.
3. Reload the page → note still shown (persisted server-side).
4. Edit → Cancel → unchanged. Edit → clear text → Save → back to "Add Note".
5. Re-add a note; Archive the cert → note still on the archived card; Restore → still there.
6. Delete Forever → confirm → `docker exec mkcertweb-notes cat /app/data/certificate-notes.json` shows the entry removed.
7. Console: zero CSP violations; network tab: PUT carries `X-CSRF-Token`.
8. `docker stop mkcertweb-notes`

- [ ] **Step 3: README**

Add to the feature list (match surrounding bullet style):

```markdown
- **Certificate notes**: attach a free-text note to any certificate card to document what it's for; stored in `data/certificate-notes.json`
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: certificate notes feature (#41)"
```
