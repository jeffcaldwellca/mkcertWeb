// Guards against 5xx responses leaking server internals (absolute paths,
// stderr, command lines, stack traces). The full error belongs in the server
// log, matched to the response by its `ref`; the body carries a fixed message
// and, for a few admin-actionable failures, a sanitised `reason`.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startApp } = require('./helpers');

const ROOT = path.join(__dirname, '..');

// ---- Source guard ----------------------------------------------------------

// Identifiers that name an error object: e, ex, err, error, or anything
// ending in Err/Error (installError, moveError, loginErr, ...).
const ERRORISH = /\b(?:e|ex|err|error|\w+Err(?:or)?)\b/;

// Return the code in `s` with string-literal text removed: '...' and "..."
// vanish, template literals keep only their ${...} expressions.
function codeOutsideStrings(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\'' || c === '"') {
      for (i++; i < s.length && s[i] !== c; i++) if (s[i] === '\\') i++;
      out += ' ';
    } else if (c === '`') {
      for (i++; i < s.length && s[i] !== '`'; i++) {
        if (s[i] === '\\') { i++; continue; }
        if (s[i] === '$' && s[i + 1] === '{') {
          let depth = 1;
          let expr = '';
          for (i += 2; i < s.length && depth > 0; i++) {
            if (s[i] === '{') depth++;
            else if (s[i] === '}') depth--;
            if (depth > 0) expr += s[i];
          }
          i--;
          out += ' (' + codeOutsideStrings(expr) + ') ';
        }
      }
      out += ' ';
    } else {
      out += c;
    }
  }
  return out;
}

// Split the arguments of the call whose '(' is at `open`. String- and
// bracket-aware; returns { args, end }.
function readArgs(src, open) {
  const args = [];
  let depth = 0;
  let cur = '';
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1;
      for (; j < src.length && src[j] !== c; j++) if (src[j] === '\\') j++;
      cur += src.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      depth++;
      if (depth === 1) continue;
    } else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) { args.push(cur.trim()); return { args, end: i }; }
    } else if (c === ',' && depth === 1) {
      args.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  return { args, end: src.length };
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

// An expression that would put error details in a response body.
function leaks(expr) {
  // Object keys ({ error: 'x' }) are not values.
  const code = codeOutsideStrings(expr).replace(/([{,]\s*)\w+\s*:/g, '$1');
  return ERRORISH.test(code) || /\.(?:stderr|stack)\b/.test(code);
}

// Every serverError(...) / res.status(5xx).json|send(...) whose body could
// carry error details. Returns human-readable descriptions of the offenders.
function findErrorLeaks(source) {
  const src = stripComments(source);
  const found = [];
  for (const m of src.matchAll(/\bserverError\s*\(/g)) {
    const { args } = readArgs(src, m.index + m[0].length - 1);
    const [, message, , extra] = args;
    if (message !== undefined && leaks(message)) found.push(`serverError message: ${message}`);
    // The optional 4th argument may only carry publicReason(err).
    if (extra !== undefined && leaks(extra.replace(/\bpublicReason\s*\(\s*\w+\s*\)/g, "''"))) {
      found.push(`serverError extra: ${extra}`);
    }
    if (args.length > 4) found.push(`serverError has ${args.length} arguments`);
  }
  for (const m of src.matchAll(/\bstatus\s*\(\s*5\d\d\s*\)\s*\.\s*(?:json|send)\s*\(/g)) {
    const { args } = readArgs(src, m.index + m[0].length - 1);
    if (args.some(leaks)) found.push(`5xx body: ${args.join(', ')}`);
  }
  return found;
}

test('findErrorLeaks flags error details in 5xx bodies and allows fixed messages', () => {
  for (const bad of [
    'apiResponse.serverError(res, error.message);',
    'apiResponse.serverError(res, err.message || "x");',
    'apiResponse.serverError(res, `Failed to archive: ${error.message}`);',
    'apiResponse.serverError(res, `Failed: ${err}`);',
    'apiResponse.serverError(res, "Failed: " + error);',
    'apiResponse.serverError(res, err.error || err.message || "Install failed");',
    'apiResponse.serverError(res, detail ? `${message} — ${installError.stderr}` : message);',
    'apiResponse.serverError(res, result.stderr);',
    'apiResponse.serverError(res, String(loginErr));',
    'apiResponse.serverError(res, "Failed", err, { reason: err.message });',
    'apiResponse.serverError(res, "Failed", err, { reason: err.stderr });',
    'res.status(500).json({ success: false, error: err.message });',
    'res.status(502).send(error.stack);',
    "res.status(500).json({ error: 'x', detail: e.stderr });",
  ]) assert.ok(findErrorLeaks(bad).length > 0, bad);

  for (const ok of [
    "apiResponse.serverError(res, 'Failed to archive certificate', error);",
    "apiResponse.serverError(res, 'SMTP verification failed', error, { reason: publicReason(error) });",
    'apiResponse.serverError(res, `Failed to swap certificate ${certname}; check its archive folder`, error);',
    "apiResponse.serverError(res, 'Internal server error');",
    "apiResponse.serverError(res, 'Error reading the error log', err);",
    "res.status(500).json({ success: false, error: 'Login failed' });",
    'res.status(500).end();',
    "// apiResponse.serverError(res, error.message);\nconst a = 1;",
  ]) assert.deepStrictEqual(findErrorLeaks(ok), [], ok);
});

test('no 5xx response in src/routes or server.js carries error details', () => {
  const routesDir = path.join(ROOT, 'src/routes');
  const files = [
    ...fs.readdirSync(routesDir).filter((n) => n.endsWith('.js')).map((n) => `src/routes/${n}`),
    'server.js',
  ];
  for (const rel of files) {
    const hits = findErrorLeaks(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    assert.deepStrictEqual(hits, [], `${rel}: 5xx body built from an error object`);
  }
});

function guardedSources() {
  const routesDir = path.join(ROOT, 'src/routes');
  return [
    ...fs.readdirSync(routesDir).filter((n) => n.endsWith('.js')).map((n) => `src/routes/${n}`),
    'server.js',
  ].map((rel) => ({ rel, src: stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8')) }));
}

test('every JSON/text 5xx goes through serverError, so it carries a ref', () => {
  for (const { rel, src } of guardedSources()) {
    const hits = [...src.matchAll(/\bstatus\s*\(\s*5\d\d\s*\)\s*\.\s*(?:json|send)\s*\(/g)].map((m) => m[0]);
    assert.deepStrictEqual(hits, [], `${rel}: hand-written 5xx body; use apiResponse.serverError`);
  }
});

test('serverError logs the error itself: no separate console.error right before it', () => {
  for (const { rel, src } of guardedSources()) {
    const hits = [...src.matchAll(/console\.error\([^;]*\);\s*(?:return\s+)?apiResponse\.serverError\([^;]*;/g)].map((m) => m[0]);
    assert.deepStrictEqual(hits, [], `${rel}: pass the error to serverError instead of logging it separately`);
  }
});

// ---- serverError -----------------------------------------------------------

function mockRes(req) {
  return {
    req,
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

// Captures console.error, .warn and .log (everything a handler might log).
function captureConsoleError(fn) {
  const logged = [];
  const util = require('util');
  const orig = { error: console.error, warn: console.warn, log: console.log };
  for (const k of Object.keys(orig)) {
    console[k] = (...a) => logged.push(a.map((x) => (typeof x === 'string' ? x : util.inspect(x, { depth: 5 }))).join(' '));
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => { Object.assign(console, orig); })
    .then((result) => ({ result, logged }));
}

function freshResponses() {
  delete require.cache[require.resolve('../src/utils/responses')];
  return require('../src/utils/responses');
}

test('serverError responds with the fixed message and a ref, and logs the full error with that ref', async () => {
  const { apiResponse } = freshResponses();
  const err = new Error(`EACCES: permission denied, open '${process.cwd()}/certificates/x.pem'`);
  const res = mockRes({ method: 'POST', originalUrl: '/api/certificates/2099-01-01/x/archive?secret=1' });
  const { logged } = await captureConsoleError(() => apiResponse.serverError(res, 'Failed to archive certificate', err));
  assert.strictEqual(res.statusCode, 500);
  assert.deepStrictEqual(Object.keys(res.body).sort(), ['error', 'ref', 'success']);
  assert.strictEqual(res.body.success, false);
  assert.strictEqual(res.body.error, 'Failed to archive certificate');
  assert.match(res.body.ref, /^[0-9a-f]{8}$/);
  const line = logged.join('\n');
  assert.ok(line.includes(res.body.ref), 'log carries the ref');
  assert.ok(line.includes('EACCES: permission denied'), 'log carries the full error');
  assert.ok(line.includes('POST /api/certificates/2099-01-01/x/archive'), 'log carries method and path');
  assert.ok(!line.includes('secret=1'), 'query string is not logged');
});

test('serverError stays backwards compatible: message only, and the default message', async () => {
  const { apiResponse } = freshResponses();
  const a = mockRes();
  const b = mockRes();
  await captureConsoleError(() => {
    apiResponse.serverError(a, 'Could not determine CA root directory');
    apiResponse.serverError(b);
  });
  assert.strictEqual(a.body.error, 'Could not determine CA root directory');
  assert.match(a.body.ref, /^[0-9a-f]{8}$/);
  assert.strictEqual(b.body.error, 'Internal server error');
  assert.notStrictEqual(a.body.ref, b.body.ref);
});

test('serverError never echoes the error, even with NODE_ENV=development', async () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    const { apiResponse } = freshResponses();
    const err = new Error('/home/someone/app/secret.pem missing');
    const res = mockRes();
    await captureConsoleError(() => apiResponse.serverError(res, 'Internal server error', err));
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes('/home'), text);
    assert.ok(!('stack' in res.body), text);
    assert.strictEqual(res.body.error, 'Internal server error');
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev;
    freshResponses();
  }
});

test('serverError passes only a string reason through from the extra argument', async () => {
  const { apiResponse } = freshResponses();
  const res = mockRes();
  await captureConsoleError(() => apiResponse.serverError(res, 'SMTP verification failed', new Error('x'),
    { reason: 'ECONNREFUSED', stack: 'leak', error: 'leak' }));
  assert.deepStrictEqual(Object.keys(res.body).sort(), ['error', 'reason', 'ref', 'success']);
  assert.strictEqual(res.body.reason, 'ECONNREFUSED');
  assert.strictEqual(res.body.error, 'SMTP verification failed');
});

// ---- publicReason ----------------------------------------------------------

test('publicReason returns a string error code when there is one', () => {
  const { publicReason } = freshResponses();
  assert.strictEqual(publicReason(Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:25'), { code: 'ECONNREFUSED' })), 'ECONNREFUSED');
  assert.strictEqual(publicReason(Object.assign(new Error('Invalid login: 535 bad creds for bob'), { code: 'EAUTH' })), 'EAUTH');
  // nodemailer: code ESOCKET, but the system errno says what happened.
  assert.strictEqual(publicReason(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'),
    { code: 'ESOCKET', errno: -os.constants.errno.ECONNREFUSED, syscall: 'connect' })), 'ECONNREFUSED');
  // A wrapper error that keeps the original as its cause.
  const inner = Object.assign(new Error('connect ETIMEDOUT 10.0.0.5:25'), { code: 'ETIMEDOUT' });
  assert.strictEqual(publicReason(new Error('SMTP verification failed: connect ETIMEDOUT 10.0.0.5:25', { cause: inner })), 'ETIMEDOUT');
  // runTool-style rejection with a spawn errno code.
  assert.strictEqual(publicReason({ error: 'spawn mkcert ENOENT', stderr: '', code: 'ENOENT' }), 'ENOENT');
  // A numeric exit code is not a reason.
  assert.strictEqual(publicReason({ error: 'Command failed: mkcert -install', code: 1, stderr: 'ERROR: needs sudo' }), 'ERROR: needs sudo');
});

test('publicReason strips cwd, home, CAROOT and absolute paths, and truncates', () => {
  const { publicReason } = freshResponses();
  const home = os.homedir();
  const cwd = process.cwd();
  const prevCaroot = process.env.CAROOT;
  process.env.CAROOT = '/opt/ca root';
  try {
    const r1 = publicReason(new Error(`open ${cwd}/certificates/a.pem failed\nsecond line ${home}`));
    assert.strictEqual(r1, 'open <path> failed');
    const r2 = publicReason(new Error(`cannot read ${home}/Library/Application Support/mkcert/rootCA.pem`));
    assert.ok(!r2.includes(home) && !r2.includes('/Library'), r2);
    const r3 = publicReason(new Error('ERROR: failed to read "/opt/ca root/rootCA-key.pem": denied'));
    assert.ok(!r3.includes('/opt'), r3);
    const r4 = publicReason(new Error('failed at /usr/local/share/ca-certificates/x.crt and C:\\Users\\bob\\x.pem'));
    assert.strictEqual(r4, 'failed at <path> and <path>');
    const long = publicReason(new Error('x'.repeat(500)));
    assert.ok(long.length <= 120, `length ${long.length}`);
    // stderr's last line is the fatal error for a child process.
    const r5 = publicReason({
      error: `Command failed: mkcert -install\nERROR: failed to execute "tee": exit status 1`,
      stderr: `Created a new local CA at "${home}/.local/share/mkcert" 💥\nSudo password:\nERROR: failed to execute "tee": exit status 1\n`
    });
    assert.strictEqual(r5, 'ERROR: failed to execute "tee": exit status 1');
    assert.strictEqual(publicReason(null), undefined);
    assert.strictEqual(publicReason({}), undefined);
  } finally {
    if (prevCaroot === undefined) delete process.env.CAROOT; else process.env.CAROOT = prevCaroot;
  }
});

// ---- Behaviour through the real routes -------------------------------------

const pass = (req, res, next) => next();
const rateLimiters = { cliRateLimiter: pass, generalRateLimiter: pass, apiRateLimiter: pass };

test('archive: a forced fs error returns a generic body with a ref; the log has the full error', async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leak-archive-'));
  const realCwd = process.cwd();
  process.chdir(workDir);
  const realRename = fs.renameSync;
  try {
    const folder = '2099-05-05';
    const dir = path.join(workDir, 'certificates', folder);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'leaky.pem'), 'C');
    fs.writeFileSync(path.join(dir, 'leaky-key.pem'), 'K');
    const { createCertificateRoutes } = freshCertRoutes();
    const config = { auth: { enabled: true }, oidc: { enabled: false }, paths: { certificates: 'certificates' } };
    const app = await startApp((a) => a.use(createCertificateRoutes(config, rateLimiters, pass)));
    const leak = `EACCES: permission denied, rename '${dir}/leaky.pem' -> '${dir}/archive/leaky.pem'`;
    fs.renameSync = () => { throw Object.assign(new Error(leak), { code: 'EACCES' }); };
    try {
      const { result: res, logged } = await captureConsoleError(async () => {
        const r = await fetch(`${app.url}/api/certificates/${folder}/leaky/archive`, { method: 'POST' });
        return { status: r.status, text: await r.text() };
      });
      assert.strictEqual(res.status, 500);
      const body = JSON.parse(res.text);
      assert.strictEqual(body.error, 'Failed to archive certificate');
      assert.match(body.ref, /^[0-9a-f]{8}$/);
      assert.ok(!res.text.includes('/'), `no path in body: ${res.text}`);
      assert.ok(!('reason' in body), 'file errors get no reason');
      const log = logged.join('\n');
      assert.ok(log.includes(body.ref) && log.includes(leak), log);
    } finally {
      fs.renameSync = realRename;
      await app.close();
    }
  } finally {
    fs.renameSync = realRename;
    process.chdir(realCwd);
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

function freshCertRoutes() {
  delete require.cache[require.resolve('../src/routes/certificates')];
  return require('../src/routes/certificates');
}

test('email verify/test: a refused SMTP connection returns reason ECONNREFUSED and no host or path', async () => {
  const EmailService = require('../src/services/emailService');
  const createNotificationRoutes = require('../src/routes/notifications');
  const config = {
    email: {
      enabled: true,
      smtp: { host: '127.0.0.1', port: 1, secure: false, auth: { user: 'u', pass: 'p' }, tls: {} },
      from: 'a@b.test', to: 'c@d.test', subject: 's'
    },
    monitoring: { enabled: false }
  };
  const emailService = new (EmailService.EmailService || EmailService)(config);
  const app = await startApp((a) => a.use(createNotificationRoutes(config, rateLimiters, pass, emailService, {}, null, null)));
  try {
    for (const [route, message] of [['/api/email/verify', 'SMTP verification failed'], ['/api/email/test', 'Email test failed']]) {
      const { result: res, logged } = await captureConsoleError(async () => {
        const r = await fetch(app.url + route, { method: 'POST' });
        return { status: r.status, text: await r.text() };
      });
      assert.strictEqual(res.status, 500, res.text);
      const body = JSON.parse(res.text);
      assert.strictEqual(body.error, message);
      assert.strictEqual(body.reason, 'ECONNREFUSED');
      assert.match(body.ref, /^[0-9a-f]{8}$/);
      assert.ok(!res.text.includes('127.0.0.1') && !res.text.includes('/'), res.text);
      const log = logged.join('\n');
      assert.ok(log.includes(body.ref) && log.includes('127.0.0.1:1'), log);
    }
  } finally {
    await app.close();
  }
});

test('settings: a failing route logs the full error under the response ref', async () => {
  const createSettingsRoutes = require('../src/routes/settings');
  const config = { auth: { enabled: true } };
  Object.defineProperty(config, 'email', { enumerable: true, get() { throw new Error('boom reading /secret/settings/path'); } });
  const app = await startApp((a) => a.use('/api/settings', createSettingsRoutes(config, rateLimiters, pass)));
  try {
    const { result: res, logged } = await captureConsoleError(async () => {
      const r = await fetch(`${app.url}/api/settings/running`);
      return { status: r.status, text: await r.text() };
    });
    assert.strictEqual(res.status, 500, res.text);
    const body = JSON.parse(res.text);
    assert.strictEqual(body.error, 'Failed to get running configuration');
    assert.match(body.ref, /^[0-9a-f]{8}$/);
    assert.ok(!res.text.includes('/secret'), res.text);
    const withRef = logged.filter((l) => l.includes(body.ref));
    assert.ok(withRef.some((l) => l.includes('boom reading /secret/settings/path')), logged.join('\n'));
    assert.ok(!logged.some((l) => l.includes('boom') && !l.includes(body.ref)), 'no second, ref-less log line');
  } finally {
    await app.close();
  }
});

// ---- Central error handler --------------------------------------------------

async function withErrorHandlerApp(fn) {
  const { errorHandler } = freshResponses();
  // startApp already mounts express.json() (100kb limit).
  const app = await startApp((a) => {
    a.post('/echo', (req, res) => res.json({ success: true }));
    a.get('/boom', (req, res, next) => next(new Error(`EACCES: open '${process.cwd()}/x'`)));
    a.get('/not-found-file', (req, res, next) => next(Object.assign(new Error('ENOENT: /abs/file'), { status: 404, statusCode: 404, expose: true })));
    a.use(errorHandler);
  });
  try { return await fn(app); } finally { await app.close(); }
}

test('errorHandler: malformed JSON is a 400 with a fixed message, and the raw body is not logged', async () => {
  await withErrorHandlerApp(async (app) => {
    const { result: res, logged } = await captureConsoleError(async () => {
      const r = await fetch(`${app.url}/echo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"hunter2-secret",' });
      return { status: r.status, body: await r.json() };
    });
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { success: false, error: 'Invalid request body' });
    assert.ok(!logged.join('\n').includes('hunter2'), 'raw body must not be logged');
  });
});

test('errorHandler: an oversized body is a 413', async () => {
  await withErrorHandlerApp(async (app) => {
    const { result: res } = await captureConsoleError(async () => {
      const r = await fetch(`${app.url}/echo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(200 * 1024) }) });
      return { status: r.status, body: await r.json() };
    });
    assert.strictEqual(res.status, 413);
    assert.deepStrictEqual(res.body, { success: false, error: 'Request body too large' });
  });
});

test('errorHandler: another exposed 4xx keeps its status with a generic message', async () => {
  await withErrorHandlerApp(async (app) => {
    const { result: res } = await captureConsoleError(async () => {
      const r = await fetch(`${app.url}/not-found-file`);
      return { status: r.status, text: await r.text() };
    });
    assert.strictEqual(res.status, 404);
    assert.deepStrictEqual(JSON.parse(res.text), { success: false, error: 'Not Found' });
  });
});

test('errorHandler: anything else is a 500 with a ref, and the log has the full error', async () => {
  await withErrorHandlerApp(async (app) => {
    const { result: res, logged } = await captureConsoleError(async () => {
      const r = await fetch(`${app.url}/boom`);
      return { status: r.status, text: await r.text() };
    });
    assert.strictEqual(res.status, 500);
    const body = JSON.parse(res.text);
    assert.strictEqual(body.error, 'Internal server error');
    assert.match(body.ref, /^[0-9a-f]{8}$/);
    assert.ok(!res.text.includes('/'), res.text);
    assert.ok(logged.some((l) => l.includes(body.ref) && l.includes('EACCES')), logged.join('\n'));
  });
});

test('server.js uses the shared errorHandler', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(src, /app\.use\(errorHandler\)/);
});

// ---- CA routes, with runTool stubbed (never run mkcert -install) -----------

const security = require('../src/security');

async function postSystem(route, stub, { config, body } = {}) {
  const realRunTool = security.runTool;
  security.runTool = stub;
  delete require.cache[require.resolve('../src/routes/system')];
  const { createSystemRoutes } = require('../src/routes/system');
  const cfg = config || { auth: { enabled: true }, oidc: { enabled: false } };
  const app = await startApp((a) => a.use(createSystemRoutes(cfg, rateLimiters, pass)));
  try {
    return await captureConsoleError(async () => {
      const r = await fetch(app.url + route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
      return { status: r.status, text: await r.text() };
    });
  } finally {
    await app.close();
    security.runTool = realRunTool;
    delete require.cache[require.resolve('../src/routes/system')];
  }
}

const sudoFailure = {
  error: `Command failed: mkcert -install\nSudo password: ERROR: add cert: open ${os.homedir()}/.local/share/mkcert/rootCA.pem: permission denied`,
  stderr: `Sudo password:\nERROR: add cert: open ${os.homedir()}/.local/share/mkcert/rootCA.pem: permission denied\n`
};

test('install-ca failure: fixed message, sanitised reason, ref; no command line or path', async () => {
  const { result: res, logged } = await postSystem('/api/install-ca', async () => { throw sudoFailure; });
  assert.strictEqual(res.status, 500);
  const body = JSON.parse(res.text);
  assert.strictEqual(body.error, 'Failed to install the root CA');
  assert.strictEqual(body.reason, 'ERROR: add cert: open <path>: permission denied');
  assert.match(body.ref, /^[0-9a-f]{8}$/);
  assert.ok(!res.text.includes(os.homedir()) && !res.text.includes('Command failed'), res.text);
  assert.ok(logged.join('\n').includes(body.ref) && logged.join('\n').includes(os.homedir()));
});

test('install-ca with mkcert missing reports ENOENT', async () => {
  const { result: res } = await postSystem('/api/install-ca', async () => {
    throw { error: 'spawn mkcert ENOENT', stderr: '', code: 'ENOENT' };
  });
  const body = JSON.parse(res.text);
  assert.strictEqual(res.status, 500);
  assert.strictEqual(body.reason, 'ENOENT');
});

test('uninstall-ca failure: fixed message, sanitised reason, ref', async () => {
  const { result: res } = await postSystem('/api/uninstall-ca', async () => { throw sudoFailure; }, { body: { confirm: true } });
  assert.strictEqual(res.status, 500);
  const body = JSON.parse(res.text);
  assert.strictEqual(body.error, 'Failed to uninstall the root CA');
  assert.ok(body.reason && !body.reason.includes(os.homedir()), res.text);
  assert.match(body.ref, /^[0-9a-f]{8}$/);
});

test('generate-ca failure: fixed message, sanitised reason, ref; no stderr verbatim', async () => {
  const caRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leak-caroot-'));
  try {
    const { result: res } = await postSystem('/api/generate-ca', async (tool, args) => {
      if (args[0] === '-help') return { stdout: '', stderr: '' };
      if (args[0] === '-CAROOT') return { stdout: `${caRoot}\n`, stderr: '' };
      if (args[0] === '-install') throw { error: 'Command failed: mkcert -install', stderr: `ERROR: failed to save CA key: open ${caRoot}/rootCA-key.pem: permission denied` };
      throw new Error('unexpected');
    });
    assert.strictEqual(res.status, 500);
    const body = JSON.parse(res.text);
    assert.strictEqual(body.error, 'Failed to generate the root CA');
    assert.strictEqual(body.reason, 'ERROR: failed to save CA key: open <path>: permission denied');
    assert.ok(!res.text.includes(caRoot) && !res.text.includes('Command failed'), res.text);
  } finally {
    fs.rmSync(caRoot, { recursive: true, force: true });
  }
});

module.exports = { findErrorLeaks };
