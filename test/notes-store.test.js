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
  store.set('a/b', 'recovered'); // first successful save overwrites the bad file
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
