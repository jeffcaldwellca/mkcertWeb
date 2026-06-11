// CSR identity validation — the CA must not sign arbitrary subjects.
const { test } = require('node:test');
const assert = require('node:assert');
const forge = require('node-forge');
const pkcs7Utils = require('../src/utils/pkcs7');

// One shared keypair: RSA keygen is the slow part and the key is irrelevant
// to subject validation.
const keys = forge.pki.rsa.generateKeyPair(512);

function makeCSR({ cn, dnsNames = [], ips = [] } = {}) {
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = keys.publicKey;
  if (cn !== undefined) {
    csr.setSubject([{ name: 'commonName', value: cn }]);
  }
  const altNames = [
    ...dnsNames.map((value) => ({ type: 2, value })),
    ...ips.map((ip) => ({ type: 7, ip }))
  ];
  if (altNames.length > 0) {
    csr.setAttributes([{
      name: 'extensionRequest',
      extensions: [{ name: 'subjectAltName', altNames }]
    }]);
  }
  csr.sign(keys.privateKey);
  // Round-trip through PEM so the object has the same shape as a CSR the
  // SCEP route parses out of a real request.
  return forge.pki.certificationRequestFromPem(forge.pki.certificationRequestToPem(csr));
}

test('accepts a plain hostname CN with no allowlist', () => {
  const result = pkcs7Utils.validateCSRIdentity(makeCSR({ cn: 'myapp.localhost' }));
  assert.strictEqual(result.ok, true);
});

test('accepts DNS SANs and a wildcard with no allowlist', () => {
  const csr = makeCSR({ cn: 'myapp.test', dnsNames: ['myapp.test', '*.myapp.test'] });
  assert.strictEqual(pkcs7Utils.validateCSRIdentity(csr).ok, true);
});

test('accepts IP address SANs with no allowlist', () => {
  const csr = makeCSR({ cn: 'router.local', ips: ['192.168.1.1'] });
  assert.strictEqual(pkcs7Utils.validateCSRIdentity(csr).ok, true);
});

test('rejects a CSR with no CN and no SANs', () => {
  const result = pkcs7Utils.validateCSRIdentity(makeCSR({}));
  assert.strictEqual(result.ok, false);
});

test('rejects a syntactically invalid hostname', () => {
  const result = pkcs7Utils.validateCSRIdentity(makeCSR({ cn: 'bad host!name' }));
  assert.strictEqual(result.ok, false);
});

test('rejects names with embedded newlines', () => {
  const result = pkcs7Utils.validateCSRIdentity(
    makeCSR({ cn: 'ok.test', dnsNames: ['evil.test\nbasicConstraints=CA:TRUE'] })
  );
  assert.strictEqual(result.ok, false);
});

test('enforces the allowlist as a domain suffix match', () => {
  const allowed = ['internal.example.com'];
  assert.strictEqual(
    pkcs7Utils.validateCSRIdentity(makeCSR({ cn: 'app.internal.example.com' }), allowed).ok,
    true
  );
  assert.strictEqual(
    pkcs7Utils.validateCSRIdentity(makeCSR({ cn: 'internal.example.com' }), allowed).ok,
    true
  );
  assert.strictEqual(
    pkcs7Utils.validateCSRIdentity(makeCSR({ cn: 'login.microsoftonline.com' }), allowed).ok,
    false
  );
  // Suffix match must respect label boundaries: evilinternal.example.com.attacker.net style tricks
  assert.strictEqual(
    pkcs7Utils.validateCSRIdentity(makeCSR({ cn: 'notinternal.example.com' }), allowed).ok,
    false
  );
});

test('allowlist applies to every SAN, not just the CN', () => {
  const allowed = ['internal.example.com'];
  const csr = makeCSR({
    cn: 'app.internal.example.com',
    dnsNames: ['app.internal.example.com', 'login.microsoftonline.com']
  });
  assert.strictEqual(pkcs7Utils.validateCSRIdentity(csr, allowed).ok, false);
});

test('IPs require an exact allowlist entry when an allowlist is configured', () => {
  const allowed = ['internal.example.com', '10.0.0.5'];
  assert.strictEqual(
    pkcs7Utils.validateCSRIdentity(makeCSR({ cn: 'a.internal.example.com', ips: ['10.0.0.5'] }), allowed).ok,
    true
  );
  assert.strictEqual(
    pkcs7Utils.validateCSRIdentity(makeCSR({ cn: 'a.internal.example.com', ips: ['10.0.0.6'] }), allowed).ok,
    false
  );
});
