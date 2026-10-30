// SCEP page controller (split-pane). Page controllers don't export.
(function () {
  'use strict';

  const core = window.MK.core;
  const scepModel = window.MK.scepModel;
  const esc = core.escapeHtml;
  const toast = core.toast;

  const TABS = ['challenges', 'issued', 'enroll', 'mdm'];
  const state = {
    api: null,
    tab: 'challenges',
    challenges: [],
    certs: [],
    challengesLoaded: false,
    certsLoaded: false
  };
  let detailEl;

  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- helpers

  function fmtDate(d) {
    const date = new Date(d);
    return isNaN(date) ? 'unknown' : date.toLocaleString();
  }

  // State and expiry text are derived at render time (MK.scepModel).
  const relExpiry = scepModel.relExpiry;
  const challengeState = scepModel.challengeState;
  const STATE_PILL = { used: 'muted', expired: 'err', pending: 'ok' };

  async function copyText(text, sourceEl) {
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      toast('copied to clipboard', 'ok');
    } catch (e) {
      if (sourceEl) {
        const range = document.createRange();
        range.selectNodeContents(sourceEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      toast('press ⌘C / Ctrl+C to copy', 'info');
    }
  }

  // ---------------------------------------------------------------- tabs

  function selectTab(tab, focus) {
    if (!TABS.includes(tab)) return;
    state.tab = tab;
    detailEl.querySelectorAll('[role="tab"]').forEach((el) => {
      const on = el.dataset.tab === tab;
      el.setAttribute('aria-selected', String(on));
      el.tabIndex = on ? 0 : -1;
      if (on && focus) el.focus();
    });
    detailEl.querySelectorAll('[role="tabpanel"]').forEach((el) => {
      el.hidden = el.id !== 'scep-panel-' + tab;
    });
  }

  function onDetailKeydown(e) {
    const tab = e.target.closest && e.target.closest('[role="tab"]');
    if (!tab) return;
    const i = TABS.indexOf(tab.dataset.tab);
    let next = null;
    if (e.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length];
    else if (e.key === 'ArrowLeft') next = TABS[(i - 1 + TABS.length) % TABS.length];
    else if (e.key === 'Home') next = TABS[0];
    else if (e.key === 'End') next = TABS[TABS.length - 1];
    if (next) { e.preventDefault(); selectTab(next, true); }
  }

  // ---------------------------------------------------------------- left pane

  async function loadConfig() {
    const pill = $('service-pill');
    try {
      const cfg = await state.api.get('/scep/config');
      $('scep-service-url').textContent = cfg.scepUrl;
      $('get-ca-cert-url').textContent = cfg.getCACertUrl;
      $('get-ca-caps-url').textContent = cfg.getCACapsUrl;
      $('mdm-scep-url').textContent = cfg.scepUrl;
      pill.className = 'pill pill--ok';
      pill.textContent = '● running';
    } catch (err) {
      pill.className = 'pill pill--err';
      pill.textContent = 'unavailable';
      toast('failed to load SCEP configuration: ' + err.message, 'err');
    }
  }

  async function loadEnterpriseCA() {
    const el = $('enterprise-ca-status');
    try {
      const s = await state.api.get('/scep/enterprise-ca/status');
      const tone = s.status === 'active' ? 'ok' : s.status === 'disabled' ? 'off' : 'err';
      const rows = [
        ['enabled', s.enabled ? 'yes' : 'no'],
        ['fallback', s.fallbackToMkcert ? 'mkcert' : 'none']
      ];
      if (s.configuration) {
        rows.push(['ca cert', s.configuration.caCertPath || 'not configured']);
        if (s.configuration.organization) rows.push(['org', s.configuration.organization]);
        if (s.configuration.country) rows.push(['country', s.configuration.country]);
      }
      if (s.caDetails && !s.caDetails.error) {
        if (s.caDetails.subject) rows.push(['subject', s.caDetails.subject]);
        if (s.caDetails.validTo) rows.push(['valid to', s.caDetails.validTo]);
      } else if (s.caDetails && s.caDetails.error) {
        rows.push(['error', s.caDetails.error]);
      }
      el.innerHTML =
        '<h2 class="section-label">enterprise ca</h2>' +
        '<div class="row"><span class="dot dot--' + tone + '" aria-hidden="true"></span><span>' + esc(s.status) + '</span></div>' +
        '<dl class="kv">' + rows.map((r) => '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>').join('') + '</dl>';
    } catch (err) {
      el.innerHTML = '<h2 class="section-label">enterprise ca</h2>' +
        '<div class="banner banner--err">failed to load status: ' + esc(err.message) + '</div>';
    }
  }

  async function loadTemplates() {
    const el = $('certificate-templates');
    try {
      const data = await state.api.get('/scep/templates');
      const list = data.available || [];
      $('template-count').textContent = String(list.length);
      el.innerHTML = list.length ? list.map((t) =>
        '<div class="list-item">' +
          '<span class="line"><span class="name">' + esc(t.name) + '</span></span>' +
          '<span class="meta">' + esc(t.description) + '</span>' +
          '<span class="meta">key usage: ' + esc((t.keyUsage || []).join(', ')) + '</span>' +
          '<span class="meta">extended: ' + esc((t.extendedKeyUsage || []).join(', ')) + '</span>' +
        '</div>').join('') : '<p class="empty">no templates</p>';
    } catch (err) {
      el.innerHTML = '<div class="banner banner--err">failed to load templates: ' + esc(err.message) + '</div>';
    }
  }

  // ---------------------------------------------------------------- challenges

  function renderStats() {
    const active = scepModel.activeCount(state.challenges, new Date());
    $('stat-challenges').textContent = (state.challengesLoaded ? active : '…') + ' active challenges';
    $('stat-certs').textContent = (state.certsLoaded ? state.certs.length : '…') + ' certificates issued';
    $('challenges-label').textContent = 'active challenges' + (state.challengesLoaded ? ' · ' + active : '');
  }

  function renderChallenges() {
    const el = $('challenges-list');
    renderStats();
    if (!state.challengesLoaded) return;
    if (!state.challenges.length) {
      el.innerHTML = '<p class="empty">no challenge passwords yet</p>';
      return;
    }
    const now = new Date();
    el.innerHTML = '<div class="data-table-wrap"><table class="data-table"><thead><tr>' +
      '<th scope="col">identifier</th><th scope="col">expires</th><th scope="col">state</th></tr></thead><tbody>' +
      state.challenges.map((c) => {
        const st = challengeState(c, now);
        return '<tr><td>' + esc(c.identifier) + '</td>' +
          '<td title="' + esc(fmtDate(c.expiresAt)) + '">' + esc(relExpiry(c.expiresAt, now)) + '</td>' +
          '<td><span class="pill pill--' + STATE_PILL[st] + '">' + st + '</span></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  async function loadChallenges() {
    try {
      const data = await state.api.get('/scep/challenges');
      state.challenges = data.challenges || [];
      state.challengesLoaded = true;
      renderChallenges();
    } catch (err) {
      $('challenges-list').innerHTML = '<div class="banner banner--err">failed to load challenges: ' + esc(err.message) + '</div>';
    }
  }

  async function generateChallenge(ev) {
    ev.preventDefault();
    const idEl = $('challenge-identifier');
    const identifier = idEl.value.trim();
    if (!identifier) { toast('enter an identifier', 'err'); idEl.focus(); return; }
    const btn = $('generate-challenge-btn');
    btn.disabled = true;
    try {
      const c = await state.api.post('/scep/challenge', {
        identifier,
        expiresIn: parseInt($('challenge-expires').value, 10)
      });
      const rel = relExpiry(c.expiresAt, new Date());
      $('challenge-result').innerHTML =
        '<div class="banner banner--ok"><div class="row">' +
          '<span class="text-ok">✓ created</span>' +
          '<span class="text-muted">' + esc(c.identifier) + '</span>' +
          '<code id="challenge-password">' + esc(c.challengePassword) + '</code>' +
          '<button class="btn" type="button" data-copy="challenge-password" aria-label="copy challenge password">copy</button>' +
          '<span class="text-muted">shown once · expires in ' + esc(rel) + '</span>' +
        '</div></div>';
      idEl.value = '';
      toast('challenge password generated', 'ok');
      await loadChallenges();
    } catch (err) {
      toast('failed to generate challenge: ' + err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  }

  // ---------------------------------------------------------------- certificates

  function renderRecent() {
    const el = $('recent-enrollments');
    if (!state.certs.length) { el.innerHTML = ''; return; }
    const recent = state.certs.slice().sort((a, b) => new Date(b.created) - new Date(a.created)).slice(0, 5);
    el.innerHTML = '<h2 class="section-label">recent enrollments</h2><ul class="log">' +
      recent.map((c) => '<li><span class="ts">' + esc(fmtDate(c.created)) + '</span> <span class="lvl-ok">OK</span> ' +
        esc(c.commonName) + '</li>').join('') + '</ul>';
  }

  function renderCerts() {
    const el = $('scep-certificates');
    renderStats();
    renderRecent();
    if (!state.certsLoaded) return;
    if (!state.certs.length) {
      el.innerHTML = '<p class="empty">no SCEP certificates found</p>';
      return;
    }
    el.innerHTML = '<div class="data-table-wrap"><table class="data-table"><thead><tr>' +
      '<th scope="col">common name</th><th scope="col">created</th><th scope="col">modified</th><th scope="col">path</th></tr></thead><tbody>' +
      state.certs.map((c) =>
        '<tr><td>' + esc(c.commonName) + '</td><td>' + esc(fmtDate(c.created)) + '</td><td>' + esc(fmtDate(c.modified)) +
        '</td><td class="path">' + esc(c.path) + '</td></tr>').join('') + '</tbody></table></div>';
  }

  async function loadCerts() {
    try {
      const data = await state.api.get('/scep/certificates');
      state.certs = data.certificates || [];
      state.certsLoaded = true;
      renderCerts();
    } catch (err) {
      $('scep-certificates').innerHTML = '<div class="banner banner--err">failed to load SCEP certificates: ' + esc(err.message) + '</div>';
    }
  }

  // ---------------------------------------------------------------- manual enroll

  function onTemplateChange() {
    const isM365 = $('cert-template').value === 'M365User';
    $('cert-upn-group').hidden = !isM365;
    $('cert-upn').required = isM365;
    if (!isM365) {
      $('cert-upn').value = '';
      $('cert-upn-validation').textContent = '';
    }
  }

  function showUpn(cls, text) {
    const el = $('cert-upn-validation');
    el.className = cls;
    el.textContent = text;
  }

  async function validateUpn() {
    const upn = $('cert-upn').value.trim();
    if (!upn) { showUpn('', ''); return; }
    try {
      const r = await state.api.post('/scep/validate-upn', { upn });
      if (r.valid) showUpn('text-ok', 'OK valid UPN format');
      else showUpn('text-err', 'ERR invalid UPN format');
    } catch (err) {
      showUpn('text-warn', 'could not validate UPN');
    }
  }

  async function generateCert(ev) {
    ev.preventDefault();
    const commonName = $('cert-common-name').value.trim();
    const template = $('cert-template').value;
    const upn = $('cert-upn').value.trim();
    const challengePassword = $('cert-challenge').value;
    const sanText = $('cert-san').value;

    if (!commonName) { toast('enter a common name (domain)', 'err'); $('cert-common-name').focus(); return; }
    if (template === 'M365User' && !upn) { toast('UPN is required for M365 User certificates', 'err'); $('cert-upn').focus(); return; }

    const payload = { commonName, template };
    if (challengePassword) payload.challengePassword = challengePassword;
    if (upn) payload.upn = upn;
    const sans = sanText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (sans.length) payload.subjectAltNames = sans;

    const btn = $('generate-scep-cert-btn');
    btn.disabled = true;
    btn.textContent = 'generating…';
    const resultEl = $('cert-result');
    try {
      const d = await state.api.post('/scep/certificate', payload);
      const rows = [['common name', d.commonName], ['template', d.template]];
      if (d.upn) rows.push(['upn', d.upn]);
      rows.push(['method', d.method], ['enterprise mode', d.enterpriseMode ? 'yes' : 'no'], ['message', d.message]);
      resultEl.innerHTML = '<div class="banner banner--ok"><div class="text-ok">✓ certificate generated</div>' +
        '<dl class="kv">' + rows.map((r) => '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>').join('') + '</dl></div>';
      toast('certificate generated', 'ok');
      ['cert-common-name', 'cert-challenge', 'cert-upn', 'cert-san'].forEach((id) => { $(id).value = ''; });
      showUpn('', '');
      await loadCerts();
    } catch (err) {
      resultEl.innerHTML = '<div class="banner banner--err">failed to generate certificate: ' + esc(err.message) + '</div>';
      toast('failed to generate certificate: ' + err.message, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = 'generate scep certificate';
    }
  }

  // ---------------------------------------------------------------- init

  function onClick(e) {
    const tab = e.target.closest('[role="tab"]');
    if (tab) { selectTab(tab.dataset.tab, false); return; }
    const link = e.target.closest('[data-tab-link]');
    if (link) { selectTab(link.dataset.tabLink, true); return; }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const src = $(copy.dataset.copy);
      if (src) copyText(src.textContent, src);
    }
  }

  async function init() {
    detailEl = document.querySelector('.pane-detail');

    // Wire handlers and start loading before the shell resolves.
    state.api = core.createApiClient({});
    document.addEventListener('click', onClick);
    detailEl.addEventListener('keydown', onDetailKeydown);
    $('challenge-form').addEventListener('submit', generateChallenge);
    $('enroll-form').addEventListener('submit', generateCert);
    $('cert-template').addEventListener('change', onTemplateChange);
    $('cert-upn').addEventListener('blur', validateUpn);
    $('refresh-btn').addEventListener('click', () => {
      loadConfig(); loadEnterpriseCA(); loadTemplates(); loadChallenges(); loadCerts();
    });
    setInterval(renderChallenges, 30000);

    await Promise.all([
      window.MK.shell.mountShell('scep', { api: state.api }),
      loadConfig(), loadEnterpriseCA(), loadTemplates(), loadChallenges(), loadCerts()
    ]);
  }

  init().catch((err) => {
    toast('failed to start the SCEP page: ' + err.message, 'err');
  });
})();
