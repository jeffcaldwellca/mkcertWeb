const test = require('node:test');
const assert = require('node:assert');
const m = require('../public/js/cert-model.js');

const now = new Date('2026-10-29T12:00:00Z');
const inDays = (d) => new Date(now.getTime() + d * 86400000).toISOString();

test('classify buckets by days', () => {
  assert.deepStrictEqual(m.classify({ expiry: inDays(20) }, now), { state: 'attention', daysLeft: 20 });
  assert.strictEqual(m.classify({ expiry: inDays(-17) }, now).state, 'expired');
  assert.strictEqual(m.classify({ expiry: inDays(400) }, now).state, 'valid');
  assert.strictEqual(m.classify({ expiry: inDays(30) }, now).state, 'attention');
  assert.strictEqual(m.classify({ expiry: inDays(31) }, now).state, 'valid');
});

test('classify returns unknown when expiry missing', () => {
  assert.deepStrictEqual(m.classify({ expiry: null }, now), { state: 'unknown', daysLeft: null });
});

test('groupCertificates orders groups and items', () => {
  const certs = [
    { name: 'arch', folder: '2026-01-01', isArchived: true, expiry: inDays(-5) },
    { name: 'iface', isInterfaceSSL: true, expiry: inDays(300) },
    { name: 'soon', folder: '2026-01-02', expiry: inDays(7) },
    { name: 'old', folder: '2026-01-02', expiry: inDays(-29) },
    { name: 'fine', folder: '2026-01-02', expiry: inDays(442) },
  ];
  const groups = m.groupCertificates(certs, now);
  assert.deepStrictEqual(groups.map((g) => g.id), ['attention', 'healthy', 'readonly', 'archived']);
  assert.deepStrictEqual(groups[0].items.map((c) => c.name), ['old', 'soon']);
  assert.deepStrictEqual(groups.map((g) => g.label), ['NEEDS ATTENTION', 'HEALTHY', 'READ-ONLY', 'ARCHIVED']);
});

test('groupCertificates omits empty groups, sorts null last then by name', () => {
  const groups = m.groupCertificates([
    { name: 'b', folder: 'f', expiry: null },
    { name: 'a', folder: 'f', expiry: null },
    { name: 'c', folder: 'f', expiry: inDays(100) },
  ], now);
  assert.deepStrictEqual(groups.map((g) => g.id), ['healthy']);
  assert.deepStrictEqual(groups[0].items.map((c) => c.name), ['c', 'a', 'b']);
});

test('uploaded certs with a folder are not read-only (ruling 1)', () => {
  const groups = m.groupCertificates([{ name: 'u', folder: '2026-01-02', canEdit: false, expiry: inDays(5) }], now);
  assert.deepStrictEqual(groups.map((g) => g.id), ['attention']);
});

test('locationOf matches existing folder rules', () => {
  assert.deepStrictEqual(
    (({ folderParam, readOnly }) => ({ folderParam, readOnly }))(m.locationOf({ folder: '2026-01-02' })),
    { folderParam: '2026-01-02', readOnly: false });
  const i = m.locationOf({ isInterfaceSSL: true });
  assert.strictEqual(i.folderParam, 'interface-ssl');
  assert.strictEqual(i.readOnly, true);
  const r = m.locationOf({ name: 'mkcert-rootCA' });
  assert.strictEqual(r.folderParam, 'root-ca');
  assert.strictEqual(r.isRootCA, true);
  const l = m.locationOf({ canEdit: false });
  assert.strictEqual(l.folderParam, 'legacy');
  assert.strictEqual(l.readOnly, true);
  assert.strictEqual(m.locationOf({ name: 'x', cert: { filename: 'mkcert-rootCA.pem' } }).folderParam, 'root-ca');
  assert.strictEqual(m.certKey({ name: 'a', folder: '2026-01-02' }), '2026-01-02/a');
});

test('parseQuickGenerate strips prefix and separators', () => {
  assert.deepStrictEqual(m.parseQuickGenerate('mkcert  a.test, *.a.test,,a.test 10.0.0.1 '), ['a.test', '*.a.test', '10.0.0.1']);
  assert.deepStrictEqual(m.parseQuickGenerate(''), []);
});

test('matchesQuery', () => {
  assert.strictEqual(m.matchesQuery({ name: 'x', domains: ['*.api.dev.local'] }, 'API.dev'), true);
  assert.strictEqual(m.matchesQuery({ name: '<img src=x>', domains: [] }, 'img'), true);
  assert.strictEqual(m.matchesQuery({ name: 'x' }, ''), true);
  assert.strictEqual(m.matchesQuery({ name: 'x', format: 'PEM', folder: '2026-01-02' }, 'pem'), true);
  assert.strictEqual(m.matchesQuery({ name: 'x', isInterfaceSSL: true }, 'interface'), true);
  assert.strictEqual(m.matchesQuery({ name: 'x' }, 'zzz'), false);
});

test('metaLine', () => {
  assert.strictEqual(m.metaLine({ expiry: inDays(20), domains: ['a', 'b'] }, now), 'expires in 20d · 2 SANs');
  assert.strictEqual(m.metaLine({ expiry: inDays(-17), domains: ['a'] }, now), 'expired 17d ago · 1 SAN');
  assert.strictEqual(m.metaLine({ expiry: null, domains: [] }, now), 'expiry unknown · 0 SANs');
  assert.strictEqual(m.metaLine({ expiry: inDays(442), domains: ['a'] }, now), '442d left · 1 SAN');
});

test('resolveSelection falls back when key missing', () => {
  const groups = m.groupCertificates([{ name: 'a', folder: '2026-01-02', expiry: inDays(100) }], now);
  assert.strictEqual(m.resolveSelection(groups, '2026-01-02/gone'), '2026-01-02/a');
  assert.strictEqual(m.resolveSelection(groups, '2026-01-02/a'), '2026-01-02/a');
  assert.strictEqual(m.resolveSelection(groups, null), '2026-01-02/a');
  assert.strictEqual(m.resolveSelection([], 'x/y'), null);
});

test('hash round-trip', () => {
  assert.strictEqual(m.parseHash(m.formatHash('2026-01-02/a b')), '2026-01-02/a b');
  assert.strictEqual(m.parseHash('#other=1'), null);
  assert.strictEqual(m.parseHash(''), null);
});

test('certKey distinguishes archived from active', () => {
  const active = { name: 'a', folder: '2026-01-02', expiry: inDays(100) };
  const archived = { name: 'a', folder: '2026-01-02', expiry: inDays(100), isArchived: true };
  assert.strictEqual(m.certKey(active), '2026-01-02/a');
  assert.strictEqual(m.certKey(archived), '2026-01-02/archive/a');
  assert.notStrictEqual(m.certKey(active), m.certKey(archived));
  // Both stay selectable through the hash and resolveSelection.
  const groups = m.groupCertificates([active, archived], now);
  assert.strictEqual(m.resolveSelection(groups, m.parseHash(m.formatHash(m.certKey(archived)))), '2026-01-02/archive/a');
  assert.strictEqual(m.resolveSelection(groups, m.parseHash(m.formatHash(m.certKey(active)))), '2026-01-02/a');
});
