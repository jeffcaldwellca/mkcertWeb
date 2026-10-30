const { test } = require('node:test');
const assert = require('node:assert');
const core = require('../public/js/core.js');

function fakeFetch(queue) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    calls.push({ url, opts });
    const next = queue.shift();
    if (!next) throw new Error('no queued response for ' + url);
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body
    };
  };
  impl.calls = calls;
  return impl;
}

test('escapeHtml escapes all five characters and blanks null', () => {
  assert.strictEqual(core.escapeHtml('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.strictEqual(core.escapeHtml(null), '');
  assert.strictEqual(core.escapeHtml(undefined), '');
});

test('get returns parsed body', async () => {
  const f = fakeFetch([{ status: 200, body: { success: true, certificates: [1] } }]);
  const api = core.createApiClient({ fetchImpl: f });
  const res = await api.get('/certificates');
  assert.deepStrictEqual(res.certificates, [1]);
  assert.strictEqual(f.calls.length, 1);
  assert.strictEqual(f.calls[0].url, '/api/certificates');
  assert.strictEqual(f.calls[0].opts.credentials, 'include');
});

test('post fetches csrf once and sends header', async () => {
  const f = fakeFetch([
    { status: 200, body: { csrfToken: 't1' } },
    { status: 200, body: { success: true } },
    { status: 200, body: { success: true } }
  ]);
  const api = core.createApiClient({ fetchImpl: f });
  await api.post('/a', { x: 1 });
  await api.post('/b');
  assert.strictEqual(f.calls.filter(c => c.url === '/api/csrf-token').length, 1);
  const posts = f.calls.filter(c => c.opts.method === 'POST');
  assert.strictEqual(posts.length, 2);
  for (const p of posts) assert.strictEqual(p.opts.headers['X-CSRF-Token'], 't1');
  assert.strictEqual(posts[0].opts.body, JSON.stringify({ x: 1 }));
});

test('post retries once on CSRF_INVALID', async () => {
  const f = fakeFetch([
    { status: 200, body: { csrfToken: 't1' } },
    { status: 403, body: { success: false, code: 'CSRF_INVALID' } },
    { status: 200, body: { csrfToken: 't2' } },
    { status: 200, body: { success: true } }
  ]);
  const api = core.createApiClient({ fetchImpl: f });
  const res = await api.post('/a', {});
  assert.strictEqual(res.success, true);
  const posts = f.calls.filter(c => c.opts.method === 'POST');
  assert.strictEqual(posts.length, 2);
  assert.strictEqual(posts[1].opts.headers['X-CSRF-Token'], 't2');
});

test('api client follows 401 redirectTo', async () => {
  const f = fakeFetch([{ status: 401, body: { success: false, redirectTo: '/login' } }]);
  let redirected = null;
  const api = core.createApiClient({ fetchImpl: f, onRedirect: u => { redirected = u; } });
  await assert.rejects(() => api.get('/x'));
  assert.strictEqual(redirected, '/login');
});

test('error message comes from body.error', async () => {
  const f = fakeFetch([
    { status: 200, body: { csrfToken: 't1' } },
    { status: 400, body: { success: false, error: 'Identifier is required' } }
  ]);
  const api = core.createApiClient({ fetchImpl: f });
  await assert.rejects(() => api.post('/x', {}), err => {
    assert.strictEqual(err.message, 'Identifier is required');
    assert.strictEqual(err.status, 400);
    assert.strictEqual(err.body.success, false);
    return true;
  });
});

test('formatApiError adds the reason and the ref when present', () => {
  assert.strictEqual(core.formatApiError({ error: 'Failed to archive certificate' }, 500), 'Failed to archive certificate');
  assert.strictEqual(core.formatApiError({ error: 'Failed to archive certificate', ref: '1a2b3c4d' }, 500),
    'Failed to archive certificate · ref 1a2b3c4d');
  assert.strictEqual(core.formatApiError({ error: 'SMTP verification failed', reason: 'ECONNREFUSED', ref: '0badf00d' }, 500),
    'SMTP verification failed (ECONNREFUSED) · ref 0badf00d');
  assert.strictEqual(core.formatApiError({ message: 'Nope' }, 400), 'Nope');
  assert.strictEqual(core.formatApiError({}, 502), 'HTTP 502');
  assert.strictEqual(core.formatApiError(null, 500), 'HTTP 500');
});

test('api client error message carries the reason and ref of a 5xx body', async () => {
  const f = fakeFetch([
    { status: 200, body: { csrfToken: 't1' } },
    { status: 500, body: { success: false, error: 'SMTP verification failed', reason: 'ECONNREFUSED', ref: 'deadbeef' } }
  ]);
  const api = core.createApiClient({ fetchImpl: f });
  await assert.rejects(() => api.post('/email/verify', {}), err => {
    assert.strictEqual(err.message, 'SMTP verification failed (ECONNREFUSED) · ref deadbeef');
    assert.strictEqual(err.ref, 'deadbeef');
    assert.strictEqual(err.reason, 'ECONNREFUSED');
    assert.strictEqual(err.status, 500);
    return true;
  });
});

test('upload sends FormData without Content-Type', async () => {
  const f = fakeFetch([
    { status: 200, body: { csrfToken: 't1' } },
    { status: 200, body: { success: true } }
  ]);
  const api = core.createApiClient({ fetchImpl: f });
  const fd = {};
  await api.upload('/u', fd);
  const up = f.calls[1];
  assert.strictEqual(up.opts.body, fd);
  assert.strictEqual(up.opts.headers['Content-Type'], undefined);
  assert.strictEqual(up.opts.headers['X-CSRF-Token'], 't1');
});

test('resolveInitialTheme', () => {
  assert.strictEqual(core.resolveInitialTheme({ stored: 'light' }), 'light');
  assert.strictEqual(core.resolveInitialTheme({ stored: null, serverDefault: 'light' }), 'light');
  assert.strictEqual(core.resolveInitialTheme({ stored: 'neon', serverDefault: null }), 'dark');
});
