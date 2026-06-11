const { test } = require('node:test');
const assert = require('node:assert');
const { groupCertificates } = require('../src/utils/certificates');

// Build a cert-entry object in the shape the /api/certificates route produces.
function entry(relativePath, overrides = {}) {
  const filename = relativePath.split('/').pop();
  const isKey = filename.endsWith('-key.pem') || filename.endsWith('.key');
  const isP12 = filename.endsWith('.p12') || filename.endsWith('.pfx');
  const dirParts = relativePath.split('/').slice(0, -1);
  return {
    filename,
    relativePath,
    path: '/certs/' + relativePath,
    type: isKey ? 'key' : isP12 ? 'p12' : 'cert',
    domains: isKey || isP12 ? [] : ['example.com'],
    expiry: isKey || isP12 ? null : '2027-01-01',
    fingerprint: isKey || isP12 ? null : 'AA:BB',
    format: isP12 ? 'p12' : 'pem',
    folder: dirParts.length ? dirParts[0] : null,
    folderDate: /^\d{4}-\d{2}-\d{2}$/.test(dirParts[0] || '') ? dirParts[0] : null,
    isArchived: dirParts.includes('archive'),
    isInterfaceSSL: dirParts.length === 0,
    canEdit: dirParts[0] !== 'uploaded' && dirParts.length !== 0,
    ...overrides
  };
}

test('pairs a cert with its key in the same folder into one group', () => {
  const groups = groupCertificates([
    entry('2026-06-01/example.com.pem'),
    entry('2026-06-01/example.com-key.pem')
  ]);
  assert.strictEqual(groups.length, 1);
  assert.ok(groups[0].cert, 'cert set');
  assert.ok(groups[0].key, 'key set');
  assert.strictEqual(groups[0].name, 'example.com');
});

test('does NOT merge same-named certs from different date folders', () => {
  const groups = groupCertificates([
    entry('2026-06-01/example.com.pem'),
    entry('2026-06-01/example.com-key.pem'),
    entry('2026-06-09/example.com.pem'),
    entry('2026-06-09/example.com-key.pem')
  ]);
  assert.strictEqual(groups.length, 2, 'two separate certificate entries');
  const folders = groups.map((g) => g.folder).sort();
  assert.deepStrictEqual(folders, ['2026-06-01', '2026-06-09']);
});

test('keeps an archived copy separate from the live certificate', () => {
  const groups = groupCertificates([
    entry('2026-06-01/example.com.pem'),
    entry('archive/2026-06-01/example.com.pem')
  ]);
  assert.strictEqual(groups.length, 2);
  assert.strictEqual(groups.filter((g) => g.isArchived).length, 1);
  assert.strictEqual(groups.filter((g) => !g.isArchived).length, 1);
});

test('groups an interface-SSL cert and key at the certificates root', () => {
  const groups = groupCertificates([
    entry('interface.pem'),
    entry('interface-key.pem')
  ]);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].isInterfaceSSL, true);
  assert.ok(groups[0].cert && groups[0].key);
});

test('a p12 bundle is one group carrying cert + synthetic key', () => {
  const groups = groupCertificates([entry('2026-06-01/example.com.p12')]);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].format, 'p12');
  assert.ok(groups[0].cert);
  assert.strictEqual(groups[0].key.type, 'p12-bundle');
});

test('skips entries that failed to process', () => {
  const groups = groupCertificates([
    { filename: 'broken.pem', error: 'Could not read certificate details' },
    entry('2026-06-01/good.com.pem')
  ]);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].name, 'good.com');
});
