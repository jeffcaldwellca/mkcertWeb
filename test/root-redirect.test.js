// GET / is the certificates page. With ENABLE_AUTH=true an anonymous visitor
// must be sent to /login by server.js's app.get('/'), which only runs if the
// static middleware doesn't answer "/" with public/index.html first
// (express.static's index option). These tests boot the real server.js in a
// child process, from a scratch working directory, with env-only settings.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PAGES = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html'));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Start server.js with only the given env (plus PATH/HOME), in a temp cwd so
// certificates/ and data/ land there, not in the repo.
async function bootServer(extraEnv) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mkcertweb-root-'));
  const port = await freePort();
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: 'test',
    PORT: String(port),
    SESSION_SECRET: 'test-secret-0123456789abcdef',
    ...extraEnv
  };
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start:\n' + log)), 15000);
    const onData = (chunk) => {
      log += chunk;
      if (log.includes('HTTP server running') && log.includes('Certificate storage:')) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${log}`)); });
  });
  return {
    url: `http://127.0.0.1:${port}`,
    cwd: fs.realpathSync(cwd),
    log: () => log,
    stop: async () => {
      child.removeAllListeners('exit');
      if (child.exitCode === null) {
        const exited = new Promise((r) => child.once('exit', r));
        child.kill('SIGTERM');
        await exited;
      }
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  };
}

const get = (url, opts = {}) => fetch(url, { redirect: 'manual', ...opts });

describe('auth on', () => {
  let srv;
  before(async () => {
    srv = await bootServer({ ENABLE_AUTH: 'true', AUTH_USERNAME: 'tester', AUTH_PASSWORD: 'test-pass-12345' });
  });
  after(async () => { if (srv) await srv.stop(); });

  test('anonymous GET / redirects to /login', async () => {
    const res = await get(`${srv.url}/`);
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), '/login');
  });

  test('GET /login serves the login page', async () => {
    const res = await get(`${srv.url}/login`);
    assert.strictEqual(res.status, 200);
    assert.match(await res.text(), /js\/login\.js/);
  });

  test('a logged-in GET / serves the certificates page', async () => {
    const login = await get(`${srv.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'tester', password: 'test-pass-12345' })
    });
    assert.strictEqual(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const res = await get(`${srv.url}/`, { headers: { cookie } });
    assert.strictEqual(res.status, 200);
    assert.match(await res.text(), /js\/certificates\.js/);
  });

  // Pages are static files; their data comes from API routes that need a
  // session (a 401 there sends the browser to /login). /index.html is one of
  // them, like /root-ca.html, so only "/" itself redirects on the server.
  test('every public/*.html, including /index.html, is still served', async () => {
    assert.ok(PAGES.includes('index.html') && PAGES.length >= 6);
    for (const page of PAGES) {
      const res = await get(`${srv.url}/${page}`);
      assert.strictEqual(res.status, 200, page);
      assert.match(res.headers.get('content-type'), /text\/html/, page);
    }
    assert.strictEqual((await get(`${srv.url}/css/app.css`)).status, 200);
  });

  test('the certificate list still needs a session', async () => {
    const res = await get(`${srv.url}/api/certificates`);
    assert.strictEqual(res.status, 401);
  });
});

describe('auth off', () => {
  let srv;
  before(async () => { srv = await bootServer({ ENABLE_AUTH: 'false' }); });
  after(async () => { if (srv) await srv.stop(); });

  // The certificate routes use process.cwd()/certificates; the startup log
  // must name that directory, not the one next to server.js.
  test('the startup log names the certificates directory the routes use', () => {
    const want = path.join(srv.cwd, 'certificates');
    assert.ok(srv.log().includes(`Certificate storage: ${want}\n`), srv.log());
    assert.ok(fs.existsSync(want));
  });

  test('GET / serves index.html', async () => {
    const res = await get(`${srv.url}/`);
    assert.strictEqual(res.status, 200);
    const body = await res.text();
    assert.strictEqual(body, fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8'));
  });

  test('GET /login redirects to /', async () => {
    const res = await get(`${srv.url}/login`);
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), '/');
  });

  test('every public/*.html is served', async () => {
    for (const page of PAGES) {
      assert.strictEqual((await get(`${srv.url}/${page}`)).status, 200, page);
    }
  });
});
