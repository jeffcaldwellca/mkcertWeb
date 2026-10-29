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

  // The toast text for an error body: the server's fixed message, then the
  // sanitised reason and the reference ID (which matches the server log).
  function formatApiError(body, status) {
    const b = body || {};
    let text = b.error || b.message || 'HTTP ' + status;
    if (b.reason) text += ' (' + b.reason + ')';
    if (b.ref) text += ' · ref ' + b.ref;
    return text;
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
        const err = new Error(formatApiError(body, response.status));
        err.status = response.status;
        err.body = body;
        if (body.ref) err.ref = body.ref;
        if (body.reason) err.reason = body.reason;
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

  // Toasts go into live regions that exist before the first toast, so screen
  // readers announce it: a polite region, plus an assertive one for errors.
  // Both sit in one fixed .toast-stack. Created when core.js loads (scripts
  // sit at the end of <body>) or, failing that, on first use.
  let toastRegions = null;

  function ensureToastRegions() {
    if (toastRegions) return false;
    if (typeof document === 'undefined' || !document.body) return false;
    const stack = document.createElement('div');
    stack.className = 'toast-stack';
    const polite = document.createElement('div');
    polite.className = 'toast-region';
    polite.setAttribute('aria-live', 'polite');
    polite.setAttribute('aria-atomic', 'false');
    const assertive = document.createElement('div');
    assertive.className = 'toast-region';
    assertive.setAttribute('aria-live', 'assertive');
    assertive.setAttribute('aria-atomic', 'false');
    stack.append(polite, assertive);
    document.body.appendChild(stack);
    toastRegions = { stack, polite, assertive };
    return true;
  }

  // Keep the stack clear of a sticky footer (settings page) by lifting it.
  function placeToastStack(stack) {
    const footer = document.querySelector('.sticky-footer');
    let lift = 0;
    if (footer) {
      const r = footer.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) lift = window.innerHeight - r.top;
    }
    stack.style.bottom = (16 + Math.min(lift, window.innerHeight / 2)) + 'px';
  }

  // Error toasts stay until dismissed; others go after `timeout` ms.
  function toast(message, type = 'info', { timeout = 5000 } = {}) {
    const kind = ['ok', 'err', 'info'].includes(type) ? type : 'info';
    const fresh = ensureToastRegions();
    if (!toastRegions) return;
    const el = document.createElement('div');
    el.className = 'toast toast--' + kind;
    const text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = message;
    el.appendChild(text);
    if (kind === 'err') {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'toast-dismiss';
      close.setAttribute('aria-label', 'dismiss');
      close.textContent = '×';
      close.addEventListener('click', () => el.remove());
      el.appendChild(close);
    } else if (timeout > 0) {
      setTimeout(() => el.remove(), timeout);
    }
    placeToastStack(toastRegions.stack);
    const region = kind === 'err' ? toastRegions.assertive : toastRegions.polite;
    // A region created this instant may not be tracked yet; give it a beat.
    if (fresh) setTimeout(() => region.appendChild(el), 100);
    else region.appendChild(el);
  }

  ensureToastRegions();

  return { escapeHtml, formatApiError, createApiClient, resolveInitialTheme, initTheme, toggleTheme, toast };
});
