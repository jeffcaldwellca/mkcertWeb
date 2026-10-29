// Settings page controller (split-pane). Page controllers don't export.
(function () {
  'use strict';

  const core = window.MK.core;
  const model = window.MK.settingsModel;
  const esc = core.escapeHtml;
  const toast = core.toast;

  const TITLES = {
    server: 'server', auth: 'authentication', ratelimit: 'rate limits',
    email: 'email', ntfy: 'ntfy', webhook: 'webhook', monitoring: 'monitoring', theme: 'theme'
  };
  const SECTION_IDS = model.SECTION_GROUPS.flatMap((g) => g.sections);

  const state = {
    api: null,
    section: 'server',
    saved: {},
    filter: ''
  };
  const $ = (id) => document.getElementById(id);
  let form;

  // --------------------------------------------------------- form <-> data

  // Populate form with settings data (dotted names match input names).
  function populateForm(settings) {
    function setValue(path, value) {
      const input = form.querySelector('[name="' + path + '"]');
      if (!input) return;
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else if (input.type === 'number') input.value = Number(value) || '';
      else input.value = value || '';
    }
    function populateObject(obj, prefix) {
      for (const key in obj) {
        const value = obj[key];
        const path = prefix ? prefix + '.' + key : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) populateObject(value, path);
        else setValue(path, value);
      }
    }
    populateObject(settings, '');
  }

  // Extract form data as nested object.
  function getFormData() {
    const formData = new FormData(form);
    const settings = {};

    function ensure(parts) {
      let current = settings;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) current[parts[i]] = {};
        current = current[parts[i]];
      }
      return current;
    }

    for (const [name, value] of formData.entries()) {
      const parts = name.split('.');
      const current = ensure(parts);
      const last = parts[parts.length - 1];
      const input = form.querySelector('[name="' + name + '"]');
      if (input.type === 'checkbox') current[last] = input.checked;
      else if (input.type === 'number') current[last] = input.value ? Number(input.value) : undefined;
      else current[last] = value || undefined;
    }

    // Unchecked checkboxes are absent from FormData; add them as false.
    form.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      if (!formData.has(cb.name)) {
        const parts = cb.name.split('.');
        ensure(parts)[parts[parts.length - 1]] = false;
      }
    });
    return settings;
  }

  function snapshot() { state.saved = getFormData(); updateDirty(); }

  // ------------------------------------------------------------ navigation

  function renderNav() {
    const nav = $('section-nav');
    nav.innerHTML = model.SECTION_GROUPS.map((g) =>
      '<div class="list-group" data-group="' + esc(g.label) + '">' +
        '<h2 class="section-label">' + esc(g.label) + '</h2>' +
        g.sections.map((id) =>
          '<a class="list-item" href="#section=' + esc(id) + '" data-section="' + esc(id) + '">' +
            '<span class="line"><span class="name">' + esc(TITLES[id]) + '</span>' +
            '<span class="pill pill--warn" data-edited hidden>edited</span>' +
            '<span class="dot dot--ok" data-dot aria-hidden="true"></span>' +
            '<span class="sr-only" data-dot-text></span></span></a>').join('') +
      '</div>').join('');
  }

  function groupLabelOf(id) {
    const g = model.SECTION_GROUPS.find((x) => x.sections.includes(id));
    return g ? g.label.toLowerCase() : '';
  }

  function selectSection(id) {
    if (!SECTION_IDS.includes(id)) id = 'server';
    state.section = id;
    document.querySelectorAll('#settings-form .detail-body[data-section]').forEach((el) => {
      el.hidden = el.dataset.section !== id;
    });
    document.querySelectorAll('#section-nav .list-item').forEach((el) => {
      if (el.dataset.section === id) el.setAttribute('aria-current', 'true');
      else el.removeAttribute('aria-current');
    });
    $('section-title').textContent = TITLES[id];
    $('crumb').textContent = 'settings / ' + groupLabelOf(id);
  }

  function routeFromHash() {
    selectSection(model.sectionFromHash(location.hash) || state.section);
  }

  // -------------------------------------------------------------- status

  function sectionOfName(name) {
    const el = form.querySelector('[name="' + name + '"]');
    const host = el && el.closest('.detail-body[data-section]');
    return host ? host.dataset.section : null;
  }

  function updateDots() {
    const data = model.flatten(getFormData());
    document.querySelectorAll('#section-nav .list-item').forEach((item) => {
      const key = model.ENABLE_KEY[item.dataset.section];
      const on = key ? Boolean(data[key]) : true;
      const dot = item.querySelector('[data-dot]');
      const word = key ? (on ? 'enabled' : 'disabled') : '';
      dot.className = 'dot ' + (on ? 'dot--ok' : 'dot--off');
      dot.title = word;
      // Colour alone doesn't carry state; sections without a switch say nothing.
      item.querySelector('[data-dot-text]').textContent = word ? ': ' + word : '';
    });
  }

  function updateDirty() {
    const changed = model.diffSettings(state.saved, getFormData());
    const dirtySections = new Set(changed.map(sectionOfName).filter(Boolean));
    $('dirty-count').textContent = String(changed.length);
    $('dirty-dot').className = 'dot ' + (changed.length ? 'dot--warn' : 'dot--off');
    $('discard-btn').disabled = changed.length === 0;
    document.querySelectorAll('#section-nav .list-item').forEach((item) => {
      item.querySelector('[data-edited]').hidden = !dirtySections.has(item.dataset.section);
    });
    updateDots();
    return changed.length;
  }

  // ---------------------------------------------------------------- filter

  function indexSettings() {
    form.querySelectorAll('.field, .switch-row').forEach((el) => {
      const input = el.querySelector('input, select, textarea');
      if (!input) return;
      const labelEl = el.matches('.switch-row') ? el.querySelector('.grow') : el.querySelector('label');
      el.dataset.label = (labelEl.firstChild ? labelEl.firstChild.textContent : labelEl.textContent).trim();
      el.dataset.key = input.name;
    });
  }

  function applyFilter() {
    const q = state.filter;
    const counts = {};
    form.querySelectorAll('.field, .switch-row').forEach((el) => {
      const ok = model.matchesSetting({ label: el.dataset.label, key: el.dataset.key }, q);
      el.classList.toggle('is-filtered-out', !ok);
      if (ok) {
        const id = el.closest('.detail-body[data-section]').dataset.section;
        counts[id] = (counts[id] || 0) + 1;
      }
    });
    form.querySelectorAll('.fieldset').forEach((fs) => {
      const visible = fs.querySelector('.field:not(.is-filtered-out), .switch-row:not(.is-filtered-out)');
      fs.classList.toggle('is-filtered-out', Boolean(q) && !visible);
    });
    form.querySelectorAll('[data-keep]').forEach((el) => el.classList.toggle('is-filtered-out', Boolean(q)));
    let any = false;
    document.querySelectorAll('#section-nav .list-item').forEach((item) => {
      const show = !q || counts[item.dataset.section] > 0;
      item.classList.toggle('is-filtered-out', !show);
      if (show) any = true;
    });
    document.querySelectorAll('#section-nav .list-group').forEach((g) => {
      g.classList.toggle('is-filtered-out', !g.querySelector('.list-item:not(.is-filtered-out)'));
    });
    $('filter-empty').hidden = any;
    if (q && any && !counts[state.section]) {
      const first = SECTION_IDS.find((id) => counts[id] > 0);
      if (first) {
        history.replaceState(null, '', '#section=' + first);
        selectSection(first);
      }
    }
  }

  // ------------------------------------------------------------------ I/O

  function showLoadError(message) {
    $('load-error').textContent = message;
    $('load-error-wrap').hidden = !message;
  }

  function configOf(result) {
    const { success, message, ...configData } = result;
    return configData;
  }

  async function loadSettings() {
    try {
      const result = await state.api.get('/settings');
      populateForm(configOf(result));
      showLoadError('');
      snapshot();
      return true;
    } catch (err) {
      let msg = 'failed to load settings: ' + err.message;
      if (err.status === 403) msg = err.message || 'Settings API unavailable';
      else if (err.status === 401) msg = 'You need to log in to access settings.';
      showLoadError(msg);
      toast(msg, 'err');
      return false;
    }
  }

  async function saveSettings() {
    const btn = $('save-btn');
    btn.disabled = true;
    try {
      const result = await state.api.post('/settings', getFormData());
      toast(result.message || 'Settings saved successfully!', 'ok');
      // Reload to show sanitized values and re-snapshot.
      await loadSettings();
    } catch (err) {
      toast('Error saving settings: ' + err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  }

  function confirmDialog(message, okLabel) {
    const dlg = $('confirm-dialog');
    $('confirm-message').textContent = message;
    $('confirm-ok').textContent = okLabel;
    dlg.returnValue = '';
    return new Promise((resolve) => {
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'confirm'), { once: true });
      dlg.showModal();
      dlg.querySelector('button[value="cancel"]').focus();
    });
  }

  async function resetSettings() {
    const ok = await confirmDialog(
      'Reset all settings to defaults? This will delete your custom configuration.', 'reset to defaults');
    if (!ok) return;
    try {
      const result = await state.api.del('/settings');
      populateForm(configOf(result));
      snapshot();
      toast('Settings reset to defaults successfully!', 'ok');
    } catch (err) {
      toast('Error resetting settings: ' + err.message, 'err');
    }
  }

  async function showRunningConfig() {
    const dlg = $('config-modal');
    const content = $('config-content');
    content.textContent = 'Loading running configuration...';
    if (!dlg.open) dlg.showModal();
    try {
      const result = await state.api.get('/settings/running');
      content.textContent = JSON.stringify(configOf(result), null, 2);
    } catch (err) {
      content.textContent = 'Error: ' + err.message;
      toast('Failed to load running configuration', 'err');
    }
  }

  async function copyConfig() {
    try {
      await navigator.clipboard.writeText($('config-content').textContent);
      toast('Configuration copied to clipboard', 'ok');
    } catch (err) {
      toast('Failed to copy to clipboard', 'err');
    }
  }

  function downloadConfig() {
    const blob = new Blob([$('config-content').textContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mkcert-running-config-' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Configuration downloaded', 'ok');
  }

  async function runNotificationTest(channel) {
    const btn = $('test-' + channel + '-btn');
    const out = $(channel + '-test-result');
    const idle = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'sending…';
    out.hidden = true;
    let line;
    try {
      const data = await state.api.post('/' + channel + '/test');
      line = 'OK   ' + (data.message || 'Test sent successfully');
    } catch (err) {
      line = 'ERR  ' + ((err.body && (err.body.error || err.body.message)) || err.message || 'Test failed');
    } finally {
      btn.disabled = false;
      btn.textContent = idle;
    }
    out.textContent = line;
    out.hidden = false;
  }

  // ---------------------------------------------------------------- wiring

  function wire() {
    form.addEventListener('input', updateDirty);
    form.addEventListener('change', updateDirty);
    form.addEventListener('submit', (e) => { e.preventDefault(); saveSettings(); });
    // A hidden field (other section, or filtered out) can't show its validation
    // bubble. On the first invalid field of each save attempt, clear the filter,
    // reveal that field's section and focus it. Later invalid events are ignored.
    let invalidHandled = false;
    $('save-btn').addEventListener('click', () => { invalidHandled = false; });
    form.addEventListener('submit', () => { invalidHandled = false; });
    form.addEventListener('invalid', (e) => {
      if (invalidHandled) return;
      invalidHandled = true;
      if (state.filter) {
        $('settings-filter').value = '';
        state.filter = '';
        applyFilter();
      }
      const id = sectionOfName(e.target.name);
      if (id && id !== state.section) {
        history.replaceState(null, '', '#section=' + id);
        selectSection(id);
      }
      e.target.focus();
    }, true);

    $('discard-btn').addEventListener('click', () => { populateForm(state.saved); updateDirty(); });
    $('reset-btn').addEventListener('click', resetSettings);
    $('reload-btn').addEventListener('click', async () => {
      if (await loadSettings()) toast('Settings reloaded from server', 'info');
    });
    $('view-config-btn').addEventListener('click', showRunningConfig);
    $('copy-config-btn').addEventListener('click', copyConfig);
    $('download-config-btn').addEventListener('click', downloadConfig);
    $('test-ntfy-btn').addEventListener('click', () => runNotificationTest('ntfy'));
    $('test-webhook-btn').addEventListener('click', () => runNotificationTest('webhook'));

    // Close the running-config dialog on a backdrop click.
    $('config-modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) e.currentTarget.close();
    });

    $('settings-filter').addEventListener('input', (e) => {
      state.filter = e.target.value;
      applyFilter();
    });
    window.addEventListener('hashchange', routeFromHash);
    window.addEventListener('beforeunload', (e) => {
      if (updateDirty() > 0) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  async function init() {
    form = $('settings-form');
    renderNav();
    indexSettings();
    wire();
    selectSection(model.sectionFromHash(location.hash) || 'server');
    snapshot();
    const shell = await window.MK.shell.mountShell('settings');
    state.api = shell.api;
    await loadSettings();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
