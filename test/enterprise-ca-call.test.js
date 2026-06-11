const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const security = require('../src/security');
const enterpriseCA = require('../src/utils/enterpriseCA');

let originalExecute;
before(() => { originalExecute = security.executeCommand; });
after(() => { security.executeCommand = originalExecute; });

test('generateEnterpriseOrMkcertCertificate accepts an options object (mkcert path)', async () => {
  const outputPath = fs.mkdtempSync(path.join(os.tmpdir(), 'mkcertweb-eca-'));
  // Stub the spawn: emulate mkcert by dropping a cert + key file in outputPath.
  security.executeCommand = async () => {
    fs.writeFileSync(path.join(outputPath, 'app.example.com.pem'), 'cert');
    fs.writeFileSync(path.join(outputPath, 'app.example.com-key.pem'), 'key');
    return { stdout: 'ok', stderr: '' };
  };

  const result = await enterpriseCA.generateEnterpriseOrMkcertCertificate({
    commonName: 'app.example.com',
    template: 'Computer',
    subjectAltNames: ['app.example.com'],
    outputPath
  });

  assert.strictEqual(result.method, 'mkcert');
  assert.strictEqual(result.commonName, 'app.example.com');
  assert.ok(result.certificatePath.endsWith('app.example.com.pem'));

  fs.rmSync(outputPath, { recursive: true, force: true });
});

test('generateEnterpriseOrMkcertCertificate rejects an injected SAN before spawning', async () => {
  let spawned = false;
  security.executeCommand = async () => { spawned = true; return { stdout: '', stderr: '' }; };

  await assert.rejects(() => enterpriseCA.generateEnterpriseOrMkcertCertificate({
    commonName: 'app.example.com',
    subjectAltNames: ['evil.com\nbasicConstraints = CA:TRUE'],
    outputPath: os.tmpdir()
  }));
  assert.strictEqual(spawned, false, 'no command should run when identity is invalid');
});
