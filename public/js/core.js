(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.MK = root.MK || {}; root.MK.core = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, c => ESCAPES[c]);
  }

  function createApiClient(options = {}) {
    const fetchImpl = options.fetchImpl || ((...a) => fetch(...a));
    const base = options.base === undefined ? '/api' : options.base;
    const onRedirect = options.onRedirect || (url => { location.href = url; });
    let csrfToken = null;

    async function parse(response) {
      try { return await response.json(); } catch (e) { return {}; }
    }

    async function fetchCsrf() {
      const response = await fetchImpl(base + '/csrf-token', { credentials: 'include' });
      const body = await parse(response);
      if (!response.ok || !body.csrfToken) {
        const err = new Error(body.error || body.message || 'Failed to fetch CSRF token');
        err.status = response.status;
        err.body = body;
        throw err;
      }
      csrfToken = body.csrfToken;
      return csrfToken;
    }

    async function send(method, path, payload, isForm) {
      const mutating = method !== 'GET';
      if (mutating && !csrfToken) await fetchCsrf();

      async function attempt() {
        const headers = {};
        if (payload !== undefined && !isForm) headers['Content-Type'] = 'application/json';
        if (mutating) headers['X-CSRF-Token'] = csrfToken;
        const init = { method, credentials: 'include', headers };
        if (payload !== undefined) init.body = isForm ? payload : JSON.stringify(payload);
        const response = await fetchImpl(base + path, init);
        return { response, body: await parse(response) };
      }

      let { response, body } = await attempt();
      if (mutating && response.status === 403 && body.code === 'CSRF_INVALID') {
        await fetchCsrf();
        ({ response, body } = await attempt());
      }
      if (!response.ok) {
        if (response.status === 401 && body.redirectTo) onRedirect(body.redirectTo);
        const err = new Error(body.error || body.message || 'HTTP ' + response.status);
        err.status = response.status;
        err.body = body;
        throw err;
      }
      return body;
    }

    return {
      get: path => send('GET', path),
      post: (path, body) => send('POST', path, body === undefined ? undefined : body, false),
      put: (path, body) => send('PUT', path, body === undefined ? undefined : body, false),
      del: path => send('DELETE', path),
      upload: (path, formData) => send('POST', path, formData, true)
    };
  }

  function validTheme(t) { return t === 'dark' || t === 'light'; }

  function resolveInitialTheme({ stored, serverDefault } = {}) {
    if (validTheme(stored)) return stored;
    if (validTheme(serverDefault)) return serverDefault;
    return 'dark';
  }

  function readStored() {
    try { return localStorage.getItem('theme'); } catch (e) { return null; }
  }

  async function initTheme(api) {
    const stored = readStored();
    let serverDefault = null;
    if (!validTheme(stored) && api) {
      try {
        const cfg = await api.get('/config/theme');
        serverDefault = cfg.defaultTheme;
      } catch (e) { /* fall back to dark */ }
    }
    document.documentElement.setAttribute('data-theme', resolveInitialTheme({ stored, serverDefault }));
  }

  function toggleTheme() {
    const el = document.documentElement;
    const next = el.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    el.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) { /* storage unavailable */ }
    return next;
  }

  function toast(message, type = 'info', { timeout = 5000 } = {}) {
    let stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      document.body.appendChild(stack);
    }
    const el = document.createElement('div');
    el.className = 'toast toast--' + (['ok', 'err', 'info'].includes(type) ? type : 'info');
    el.setAttribute('role', 'status');
    el.textContent = message;
    stack.appendChild(el);
    if (timeout > 0) setTimeout(() => el.remove(), timeout);
  }

  return { escapeHtml, createApiClient, resolveInitialTheme, initTheme, toggleTheme, toast };
});
