const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
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
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=note-test',
    '-keyout', path.join(folderDir, 'note-test-key.pem'),
    '-out', path.join(folderDir, 'note-test.pem')
  ], { stdio: 'ignore' });
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
