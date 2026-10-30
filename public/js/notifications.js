// Notifications page controller (split-pane). Page controllers don't export.
(function () {
  'use strict';

  const core = window.MK.core;
  const model = window.MK.certModel;
  const esc = core.escapeHtml;
  const toast = core.toast;

  const CHANNELS = ['email', 'ntfy', 'webhook', 'monitoring'];
  const LOG_MAX = 50;

  // Each action: id, label, busy label, endpoint, success text, tone of button.
  const ACTIONS = {
    email: [
      { id: 'verify', label: 'verify smtp', busy: 'verifying…', path: '/email/verify', ok: () => 'SMTP connection verified', needs: 'ready' },
      { id: 'test', label: 'send test', busy: 'sending…', path: '/email/test',
        ok: (r) => 'test email sent' + (r.messageId ? ' (message id ' + r.messageId + ')' : ''), needs: 'ready', primary: true }
    ],
    ntfy: [
      { id: 'test', label: 'send test', busy: 'sending…', path: '/ntfy/test', ok: () => 'test notification sent', needs: 'ready', primary: true }
    ],
    webhook: [
      { id: 'test', label: 'send test', busy: 'sending…', path: '/webhook/test', ok: () => 'test webhook sent', needs: 'ready', primary: true }
    ],
    monitoring: [
      { id: 'check', label: 'check now', busy: 'checking…', path: '/monitoring/check', ok: () => 'certificate expiry check completed', needs: 'enabled' },
      { id: 'start', label: 'start', busy: 'starting…', path: '/monitoring/start', ok: () => 'monitoring started', needs: 'stopped', primary: true },
      { id: 'stop', label: 'stop', busy: 'stopping…', path: '/monitoring/stop', ok: () => 'monitoring stopped', needs: 'running' }
    ]
  };

  const state = {
    api: null,
    selected: 'email',
    // status[channel] = { data } | { error } | undefined while loading
    status: {},
    expiring: null,
    expiringError: null,
    logs: { email: [], ntfy: [], webhook: [], monitoring: [] },
    busy: null
  };
  let listEl, titleEl, configureEl, actionsEl, statusEl, extraEl, logEl;

  // ---------------------------------------------------------------- helpers

  function parseChannel(hash) {
    const m = /(?:^#|&)channel=([a-z]+)/.exec(hash || '');
    return m && CHANNELS.includes(m[1]) ? m[1] : 'email';
  }

  // 'ready' | 'unconfigured' | 'disabled' | 'running' | 'stopped' | 'error' | 'loading'
  function channelState(ch) {
    const s = state.status[ch];
    if (!s) return 'loading';
    if (s.error) return 'error';
    const d = s.data;
    if (!d.enabled) return 'disabled';
    if (ch === 'monitoring') return d.running ? 'running' : 'stopped';
    return d.configured ? 'ready' : 'unconfigured';
  }

  const DOT = { ready: 'dot--ok', running: 'dot--ok', stopped: 'dot--warn', unconfigured: 'dot--err', error: 'dot--err', disabled: 'dot--off', loading: 'dot--off' };
  const LABEL = { ready: 'ready', running: 'running', stopped: 'stopped', unconfigured: 'not configured', error: 'unavailable', disabled: 'disabled', loading: 'loading…' };
  const PILL = { ready: 'ok', running: 'ok', stopped: 'warn', unconfigured: 'err', error: 'err', disabled: 'muted', loading: 'muted' };

  function actionAllowed(action, st) {
    if (action.needs === 'ready') return st === 'ready';
    if (action.needs === 'enabled') return st === 'running' || st === 'stopped';
    return action.needs === st;
  }

  // Monitoring shows start or stop, never both; everything else is always shown.
  function actionVisible(action, st) {
    if (action.id === 'start') return st !== 'running';
    if (action.id === 'stop') return st === 'running';
    return true;
  }

  function stamp() {
    const d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  }

  function addLog(ch, lvl, text) {
    state.logs[ch].unshift({ ts: stamp(), lvl, text });
    if (state.logs[ch].length > LOG_MAX) state.logs[ch].length = LOG_MAX;
  }

  // ---------------------------------------------------------------- render

  function renderList() {
    listEl.innerHTML = CHANNELS.map((ch) => {
      const st = channelState(ch);
      return '<a class="list-item" href="#channel=' + ch + '"' + (ch === state.selected ? ' aria-current="true"' : '') + '>' +
        '<span class="line"><span class="dot ' + DOT[st] + '"></span><span class="name">' + esc(ch) + '</span></span>' +
        '<span class="meta">' + esc(LABEL[st]) + '</span></a>';
    }).join('');
  }

  function kv(rows) {
    return '<dl class="kv">' + rows.map((r) => '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>').join('') + '</dl>';
  }

  function statusRows(ch, d) {
    if (ch === 'email') {
      return [
        ['smtp host', d.smtp && d.smtp.host || 'N/A'],
        ['port', d.smtp ? d.smtp.port + (d.smtp.secure ? ' (SSL)' : ' (TLS)') : 'N/A'],
        ['auth user', d.smtp && d.smtp.user ? 'configured' : 'not set'],
        ['from', d.from || 'N/A'],
        ['recipients', d.to && d.to.length ? d.to.join(', ') : 'not configured']
      ];
    }
    if (ch === 'ntfy') {
      return [['url', d.url || 'N/A'], ['topic', d.topic || 'N/A'], ['priority', d.priority || 'default'], ['auth', d.authMethod || 'none']];
    }
    if (ch === 'webhook') {
      return [['url', d.url || 'N/A'], ['custom headers', d.hasCustomHeaders ? 'yes' : 'no']];
    }
    return [
      ['schedule', d.schedule || 'N/A'],
      ['warning', d.warningDays + ' days'],
      ['critical', d.criticalDays + ' days'],
      ['uploaded certs', d.includeUploaded ? 'monitored' : 'not monitored'],
      ['alert channels', ['email', 'ntfy', 'webhook'].filter((c) => d[c + 'Enabled']).join(', ') || 'none enabled']
    ];
  }

  const HINT = {
    email: { disabled: 'Email notifications are disabled.', unconfigured: 'Missing required SMTP configuration (host, user, password, recipients).' },
    ntfy: { disabled: 'ntfy notifications are disabled.', unconfigured: 'Set the ntfy url and topic.' },
    webhook: { disabled: 'Webhook notifications are disabled.', unconfigured: 'Set the webhook url.' },
    monitoring: { disabled: 'Certificate monitoring is disabled.' }
  };

  function renderStatus() {
    const ch = state.selected;
    const s = state.status[ch];
    const st = channelState(ch);
    if (st === 'loading') { statusEl.innerHTML = '<p class="empty">loading…</p>'; return; }
    if (st === 'error') {
      statusEl.innerHTML = '<div class="banner banner--err">failed to load ' + esc(ch) + ' status: ' + esc(s.error) + '</div>';
      return;
    }
    const hint = HINT[ch][st];
    statusEl.innerHTML =
      '<div class="card">' +
        '<div class="row spread"><h2 class="section-label">status</h2>' +
        '<span class="pill pill--' + PILL[st] + '">' + esc(LABEL[st]) + '</span></div>' +
        (hint ? '<p class="note-text">' + esc(hint) + '</p>' : '') +
        kv(statusRows(ch, s.data)) +
      '</div>';
  }

  // While a request runs, buttons are aria-disabled (not disabled) so the
  // focused one keeps focus; runAction ignores clicks while busy. Focus is put
  // back on the same action after the rebuild, or on the first usable one.
  function renderActions() {
    const ch = state.selected;
    const st = channelState(ch);
    const active = document.activeElement;
    const focused = active && actionsEl.contains(active) ? active.dataset.action : null;
    actionsEl.innerHTML = ACTIONS[ch].filter((a) => actionVisible(a, st))
      .map((a) => {
        const busy = state.busy === ch + ':' + a.id;
        const attr = !actionAllowed(a, st) ? ' disabled' : (state.busy !== null ? ' aria-disabled="true"' : '');
        return '<button type="button" class="btn' + (a.primary ? ' btn--primary' : '') + '" data-action="' + esc(a.id) + '"' +
          attr + '>' + esc(busy ? a.busy : a.label) + '</button>';
      }).join('');
    if (focused) {
      const again = actionsEl.querySelector('[data-action="' + focused + '"]:not([disabled])') ||
        actionsEl.querySelector('button:not([disabled])');
      if (again) again.focus();
    }
  }

  function renderExtra() {
    if (state.selected !== 'monitoring') { extraEl.innerHTML = ''; return; }
    if (state.expiringError) {
      extraEl.innerHTML = '<div class="banner banner--err">failed to load expiring certificates: ' + esc(state.expiringError) + '</div>';
      return;
    }
    const e = state.expiring;
    if (!e) { extraEl.innerHTML = ''; return; }
    const now = new Date();
    const items = (e.certificates || []).map((c) => {
      const tone = c.priority === 'critical' ? 'err' : 'warn';
      return '<li class="list-item">' +
        '<span class="line"><span class="dot dot--' + tone + '"></span><span class="name" title="' + esc(c.path) + '">' + esc(c.path) + '</span>' +
        '<span class="pill pill--' + tone + '">' + esc(c.priority) + '</span></span>' +
        '<span class="meta">' + esc(model.metaLine(c, now)) + '</span>' +
        (c.domains && c.domains.length ? '<span class="meta">' + esc(c.domains.join(', ')) + '</span>' : '') +
        '</li>';
    }).join('');
    extraEl.innerHTML =
      '<div class="card">' +
        '<h2 class="section-label">expiring (' + esc(String(e.total)) + ')</h2>' +
        (items ? '<ul class="list-group">' + items + '</ul>' : '<p class="empty">no certificates are expiring soon</p>') +
      '</div>';
  }

  function renderLog() {
    const entries = state.logs[state.selected];
    if (!entries.length) { logEl.innerHTML = ''; return; }
    logEl.innerHTML =
      '<div class="card"><h2 class="section-label">log</h2><ul class="log">' +
      entries.map((l) => '<li><span class="ts">' + esc(l.ts) + '</span> <span class="lvl-' + esc(l.lvl) + '">' +
        (l.lvl === 'ok' ? 'OK' : 'ERR') + '</span> ' + esc(l.text) + '</li>').join('') +
      '</ul></div>';
  }

  function render() {
    renderList();
    titleEl.textContent = state.selected;
    configureEl.href = '/settings.html#section=' + state.selected;
    renderStatus();
    renderActions();
    renderExtra();
    renderLog();
  }

  // ---------------------------------------------------------------- data

  async function loadStatus(ch) {
    try {
      state.status[ch] = { data: await state.api.get('/' + ch + '/status') };
    } catch (err) {
      state.status[ch] = { error: err.message };
    }
  }

  async function loadExpiring() {
    try {
      state.expiring = await state.api.get('/monitoring/expiring');
      state.expiringError = null;
    } catch (err) {
      state.expiring = null;
      state.expiringError = err.message;
    }
  }

  // ---------------------------------------------------------------- actions

  async function runAction(id) {
    const ch = state.selected;
    const action = ACTIONS[ch].find((a) => a.id === id);
    if (!action || state.busy) return;
    state.busy = ch + ':' + id;
    renderActions();
    try {
      const result = await state.api.post(action.path);
      const text = action.ok(result);
      addLog(ch, 'ok', text);
      toast(text, 'ok');
      if (ch === 'monitoring') {
        await Promise.all([loadStatus('monitoring'), loadExpiring()]);
      }
    } catch (err) {
      addLog(ch, 'err', action.label + ' failed: ' + err.message);
      toast(action.label + ' failed: ' + err.message, 'err');
    } finally {
      state.busy = null;
      render();
    }
  }

  function onHashChange() {
    state.selected = parseChannel(location.hash);
    render();
  }

  // ---------------------------------------------------------------- init

  async function init() {
    listEl = document.getElementById('channel-list');
    titleEl = document.getElementById('channel-title');
    configureEl = document.getElementById('configure-link');
    actionsEl = document.getElementById('channel-actions');
    statusEl = document.getElementById('channel-status');
    extraEl = document.getElementById('channel-extra');
    logEl = document.getElementById('channel-log');

    // Wire handlers and start loading before the shell resolves.
    state.api = core.createApiClient({});
    actionsEl.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-action]');
      if (btn) runAction(btn.dataset.action);
    });
    window.addEventListener('hashchange', onHashChange);

    state.selected = parseChannel(location.hash);
    render();
    await Promise.all([
      window.MK.shell.mountShell('notifications', { api: state.api }),
      Promise.all(CHANNELS.map(loadStatus).concat(loadExpiring())).then(render)
    ]);
  }

  init().catch((err) => {
    toast('failed to start the notifications page: ' + err.message, 'err');
  });
})();
