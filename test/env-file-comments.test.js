// `docker run --env-file` (unlike dotenv) keeps everything after `=`, so an
// inline comment becomes part of the value: `CERT_MONITOR_UPLOADED=false  # …`
// would not read as false. Comments in the env files go on their own line.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENV_FILES = [
  '.env.example',
  ...fs.readdirSync(path.join(ROOT, 'examples')).filter((n) => n.endsWith('.env')).map((n) => `examples/${n}`),
];

// Lines that would carry an inline comment into a value once used: a
// variable line, or a commented-out one ("# VAR=value") someone uncomments.
function inlineComments(text) {
  return text.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => {
      const t = line.trim();
      if (t === '') return false;
      const assignment = /^#?\s*[A-Z_][A-Z0-9_]*=/.test(t);
      if (!t.startsWith('#')) return /\s#/.test(t);
      return assignment && /\s#/.test(t.replace(/^#\s*/, ''));
    })
    .map(({ line, n }) => `${n}: ${line}`);
}

test('inlineComments flags inline comments and allows values containing #', () => {
  assert.strictEqual(inlineComments('CERT_MONITOR_UPLOADED=false   # twice').length, 1);
  assert.strictEqual(inlineComments('# PORT=3000   # HTTP port').length, 1);
  assert.strictEqual(inlineComments('SMTP_PORT=587\t# tls').length, 1);
  assert.deepStrictEqual(inlineComments('# HTTP port\n# PORT=3000\nTHEME_PRIMARY_COLOR=#007bff\n# Steps #1 and #2\n'), []);
});

for (const rel of ENV_FILES) {
  test(`${rel}: no inline comments on variable lines`, () => {
    assert.deepStrictEqual(inlineComments(fs.readFileSync(path.join(ROOT, rel), 'utf8')), []);
  });
}
