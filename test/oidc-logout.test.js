const { test } = require('node:test');
const assert = require('node:assert');
const { buildEndSessionUrl } = require('../src/utils/oidcLogout');

test('returns null when the provider has no end_session_endpoint', () => {
  assert.strictEqual(buildEndSessionUrl(null, { idToken: 'x', postLogoutRedirectUri: 'https://app/login' }), null);
  assert.strictEqual(buildEndSessionUrl('', {}), null);
});

test('builds end-session URL with id_token_hint and post_logout_redirect_uri', () => {
  const url = new URL(buildEndSessionUrl('https://idp.example/application/o/app/end-session/', {
    idToken: 'ey.abc.def',
    postLogoutRedirectUri: 'https://app.example/login'
  }));
  assert.strictEqual(url.origin + url.pathname, 'https://idp.example/application/o/app/end-session/');
  assert.strictEqual(url.searchParams.get('id_token_hint'), 'ey.abc.def');
  assert.strictEqual(url.searchParams.get('post_logout_redirect_uri'), 'https://app.example/login');
});

test('omits params that are not available', () => {
  const url = new URL(buildEndSessionUrl('https://idp.example/end', {}));
  assert.strictEqual(url.searchParams.has('id_token_hint'), false);
  assert.strictEqual(url.searchParams.has('post_logout_redirect_uri'), false);
});

test('preserves existing query params on the endpoint', () => {
  const url = new URL(buildEndSessionUrl('https://idp.example/end?tenant=a', { idToken: 't' }));
  assert.strictEqual(url.searchParams.get('tenant'), 'a');
  assert.strictEqual(url.searchParams.get('id_token_hint'), 't');
});

test('rejects non-http(s) endpoints (no javascript: redirects)', () => {
  assert.strictEqual(buildEndSessionUrl('javascript:alert(1)', { idToken: 't' }), null);
});
