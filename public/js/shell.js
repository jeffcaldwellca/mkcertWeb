(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.MK = root.MK || {}; root.MK.shell = api; }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const core = (typeof module === 'object' && module.exports)
    ? require('./core.js')
    : root.MK.core;

  const NAV = [
    { id: 'certificates', href: '/' },
    { id: 'root-ca', href: '/root-ca.html' },
    { id: 'scep', href: '/scep.html' },
    { id: 'notifications', href: '/notifications.html' },
    { id: 'settings', href: '/settings.html' }
  ];

  function dot(value) {
    if (value === true) return 'dot--ok';
    if (value === false) return 'dot--err';
    return 'dot--off';
  }

  // Returns the INNER markup of the header; the mount element carries class="topbar".
  function renderShell({ active, status, auth } = {}) {
    const s = status || {};
    const tabs = NAV.map(n =>
      '<a class="nav-tab" href="' + n.href + '"' + (n.id === active ? ' aria-current="page"' : '') + '>' + n.id + '</a>'
    ).join('');
    const dots = [['mkcert', s.mkcertInstalled], ['CA', s.caExists], ['openssl', s.opensslAvailable]]
      .map(([label, v]) => '<span><span class="dot ' + dot(status ? v : null) + '"></span>' + label + '</span>')
      .join('');
    const user = auth && auth.authEnabled
      ? '<span>' + core.escapeHtml(auth.username || '') + '</span>' +
        '<button class="btn" type="button" data-shell="logout">logout</button>'
      : '';
    return '<a class="brand" href="/"><span class="prompt">&gt;</span> mkcert<span class="sub">_web</span></a>' +
      '<nav class="nav-tabs" aria-label="Primary">' + tabs + '</nav>' +
      '<div class="status-dots">' + dots + user +
      '<button class="btn btn--ghost" type="button" data-shell="theme" aria-label="Toggle theme">' + nextThemeLabel() + '</button>' +
      '</div>';
  }

  function nextThemeLabel() {
    if (typeof document === 'undefined') return 'light';
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  }

  async function mountShell(active) {
    const el = document.getElementById('shell');
    const api = core.createApiClient({});
    const state = { api, auth: null, status: null };
    const draw = () => { el.innerHTML = renderShell({ active, status: state.status, auth: state.auth }); };
    el.classList.add('topbar');
    draw();

    el.addEventListener('click', async (e) => {
      const btn = e.target.closest && e.target.closest('[data-shell]');
      if (!btn) return;
      if (btn.dataset.shell === 'theme') {
        core.toggleTheme();
        draw();
      } else if (btn.dataset.shell === 'logout') {
        try {
          const body = await api.post('/auth/logout');
          location.href = (body && body.redirectTo) || '/login';
        } catch (err) {
          location.href = '/login';
        }
      }
    });

    await core.initTheme(api).catch(() => {});
    draw();

    const [st, au] = await Promise.all([
      api.get('/status').catch(() => null),
      api.get('/auth/status').catch(() => null)
    ]);
    if (st && st.success !== false) state.status = st;
    if (au && au.success !== false) state.auth = au;
    draw();
    return state;
  }

  return { NAV, renderShell, mountShell };
});
