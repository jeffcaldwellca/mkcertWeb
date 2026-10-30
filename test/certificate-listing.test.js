// findAllCertificateFiles: skips .swap-* leftovers (with a warning) and
// tolerates directories that vanish while it scans.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fse = require('fs-extra');
const os = require('node:os');
const path = require('node:path');
const { findAllCertificateFiles } = require('../src/utils/certificates');

function makeTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-listing-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

const names = (files) => files.map((f) => f.relativePath).sort();

test('skips .swap-* files and warns with the file name', async () => {
  const root = makeTree({
    '2099-01-01/a.pem': 'A',
    '2099-01-01/archive/a.pem': 'A',
    '2099-01-01/archive/.swap-0123456789abcdef-a.pem': 'T',
    '2099-01-01/archive/.swap-0123456789abcdef-a-key.pem': 'T'
  });
  const realWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const files = await findAllCertificateFiles(root);
    assert.deepStrictEqual(names(files), [path.join('2099-01-01', 'a.pem'), path.join('2099-01-01', 'archive', 'a.pem')]);
    assert.strictEqual(warnings.length, 2, warnings.join('\n'));
    assert.ok(warnings.some((w) => w.includes(path.join('2099-01-01', 'archive', '.swap-0123456789abcdef-a.pem'))));
    assert.ok(warnings.some((w) => w.includes('.swap-0123456789abcdef-a-key.pem')));
  } finally {
    console.warn = realWarn;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a missing root directory lists nothing instead of throwing', async () => {
  const missing = path.join(os.tmpdir(), `cert-listing-missing-${process.pid}-${Date.now()}`);
  assert.deepStrictEqual(await findAllCertificateFiles(missing), []);
});

test('a subdirectory that disappears mid-scan is skipped', async () => {
  const root = makeTree({ '2099-01-01/a.pem': 'A', '2099-01-02/b.pem': 'B' });
  const gone = path.join(root, '2099-01-01');
  const realReaddir = fse.readdir;
  fse.readdir = function (dir, ...rest) {
    if (dir === gone) {
      const err = new Error(`ENOENT: no such file or directory, scandir '${dir}'`);
      err.code = 'ENOENT';
      return Promise.reject(err);
    }
    return realReaddir.call(this, dir, ...rest);
  };
  try {
    const files = await findAllCertificateFiles(root);
    assert.deepStrictEqual(names(files), [path.join('2099-01-02', 'b.pem')]);
  } finally {
    fse.readdir = realReaddir;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('other readdir errors still propagate', async () => {
  const root = makeTree({ '2099-01-01/a.pem': 'A' });
  const realReaddir = fse.readdir;
  fse.readdir = function () {
    const err = new Error('EACCES: permission denied');
    err.code = 'EACCES';
    return Promise.reject(err);
  };
  try {
    await assert.rejects(findAllCertificateFiles(root), { code: 'EACCES' });
  } finally {
    fse.readdir = realReaddir;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
