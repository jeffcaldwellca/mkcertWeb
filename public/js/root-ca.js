// Root CA page controller (split-pane). Page controllers don't export.
(function () {
  'use strict';

  const core = window.MK.core;
  const model = window.MK.certModel;
  const esc = core.escapeHtml;
  const toast = core.toast;

  const DAY_MS = 86400000;
  const TONE = { valid: 'ok', attention: 'warn', expired: 'err', unknown: 'muted' };
  const DOT = { valid: 'dot--ok', attention: 'dot--warn', expired: 'dot--err', unknown: 'dot--off' };

  const state = { api: null, status: null, info: null, infoError: null, loadError: null, result: null };
  let summaryEl, detailEl, resultEl, downloadBtn, installBtn, installHint, generateBtn;

  // ---------------------------------------------------------------- helpers

  // Expiry is derived from daysUntilExpiry (server-timezone independent); the
  // formatted `expiry` string is only a fallback.
  function expiryState(info) {
    const now = new Date();
    const expiry = typeof info.daysUntilExpiry === 'number'
      ? new Date(now.getTime() + info.daysUntilExpiry * DAY_MS)
      : info.expiry;
    return model.classify({ expiry }, now);
  }

  function expiryText(c) {
    if (c.state === 'unknown') return 'expiry unknown';
    if (c.state === 'expired') return 'expired ' + Math.abs(c.daysLeft) + ' days ago';
    return 'expires in ' + c.daysLeft + ' days';
  }

  // ---------------------------------------------------------------- render

  function renderSummary() {
    if (state.loadError) {
      summaryEl.innerHTML = '<p class="empty">' + esc(state.loadError) + '</p>';
      return;
    }
    if (!state.status) { summaryEl.innerHTML = '<p class="empty">loading…</p>'; return; }
    if (!state.status.caExists) {
      summaryEl.innerHTML =
        '<div class="list-item"><span class="line"><span class="dot dot--err"></span><span class="name">no root CA</span></span>' +
        '<span class="meta">generate one to issue trusted certificates</span></div>';
      return;
    }
    const info = state.info;
    if (!info) {
      summaryEl.innerHTML =
        '<div class="list-item"><span class="line"><span class="dot dot--ok"></span><span class="name">root CA present</span></span>' +
        '<span class="meta">' + esc(state.infoError || 'loading details…') + '</span></div>';
      return;
    }
    const c = expiryState(info);
    summaryEl.innerHTML =
      '<div class="list-item is-selected">' +
        '<span class="line"><span class="dot ' + DOT[c.state] + '"></span>' +
        '<span class="name" title="' + esc(info.subject) + '">' + esc(info.subject || 'N/A') + '</span></span>' +
        '<span class="meta"><span class="pill pill--' + TONE[c.state] + '">' + esc(expiryText(c)) + '</span></span>' +
        '<span class="meta">CA present in CAROOT</span>' +
      '</div>';
  }

  function renderDetail() {
    if (state.loadError || !state.status) { detailEl.innerHTML = ''; return; }
    if (!state.status.caExists) {
      detailEl.innerHTML =
        '<div class="card">' +
          '<h2 class="section-label">root ca not found</h2>' +
          '<p class="note-text">A Root Certificate Authority is required to generate SSL certificates. Generating one:</p>' +
          '<ul class="log">' +
            '<li>creates a new Root Certificate Authority</li>' +
            '<li>installs it in your system trust store</li>' +
            '<li>enables certificate generation for local development</li>' +
          '</ul>' +
        '</div>';
      return;
    }
    const info = state.info;
    if (!info) {
      detailEl.innerHTML = '<p class="empty">' + esc(state.infoError || 'loading…') + '</p>';
      return;
    }
    const c = expiryState(info);
    const expiry = expiryText(c) + (info.expiry ? ' (' + info.expiry + ')' : '');
    detailEl.innerHTML =
      '<div class="card">' +
        '<h2 class="section-label">details</h2>' +
        '<dl class="kv">' +
          '<dt>subject</dt><dd>' + esc(info.subject || 'N/A') + '</dd>' +
          '<dt>issuer</dt><dd>' + esc(info.issuer || 'N/A') + '</dd>' +
          '<dt>expiry</dt><dd class="text-' + TONE[c.state] + '">' + esc(expiry) + '</dd>' +
          '<dt>fingerprint</dt><dd>' + esc(info.fingerprint || info.serial || 'N/A') + '</dd>' +
          '<dt>location</dt><dd>' + esc(info.path || info.caRoot || 'N/A') + '</dd>' +
        '</dl>' +
      '</div>';
  }

  function renderResult() {
    const r = state.result;
    if (!r) { resultEl.innerHTML = ''; return; }
    const lines = [r.title ? '<strong>' + esc(r.title) + '</strong>' : ''].concat((r.lines || []).map(esc));
    resultEl.innerHTML = '<div class="banner banner--' + esc(r.tone) + '" tabindex="-1">' +
      lines.filter(Boolean).join('<br>') + '</div>';
  }

  function renderActions() {
    const known = !!state.status;
    const exists = known && state.status.caExists;
    downloadBtn.hidden = !exists;
    installBtn.hidden = !exists;
    installHint.hidden = !exists;
    generateBtn.hidden = !known || exists;
  }

  function render() {
    renderSummary();
    renderDetail();
    renderResult();
    renderActions();
  }

  // ---------------------------------------------------------------- data

  async function loadRootCAInfo() {
    try {
      state.info = await state.api.get('/rootca/info');
      state.infoError = null;
    } catch (err) {
      state.info = null;
      state.infoError = 'failed to load root CA information: ' + err.message;
    }
  }

  // `known` is a status already fetched (the shell's), to avoid a refetch.
  async function loadSystemStatus(known) {
    if (known) {
      state.status = known;
      state.loadError = null;
    } else {
      try {
        state.status = await state.api.get('/status');
        state.loadError = null;
      } catch (err) {
        state.status = null;
        state.loadError = 'failed to load system status: ' + err.message;
        render();
        return;
      }
    }
    if (state.status.caExists) await loadRootCAInfo();
    else { state.info = null; state.infoError = null; }
    render();
  }

  // ---------------------------------------------------------------- actions

  function setBusy(btn, busy, busyText, idleText) {
    btn.disabled = busy;
    btn.textContent = busy ? busyText : idleText;
  }

  // Disabling (or hiding) the clicked button drops focus. Put it back on the
  // button, or on the result banner when the button is gone.
  function restoreFocus(btn) {
    const banner = resultEl.querySelector('.banner');
    if (!btn.hidden) btn.focus();
    else if (banner) banner.focus();
  }

  async function handleGenerateCA() {
    const hadFocus = document.activeElement === generateBtn;
    setBusy(generateBtn, true, 'generating…', 'generate');
    state.result = { tone: 'warn', title: 'generating root CA…', lines: ['This may take a few moments.'] };
    renderResult();
    try {
      const result = await state.api.post('/generate-ca');
      const lines = [];
      if (result.caRoot) lines.push('CA root: ' + result.caRoot);
      if (result.caCopiedToPublic) lines.push('CA certificate copied to the download area');
      const untrusted = result.trustStoreInstalled === false;
      state.result = {
        tone: untrusted ? 'warn' : 'ok',
        title: result.message || 'root CA generated',
        lines
      };
      toast(result.message || 'root CA generated', untrusted ? 'info' : 'ok');
      await loadSystemStatus();
    } catch (err) {
      state.result = { tone: 'err', title: 'root CA generation failed', lines: [err.message] };
      renderResult();
      toast('failed to generate CA: ' + err.message, 'err');
    } finally {
      setBusy(generateBtn, false, '', 'generate');
      if (hadFocus) restoreFocus(generateBtn);
    }
  }

  async function handleInstallCA() {
    const hadFocus = document.activeElement === installBtn;
    setBusy(installBtn, true, 'installing…', 'install');
    try {
      const result = await state.api.post('/install-ca');
      state.result = {
        tone: 'ok',
        title: result.message || 'root CA installed successfully',
        lines: ['installed into the trust store of the machine running this server']
      };
      renderResult();
      toast('root CA installed successfully', 'ok');
      await waitForCAInstallation();
    } catch (err) {
      state.result = { tone: 'err', title: 'install failed', lines: [err.message] };
      renderResult();
      toast('failed to install CA: ' + err.message, 'err');
    } finally {
      setBusy(installBtn, false, '', 'install');
      if (hadFocus) restoreFocus(installBtn);
    }
  }

  // Wait for the CA to show up in /status, then refresh the page state.
  async function waitForCAInstallation(maxRetries = 5, delay = 500) {
    for (let i = 0; i < maxRetries; i++) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const status = await state.api.get('/status');
        if (status.caExists) { await loadSystemStatus(); return; }
      } catch (err) { /* retry */ }
      delay *= 1.5;
    }
    await loadSystemStatus();
  }

  async function fetchBlob(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) {
      let body = {};
      try { body = await res.json(); } catch (_) { /* not JSON */ }
      if (res.status === 401 && body.redirectTo) location.href = body.redirectTo;
      throw new Error(body.error || ('HTTP ' + res.status + (res.statusText ? ' ' + res.statusText : '')));
    }
    return res.blob();
  }

  async function downloadRootCA() {
    try {
      const href = URL.createObjectURL(await fetchBlob('/api/download/rootca'));
      const a = document.createElement('a');
      a.href = href;
      a.download = 'mkcert-rootCA.pem';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (err) {
      toast('download failed: ' + err.message, 'err');
    }
  }

  // ---------------------------------------------------------------- init

  async function init() {
    summaryEl = document.getElementById('ca-summary');
    detailEl = document.getElementById('ca-detail');
    resultEl = document.getElementById('ca-result');
    downloadBtn = document.getElementById('download-btn');
    installBtn = document.getElementById('install-btn');
    installHint = document.getElementById('install-hint');
    generateBtn = document.getElementById('generate-btn');

    state.api = core.createApiClient({});
    downloadBtn.addEventListener('click', downloadRootCA);
    installBtn.addEventListener('click', handleInstallCA);
    generateBtn.addEventListener('click', handleGenerateCA);

    // The shell already fetches /status; reuse it (null if that failed).
    const shell = await window.MK.shell.mountShell('root-ca', { api: state.api });
    await loadSystemStatus(shell.status);
  }

  init().catch((err) => {
    toast('failed to start the root CA page: ' + err.message, 'err');
  });
})();
