// Certificates page controller (split-pane). Page controllers don't export.
(function () {
  'use strict';

  const core = window.MK.core;
  const model = window.MK.certModel;
  const esc = core.escapeHtml;
  const toast = core.toast;

  const TABS = ['overview', 'files', 'notes'];
  const DOT = { valid: 'dot--ok', attention: 'dot--warn', expired: 'dot--err', unknown: 'dot--off', archived: 'dot--off' };
  const TONE = { valid: 'ok', attention: 'warn', expired: 'err', unknown: 'muted' };
  const FORMAT_LABEL = { pem: 'PEM', crt: 'CRT/KEY', p12: 'P12' };

  const state = {
    api: null,
    certs: [],
    loaded: false,
    loadError: null,
    query: '',
    tab: 'overview',
    selected: null,
    csrf: null,
    pfxTarget: null
  };

  // Current note per certificate, keyed by certKey (see MK.certModel.certKey).
  // Read back when opening the editor so note text is never parsed out of the DOM.
  const certNotes = new Map();

  let groupsEl, detailEl, emptyEl, filterEl, filterStatusEl, domainsInput, formatSelect, quickGenForm;
  let uploadDialog, uploadDropzone, fileInput, uploadProgress, uploadResults, fileList;
  let pfxDialog, pfxForm, pfxPassword, pfxConfirm, pfxError, pfxGenerateBtn;

  // ---------------------------------------------------------------- helpers

  function enc(s) { return encodeURIComponent(s); }

  function fmtDate(d) {
    if (!d || isNaN(d.getTime())) return '—';
    return d.toISOString().slice(0, 10);
  }

  function formatLabel(cert) {
    const f = String(cert.format || '').toLowerCase();
    return FORMAT_LABEL[f] || f.toUpperCase() || '—';
  }

  function mtime(cert) {
    const t = cert.cert && cert.cert.modified ? new Date(cert.cert.modified).getTime() : 0;
    return isNaN(t) ? 0 : t;
  }

  function formatFileSize(bytes) {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function isTyping(el) {
    return !!(el && (el.isContentEditable || (el.closest && el.closest('input, textarea, select'))));
  }

  // <dialog>-based replacement for window.confirm. Resolves true on confirm.
  function confirmDialog(message, okLabel, danger) {
    const dlg = document.getElementById('confirm-dialog');
    const ok = document.getElementById('confirm-ok');
    document.getElementById('confirm-message').textContent = message;
    ok.textContent = okLabel;
    ok.className = 'btn ' + (danger ? 'btn--danger' : 'btn--primary');
    dlg.returnValue = '';
    return new Promise((resolve) => {
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'confirm'), { once: true });
      dlg.showModal();
      if (danger) dlg.querySelector('button[value="cancel"]').focus();
    });
  }

  // ------------------------------------------------------------ data + render

  async function load() {
    try {
      const body = await state.api.get('/certificates');
      state.certs = Array.isArray(body.certificates) ? body.certificates : [];
      state.loadError = null;
      certNotes.clear();
      state.certs.forEach((c) => certNotes.set(model.certKey(c), c.note || ''));
    } catch (err) {
      state.loadError = err.message;
      toast('failed to load certificates: ' + err.message, 'err');
    }
    state.loaded = true;
    render(true);
  }

  function render(force) {
    const now = new Date();

    if (state.loadError && state.certs.length === 0) {
      groupsEl.innerHTML = '<p class="empty text-err">failed to load certificates: ' + esc(state.loadError) + '</p>';
      emptyEl.hidden = true;
      detailEl.hidden = false;
      detailEl.innerHTML = '<div class="detail-head"><h1 class="page-title" tabindex="-1"><span class="prompt">$</span> certificates</h1></div>' +
        '<div class="detail-body"><p class="text-err">failed to load certificates: ' + esc(state.loadError) + '</p></div>';
      state.selected = null;
      return;
    }

    const none = state.certs.length === 0;
    emptyEl.hidden = !none;
    detailEl.hidden = none;
    if (none) {
      groupsEl.innerHTML = '';
      detailEl.innerHTML = '';
      state.selected = null;
      return;
    }

    const visible = state.certs.filter((c) => model.matchesQuery(c, state.query));
    const groups = model.groupCertificates(visible, now);
    const selectedKey = model.resolveSelection(groups, model.parseHash(location.hash));
    const cert = selectedKey ? visible.find((c) => model.certKey(c) === selectedKey) || null : null;

    renderList(groups, selectedKey, now);
    // Keep the detail DOM (and any open note editor) while only the filter changes.
    if (force || cert !== state.selected) renderDetail(cert, now);
  }

  function itemHtml(cert, selectedKey, now) {
    const key = model.certKey(cert);
    const st = cert.isArchived ? 'archived' : model.classify(cert, now).state;
    return '<a class="list-item" href="' + esc(model.formatHash(key)) + '"' +
      (key === selectedKey ? ' aria-current="true"' : '') + '>' +
      '<span class="line"><span class="dot ' + DOT[st] + '" aria-hidden="true"></span>' +
      '<span class="name">' + esc(cert.name) + '</span>' +
      '<span class="fmt">' + esc(String(cert.format || '').toUpperCase()) + '</span></span>' +
      '<span class="meta">' + esc(model.metaLine(cert, now)) + '</span></a>';
  }

  function renderList(groups, selectedKey, now) {
    const active = document.activeElement;
    const focusedHref = active && groupsEl.contains(active) ? active.getAttribute('href') : null;

    if (groups.length === 0) {
      groupsEl.innerHTML = '<p class="empty">no certificates match “' + esc(state.query.trim()) + '”</p>';
      return;
    }
    groupsEl.innerHTML = groups.map((g) =>
      '<div class="list-group" role="group" aria-label="' + esc(g.label) + '">' +
      '<div class="section-label" aria-hidden="true"><span>' + esc(g.label) + '</span><span>' + g.items.length + '</span></div>' +
      g.items.map((c) => itemHtml(c, selectedKey, now)).join('') +
      '</div>'
    ).join('');

    if (focusedHref) {
      const again = Array.from(groupsEl.querySelectorAll('a.list-item'))
        .find((a) => a.getAttribute('href') === focusedHref);
      if (again) again.focus();
    }
  }

  function statusPill(st, daysLeft) {
    if (st === 'expired') {
      const n = Math.abs(daysLeft);
      return '<span class="pill pill--err">expired ' + n + (n === 1 ? ' day' : ' days') + ' ago</span>';
    }
    if (st === 'attention') return '<span class="pill pill--warn">expires in ' + daysLeft + (daysLeft === 1 ? ' day' : ' days') + '</span>';
    if (st === 'valid') return '<span class="pill pill--ok">valid · ' + daysLeft + ' days left</span>';
    return '<span class="pill pill--muted">expiry unknown</span>';
  }

  function actionBtn(action, label, extra, attrs) {
    return '<button class="btn' + (extra ? ' ' + extra : '') + '" type="button" data-action="' + action + '"' +
      (attrs || '') + '>' + label + '</button>';
  }

  function renderDetail(cert, now) {
    state.selected = cert;
    if (!cert) {
      detailEl.innerHTML = '<div class="detail-head"><h1 class="page-title" tabindex="-1"><span class="prompt">$</span> certificates</h1></div>' +
        '<div class="detail-body"><p class="empty">no certificate matches the filter</p></div>';
      return;
    }
    const loc = model.locationOf(cert);
    const c = model.classify(cert, now);

    // Only offer what the server can do. Every per-cert route rejects
    // view-only folders (uploaded, scep, …); downloads and pfx never look
    // inside archive/.
    const viewOnly = loc.viewOnly;
    const archivedTwin = model.archivedTwinOf(cert, state.certs);
    const actions = [];
    const notes = [];
    if (!viewOnly && !cert.isArchived) actions.push(actionBtn('bundle', '↓ bundle'));
    if (cert.key && !loc.readOnly && !cert.isArchived) actions.push(actionBtn('pfx', 'pfx'));
    if (!loc.readOnly && !cert.isArchived) {
      // The server refuses to archive over an archived copy of the same name.
      actions.push(actionBtn('archive', 'archive', '',
        archivedTwin ? ' disabled aria-describedby="cert-archive-note"' : ''));
      if (archivedTwin) {
        notes.push('<p class="text-muted note-text" id="cert-archive-note">an archived "' +
          esc(cert.name) + '" already exists here — delete it or restore it (swap) first</p>');
      }
    }
    if (cert.isArchived && !viewOnly) {
      actions.push(actionBtn('restore', 'restore'));
      actions.push(actionBtn('delete', 'delete', 'btn--danger'));
    }
    if (viewOnly) notes.push('<p class="text-muted note-text">certificates in ' + esc(loc.label) + ' are view-only here</p>');

    const created = cert.cert && cert.cert.modified ? new Date(cert.cert.modified) : null;
    const meta = [statusPill(c.state, c.daysLeft)];
    if (cert.isArchived) meta.push('<span class="pill pill--muted">archived</span>');
    if (loc.readOnly) meta.push('<span class="pill pill--muted">read-only</span>');
    meta.push('<span>' + esc(formatLabel(cert)) + '</span>');
    meta.push('<span>' + esc(loc.label) + '</span>');
    meta.push('<span>created ' + esc(fmtDate(created)) + '</span>');

    const tabs = TABS.map((t) =>
      '<button class="subtab" type="button" role="tab" id="cert-tab-' + t + '" data-tab="' + t + '"' +
      ' aria-controls="cert-panel-' + t + '" aria-selected="' + (t === state.tab) + '"' +
      ' tabindex="' + (t === state.tab ? '0' : '-1') + '">' + t + '</button>'
    ).join('');

    const panels = {
      overview: overviewHtml(cert, loc, c, created, now),
      files: filesHtml(cert, !viewOnly && !cert.isArchived),
      notes: notesHtml(cert, loc, viewOnly)
    };

    detailEl.innerHTML =
      '<div class="detail-head">' +
        '<div class="row">' +
          '<h1 class="page-title" tabindex="-1"><span class="prompt">$</span> ' + esc(cert.name) + '</h1>' +
          actions.join('') +
        '</div>' +
        '<div class="meta-row">' + meta.join('') + '</div>' +
        notes.join('') +
        '<div class="subtabs" role="tablist" aria-label="Certificate sections">' + tabs + '</div>' +
      '</div>' +
      TABS.map((t) =>
        '<div class="detail-body" role="tabpanel" id="cert-panel-' + t + '" aria-labelledby="cert-tab-' + t + '"' +
        ' tabindex="0"' + (t === state.tab ? '' : ' hidden') + '>' + panels[t] + '</div>'
      ).join('');

    // Width via CSSOM rather than an inline style attribute.
    const bar = detailEl.querySelector('.meter[data-pct] > span');
    if (bar) bar.style.width = bar.parentElement.dataset.pct + '%';
  }

  function overviewHtml(cert, loc, c, created, now) {
    const expiry = cert.expiry ? new Date(cert.expiry) : null;
    let validity;
    if (c.state === 'unknown') {
      validity = '<p class="text-muted">The expiry date is not available for this file' +
        (String(cert.format).toLowerCase() === 'p12' ? ' (PKCS#12 bundles are not inspected)' : '') + '.</p>';
    } else {
      const tone = TONE[c.state];
      const n = Math.abs(c.daysLeft);
      const label = c.state === 'expired'
        ? (n === 1 ? 'day since expiry' : 'days since expiry')
        : (n === 1 ? 'day remaining' : 'days remaining');
      let pct = 0;
      if (created && expiry && expiry > created) {
        pct = Math.max(0, Math.min(100, (expiry - now) / (expiry - created) * 100));
      }
      validity =
        '<div class="row"><span class="big-num text-' + tone + '">' + n + '</span><span class="text-muted">' + label + '</span></div>' +
        '<div class="meter' + (tone === 'ok' ? '' : ' meter--' + tone) + '" data-pct="' + pct.toFixed(1) + '"' +
        ' role="img" aria-label="' + Math.round(pct) + '% of validity remaining"><span></span></div>' +
        '<div class="meta-row spread"><span>created ' + esc(fmtDate(created)) + '</span><span>expires ' + esc(fmtDate(expiry)) + '</span></div>';
    }

    const domains = Array.isArray(cert.domains) ? cert.domains : [];
    const size = cert.cert ? cert.cert.size : 0;
    const sans =
      '<div class="section-label">subject alt names · ' + domains.length + '</div>' +
      (domains.length
        ? '<div class="row">' + domains.map((d) => '<span class="chip">' + esc(d) + '</span>').join('') + '</div>'
        : '<p class="text-muted">none listed</p>') +
      '<dl class="kv">' +
        '<dt>format</dt><dd>' + esc(formatLabel(cert)) + '</dd>' +
        '<dt>location</dt><dd>' + esc(loc.label) + '</dd>' +
        '<dt>file size</dt><dd>' + esc(formatFileSize(size)) + '</dd>' +
        '<dt>sha-256</dt><dd>' + esc(cert.fingerprint || '—') + '</dd>' +
      '</dl>';

    const rootNote = loc.isRootCA
      ? '<div class="banner">This is your mkcert root certificate authority. Install it in a trust store to trust every certificate mkcert issues on this system.</div>'
      : '';

    return rootNote +
      '<div class="card-grid">' +
        '<div class="card"><div class="section-label">validity</div>' + validity + '</div>' +
        '<div class="card">' + sans + '</div>' +
      '</div>';
  }

  // action is null when the file can't be downloaded from here.
  function fileCard(title, file, action) {
    return '<div class="card"><div class="section-label">' + title + '</div>' +
      '<dl class="kv">' +
        '<dt>file</dt><dd>' + esc(file.filename) + '</dd>' +
        '<dt>size</dt><dd>' + esc(formatFileSize(file.size)) + '</dd>' +
        '<dt>modified</dt><dd>' + esc(fmtDate(file.modified ? new Date(file.modified) : null)) + '</dd>' +
      '</dl>' +
      (action ? '<div class="row">' + actionBtn(action, '↓ download') + '</div>' : '') + '</div>';
  }

  function filesHtml(cert, downloadable) {
    const cards = [];
    if (cert.cert) cards.push(fileCard('certificate', cert.cert, downloadable ? 'download-cert' : null));
    else cards.push('<div class="card"><div class="section-label">certificate</div><p class="text-muted">missing</p></div>');
    if (cert.key && cert.key.type === 'p12-bundle') {
      cards.push('<div class="card"><div class="section-label">private key</div><p class="text-muted">The private key is inside the .p12 bundle.</p></div>');
    } else if (cert.key) {
      cards.push(fileCard('private key', cert.key, downloadable ? 'download-key' : null));
    } else {
      cards.push('<div class="card"><div class="section-label">private key</div><p class="text-muted">missing</p></div>');
    }
    return '<div class="card-grid">' + cards.join('') + '</div>';
  }

  // ------------------------------------------------------------------ notes

  // readOnly: the notes route rejects this folder, so show the note only.
  function notesHtml(cert, loc, readOnly) {
    const note = certNotes.get(model.certKey(cert)) || '';
    if (readOnly) {
      return '<div class="card"><div class="section-label">notes</div>' +
        (note ? '<p class="note-text">' + esc(note) + '</p>' : '<p class="text-muted">No note.</p>') + '</div>';
    }
    return '<div class="card"><div class="section-label">notes</div>' +
      '<div class="certificate-notes" data-key="' + esc(model.certKey(cert)) + '" data-folder="' + esc(loc.folderParam) +
      '" data-name="' + esc(cert.name) + '">' +
      renderNoteContent(note) +
      '</div></div>';
  }

  function renderNoteContent(note) {
    if (note) {
      return '<p class="note-text">' + esc(note) + '</p>' +
        '<div class="row"><button class="btn" type="button" data-action="edit-note">edit note</button></div>';
    }
    return '<p class="text-muted">No note yet.</p>' +
      '<div class="row"><button class="btn" type="button" data-action="edit-note">add note</button></div>';
  }

  function noteKeyOf(container) {
    return container.dataset.key;
  }

  function openNoteEditor(container) {
    const current = certNotes.get(noteKeyOf(container)) || '';
    container.innerHTML =
      '<div class="field"><label for="note-editor">note</label>' +
      '<textarea class="input" id="note-editor" maxlength="2000" rows="4" placeholder="Notes about this certificate…"></textarea></div>' +
      '<div class="row">' +
        '<button class="btn btn--primary" type="button" data-action="save-note">save</button>' +
        '<button class="btn" type="button" data-action="cancel-note">cancel</button>' +
      '</div>';
    const textarea = container.querySelector('textarea');
    textarea.value = current; // set via DOM, not innerHTML — no escaping pitfalls
    textarea.focus();
  }

  function closeNoteEditor(container) {
    container.innerHTML = renderNoteContent(certNotes.get(noteKeyOf(container)) || '');
  }

  async function saveNote(container) {
    const note = container.querySelector('textarea').value;
    // API path uses folderParam + name; the local map uses the certKey.
    const key = noteKeyOf(container);
    const folder = container.dataset.folder;
    const name = container.dataset.name;
    try {
      const body = await state.api.put('/certificates/' + enc(folder) + '/' + enc(name) + '/notes', { note });
      const saved = body.note || '';
      certNotes.set(key, saved);
      const cert = state.certs.find((c) => model.certKey(c) === key);
      if (cert) cert.note = saved;
      closeNoteEditor(container);
      toast('note saved', 'ok');
    } catch (err) {
      // Keep the editor (and the typed text) so the user can retry.
      toast('failed to save note: ' + err.message, 'err');
    }
  }

  // --------------------------------------------------------------- detail UI

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
      el.hidden = el.id !== 'cert-panel-' + tab;
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

  function onDetailClick(e) {
    const tab = e.target.closest('[role="tab"]');
    if (tab && detailEl.contains(tab)) { selectTab(tab.dataset.tab, false); return; }

    const btn = e.target.closest('[data-action]');
    if (!btn || !detailEl.contains(btn)) return;
    const cert = state.selected;
    if (!cert) return;
    const folder = model.locationOf(cert).folderParam;

    switch (btn.dataset.action) {
      case 'bundle': downloadBundle(folder, cert.name); break;
      case 'download-cert': if (cert.cert) downloadCert(folder, cert.cert.filename); break;
      case 'download-key': if (cert.key) downloadKey(folder, cert.key.filename); break;
      case 'pfx': generatePFX(folder, cert.name); break;
      case 'archive': if (!model.archivedTwinOf(cert, state.certs)) archiveCertificate(folder, cert.name); break;
      case 'restore': restoreCertificate(folder, cert.name, !!model.activeTwinOf(cert, state.certs)); break;
      case 'delete': deleteCertificate(folder, cert.name, !!model.activeTwinOf(cert, state.certs)); break;
      case 'edit-note':
      case 'save-note':
      case 'cancel-note': {
        const container = btn.closest('.certificate-notes');
        if (!container) return;
        if (btn.dataset.action === 'edit-note') openNoteEditor(container);
        else if (btn.dataset.action === 'save-note') saveNote(container);
        else closeNoteEditor(container);
        break;
      }
    }
  }

  // ----------------------------------------------------------- quick generate

  function newestMatching(domain) {
    return state.certs
      .filter((c) => !c.isArchived &&
        ((Array.isArray(c.domains) && c.domains.includes(domain)) || c.name === domain))
      .sort((a, b) => mtime(b) - mtime(a))[0] || null;
  }

  async function onQuickGenerate(e) {
    e.preventDefault();
    const domains = model.parseQuickGenerate(domainsInput.value);
    if (domains.length === 0) {
      toast('enter at least one domain', 'err');
      domainsInput.focus();
      return;
    }
    const format = formatSelect.value;
    const submit = quickGenForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await state.api.post('/execute', { command: 'generate', input: domains.join(' '), format });
      toast('generated: ' + domains.join(', '), 'ok');
      domainsInput.value = '';
      await load();
      const target = newestMatching(domains[0]);
      if (target) location.hash = model.formatHash(model.certKey(target));
    } catch (err) {
      toast('generate failed: ' + err.message, 'err');
    } finally {
      submit.disabled = false;
    }
  }

  // -------------------------------------------------------- cert management

  // Archive/restore change a cert's key (certKey marks archived certs), so
  // follow the moved cert instead of letting the stale hash fall back.
  // Render now so the later hashchange finds the same selection and leaves
  // the detail (and focus) alone.
  function selectMoved(folder, certName, archived) {
    const moved = state.certs.find((c) => c.name === certName && !!c.isArchived === archived &&
      model.locationOf(c).folderParam === folder);
    if (!moved) return;
    location.hash = model.formatHash(model.certKey(moved));
    render();
  }

  // After an action rebuilds the panes, put focus somewhere meaningful:
  // the detail heading, else the selected list item, else the filter.
  function focusAfterChange() {
    const h1 = !detailEl.hidden && state.selected && detailEl.querySelector('h1[tabindex="-1"]');
    const current = groupsEl.querySelector('a.list-item[aria-current="true"]');
    (h1 || current || filterEl).focus();
  }

  // The server answers 409 TWIN_EXISTS when the list was stale and an
  // archived/active copy of the same name appeared in the meantime. The
  // handlers reload and keep the cert the user acted on selected.
  function isTwinConflict(err) {
    return !!(err && err.status === 409 && err.body && err.body.code === 'TWIN_EXISTS');
  }

  // Delete is only offered on archived certs; ?archived=true makes the server
  // delete the archive copy alone, never a same-named active cert.
  async function deleteCertificate(folder, certName, hasActiveTwin) {
    const ok = await confirmDialog(
      'permanently delete the archived "' + certName + '" and its key?' +
      (hasActiveTwin ? ' the active "' + certName + '" is not affected.' : ''), 'delete', true);
    if (!ok) return;
    try {
      await state.api.del('/certificates/' + enc(folder) + '/' + enc(certName) + '?archived=true');
      toast('certificate "' + certName + '" deleted permanently', 'ok');
      await load();
      focusAfterChange();
    } catch (err) {
      if (/read-only/i.test(err.message)) toast('root certificates are read-only and cannot be deleted', 'err');
      else toast('failed to delete certificate: ' + err.message, 'err');
    }
  }

  async function archiveCertificate(folder, certName) {
    // Read-only guards kept from the legacy page.
    if (folder === 'interface-ssl') { toast('interface SSL certificates cannot be archived', 'err'); return; }
    if (folder === 'root-ca') { toast('root CA certificates cannot be archived', 'err'); return; }
    if (folder === 'legacy') { toast('legacy certificates may be read-only and cannot be archived', 'err'); return; }
    const ok = await confirmDialog('Archive the certificate "' + certName + '"?', 'archive', false);
    if (!ok) return;
    try {
      await state.api.post('/certificates/' + enc(folder) + '/' + enc(certName) + '/archive');
      toast('certificate "' + certName + '" archived', 'ok');
      await load();
      selectMoved(folder, certName, true);
      focusAfterChange();
    } catch (err) {
      if (isTwinConflict(err)) {
        await load();
        toast('an archived "' + certName + '" already exists here — reloaded', 'err');
        selectMoved(folder, certName, false);
        focusAfterChange();
        return;
      }
      toast('failed to archive certificate: ' + err.message, 'err');
    }
  }

  // With an active twin, restore swaps the two copies (server ?swap=true).
  // Either way the active key then holds the restored cert, so select it.
  async function restoreCertificate(folder, certName, hasActiveTwin) {
    const ok = hasActiveTwin
      ? await confirmDialog('swap with the active "' + certName + '"? the active copy moves to the archive' +
          ' and this archived copy becomes active.', 'swap', true)
      : await confirmDialog('Restore the certificate "' + certName + '" from the archive?', 'restore', false);
    if (!ok) return;
    try {
      const body = await state.api.post('/certificates/' + enc(folder) + '/' + enc(certName) + '/restore' +
        (hasActiveTwin ? '?swap=true' : ''));
      toast(body.swapped
        ? 'certificate "' + certName + '" swapped with the active copy'
        : 'certificate "' + certName + '" restored', 'ok');
      await load();
      selectMoved(folder, certName, false);
      focusAfterChange();
    } catch (err) {
      if (isTwinConflict(err)) {
        await load();
        toast('an active "' + certName + '" exists — reloaded; try again', 'err');
        selectMoved(folder, certName, true);
        focusAfterChange();
        return;
      }
      toast('failed to restore certificate: ' + err.message, 'err');
    }
  }

  // --------------------------------------------------------------- downloads

  async function fetchBlob(url, init) {
    const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, init || {}));
    if (!res.ok) {
      let body = {};
      try { body = await res.json(); } catch (_) { /* not JSON */ }
      if (res.status === 401 && body.redirectTo) location.href = body.redirectTo;
      const err = new Error(body.error || ('HTTP ' + res.status + (res.statusText ? ' ' + res.statusText : '')));
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return res.blob();
  }

  function saveBlob(blob, filename) {
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }

  async function downloadFile(url, filename) {
    try {
      saveBlob(await fetchBlob(url), filename);
    } catch (err) {
      toast('download failed: ' + err.message, 'err');
    }
  }

  function downloadCert(folderParam, filename) {
    downloadFile('/api/download/cert/' + enc(folderParam) + '/' + enc(filename), filename);
  }

  function downloadKey(folderParam, filename) {
    downloadFile('/api/download/key/' + enc(folderParam) + '/' + enc(filename), filename);
  }

  function downloadBundle(folderParam, certname) {
    downloadFile('/api/download/bundle/' + enc(folderParam) + '/' + enc(certname), certname + '.zip');
  }

  // ------------------------------------------------------------------- PFX
  // The PFX endpoint answers with a file, not JSON, so it can't go through the
  // JSON api client; it carries its own CSRF token and retries once on CSRF_INVALID.

  async function getCsrf(refresh) {
    if (!state.csrf || refresh) {
      const body = await state.api.get('/csrf-token');
      state.csrf = body.csrfToken;
    }
    return state.csrf;
  }

  async function postForBlob(path, payload) {
    const send = async (refresh) => fetchBlob('/api' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': await getCsrf(refresh) },
      body: JSON.stringify(payload)
    });
    try {
      return await send(false);
    } catch (err) {
      if (err.status === 403 && err.body && err.body.code === 'CSRF_INVALID') return send(true);
      throw err;
    }
  }

  function generatePFX(folderParam, certname) {
    state.pfxTarget = { folderParam, certname };
    pfxForm.reset();
    pfxError.hidden = true;
    pfxError.textContent = '';
    pfxGenerateBtn.disabled = false;
    pfxGenerateBtn.textContent = 'generate pfx';
    pfxDialog.showModal();
    pfxPassword.focus();
  }

  async function onPfxSubmit(e) {
    e.preventDefault();
    const target = state.pfxTarget;
    if (!target) return;
    const password = pfxPassword.value;
    if (password !== pfxConfirm.value) {
      pfxError.textContent = 'passwords do not match';
      pfxError.hidden = false;
      pfxConfirm.focus();
      return;
    }
    pfxError.hidden = true;
    pfxGenerateBtn.disabled = true;
    pfxGenerateBtn.textContent = 'generating…';
    try {
      const blob = await postForBlob(
        '/generate/pfx/' + enc(target.folderParam) + '/' + enc(target.certname),
        { password: password || '' });
      saveBlob(blob, target.certname + '.pfx');
      toast('PFX file generated and downloaded', 'ok');
      pfxDialog.close();
    } catch (err) {
      pfxError.textContent = 'PFX generation failed: ' + err.message;
      pfxError.hidden = false;
      toast('PFX generation failed: ' + err.message, 'err');
    } finally {
      pfxGenerateBtn.disabled = false;
      pfxGenerateBtn.textContent = 'generate pfx';
    }
  }

  // ----------------------------------------------------------------- upload
  // Moved from the legacy page; element ids are unchanged.

  function setupUploadEventListeners() {
    if (!uploadDropzone || !fileInput) return;

    // Click to select files
    uploadDropzone.addEventListener('click', () => {
      fileInput.click();
    });

    // File input change
    fileInput.addEventListener('change', handleFileSelect);

    // Drag and drop events
    uploadDropzone.addEventListener('dragover', handleDragOver);
    uploadDropzone.addEventListener('dragenter', handleDragEnter);
    uploadDropzone.addEventListener('dragleave', handleDragLeave);
    uploadDropzone.addEventListener('drop', handleDrop);

    // Prevent default drag behaviors on the document
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    uploadDropzone.classList.add('dragover');
  }

  function handleDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
    uploadDropzone.classList.add('dragover');
  }

  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    // Only remove dragover if we're leaving the dropzone entirely
    if (!uploadDropzone.contains(e.relatedTarget)) {
      uploadDropzone.classList.remove('dragover');
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    uploadDropzone.classList.remove('dragover');
    handleFiles(Array.from(e.dataTransfer.files));
  }

  function handleFileSelect(e) {
    handleFiles(Array.from(e.target.files));
  }

  function handleFiles(files) {
    if (files.length === 0) return;

    const validExtensions = ['.pem', '.crt', '.key', '.cer', '.p7b', '.p7c', '.pfx', '.p12'];
    const extOf = (file) => '.' + file.name.split('.').pop().toLowerCase();
    const validFiles = files.filter((file) => validExtensions.includes(extOf(file)));
    const invalidFiles = files.filter((file) => !validExtensions.includes(extOf(file)));

    if (invalidFiles.length > 0) {
      toast('skipped ' + invalidFiles.length + ' invalid file(s). Only certificate and key files are allowed.', 'info');
    }
    if (validFiles.length === 0) {
      toast('no valid certificate files selected', 'err');
      return;
    }

    displayFileList(validFiles);
    uploadFiles(validFiles);
  }

  function displayFileList(files) {
    if (!fileList) return;

    fileList.innerHTML = '';
    files.forEach((file) => {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      const isKey = file.name.includes('-key') || file.name.includes('.key') || ext === '.key';
      const isCert = ['.pem', '.crt', '.cer'].includes(ext) && !isKey;
      const type = isCert ? 'certificate' : (isKey ? 'private key' : 'certificate file');

      // Built with DOM nodes so file.name (user-supplied) is never parsed as HTML.
      const fileItem = document.createElement('div');
      fileItem.className = 'file-item';

      const info = document.createElement('div');
      info.className = 'file-info';
      const nameEl = document.createElement('span');
      nameEl.className = 'file-name';
      nameEl.textContent = file.name;
      const sizeEl = document.createElement('span');
      sizeEl.className = 'file-size text-muted';
      sizeEl.textContent = '(' + type + ', ' + formatFileSize(file.size) + ')';
      info.append(nameEl, ' ', sizeEl);

      const status = document.createElement('div');
      status.className = 'file-status';
      status.dataset.file = file.name;
      status.textContent = 'pending';

      fileItem.append(info, status);
      fileList.appendChild(fileItem);
    });
  }

  async function uploadFiles(files) {
    if (!files || files.length === 0) return;

    if (uploadProgress) {
      uploadProgress.classList.add('visible');
      updateProgress(0, 'Preparing upload...');
    }
    if (uploadResults) {
      uploadResults.classList.remove('visible');
      uploadResults.innerHTML = '';
    }

    try {
      const formData = new FormData();
      files.forEach((file) => formData.append('certificates', file));

      updateProgress(25, 'Uploading files...');
      const result = await state.api.upload('/upload', formData);
      updateProgress(100, 'Upload complete!');

      setTimeout(() => {
        if (uploadProgress) uploadProgress.classList.remove('visible');
      }, 1500);

      updateFileStatuses(result);
      displayUploadResults(result);

      if (result.success && result.completePairs > 0) await load();

      if (fileInput) fileInput.value = '';
    } catch (error) {
      if (uploadProgress) uploadProgress.classList.remove('visible');
      fileList.querySelectorAll('.file-status').forEach((status) => {
        status.className = 'file-status error';
        status.textContent = '✕ failed';
      });
      if (fileInput) fileInput.value = '';
      toast('upload failed: ' + error.message, 'err');
    }
  }

  function updateProgress(percent, text) {
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    if (progressFill) progressFill.style.width = percent + '%';
    if (progressText) progressText.textContent = text;
  }

  function updateFileStatuses(result) {
    const fileStatuses = fileList.querySelectorAll('.file-status');

    fileStatuses.forEach((status) => {
      status.className = 'file-status success';
      status.textContent = '✓ uploaded';
    });

    if (result.errors && result.errors.length > 0) {
      result.errors.forEach((error) => {
        fileStatuses.forEach((status) => {
          if (String(error).includes(status.dataset.file)) {
            status.className = 'file-status error';
            status.textContent = '✕ error';
          }
        });
      });
    }

    if (result.incompletePairs && result.incompletePairs.length > 0) {
      result.incompletePairs.forEach((incomplete) => {
        fileStatuses.forEach((status) => {
          if (status.dataset.file.includes(incomplete.certName)) {
            status.className = 'file-status warning';
            status.textContent = '! missing ' + incomplete.missing;
          }
        });
      });
    }
  }

  function displayUploadResults(result) {
    if (!uploadResults) return;

    let html = '';
    if (result.success && result.completePairs > 0) {
      html += '<div class="banner banner--ok"><strong>Success!</strong> Uploaded ' +
        esc(result.completePairs) + ' certificate pair(s) to the "uploaded" folder.</div>';
    }
    if (result.incompletePairs && result.incompletePairs.length > 0) {
      // pair.certName / pair.hasFile come from user-supplied filenames. Escape.
      html += '<div class="banner banner--warn"><strong>Incomplete pairs:</strong> ' +
        result.incompletePairs.length + ' file(s) are missing their certificate or key pair.<ul>' +
        result.incompletePairs.map((pair) =>
          '<li>' + esc(pair.certName) + ': missing ' + esc(pair.missing) + ' (has: ' + esc(pair.hasFile) + ')</li>'
        ).join('') + '</ul></div>';
    }
    if (result.errors && result.errors.length > 0) {
      html += '<div class="banner banner--err"><strong>Errors:</strong><ul>' +
        result.errors.map((error) => '<li>' + esc(error) + '</li>').join('') + '</ul></div>';
    }
    if (!result.success && (!result.errors || result.errors.length === 0)) {
      html += '<div class="banner banner--err"><strong>Upload failed:</strong> No files were successfully processed.</div>';
    }

    uploadResults.innerHTML = html;
    uploadResults.classList.add('visible');
  }

  function openUploadDialog() {
    if (uploadResults) {
      uploadResults.classList.remove('visible');
      uploadResults.innerHTML = '';
    }
    if (fileList) fileList.innerHTML = '';
    uploadDialog.showModal();
  }

  // ------------------------------------------------------------------ filter

  // The list itself is not a live region (it is rebuilt on every keystroke);
  // only this short count is announced, and only when the filter changes.
  function announceFilter() {
    const total = state.certs.length;
    const q = state.query.trim();
    let msg;
    if (!q) msg = 'showing all ' + total + (total === 1 ? ' certificate' : ' certificates');
    else {
      const n = state.certs.filter((c) => model.matchesQuery(c, state.query)).length;
      msg = n === 0 ? 'no certificates match' : n + ' of ' + total + (total === 1 ? ' certificate' : ' certificates');
    }
    filterStatusEl.textContent = msg;
  }

  function onFilterInput() {
    state.query = filterEl.value;
    render();
    announceFilter();
  }

  // ---------------------------------------------------------------- keyboard

  function onDocumentKeydown(e) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target) || document.querySelector('dialog[open]')) return;
    e.preventDefault();
    filterEl.focus();
    filterEl.select();
  }

  function onFilterKeydown(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (filterEl.value) {
      filterEl.value = '';
      onFilterInput();
    } else {
      filterEl.blur();
    }
  }

  function onHashChange() {
    render();
    // Stacked layout: bring the detail into view after picking from the list.
    const active = document.activeElement;
    if (window.matchMedia('(max-width: 900px)').matches && active && groupsEl.contains(active)) {
      detailEl.scrollIntoView({ block: 'start' });
    }
  }

  // ------------------------------------------------------------------- init

  async function init() {
    groupsEl = document.getElementById('cert-groups');
    detailEl = document.getElementById('cert-detail');
    emptyEl = document.getElementById('cert-empty');
    filterEl = document.getElementById('cert-filter');
    filterStatusEl = document.getElementById('cert-filter-status');
    quickGenForm = document.getElementById('quick-gen');
    domainsInput = document.getElementById('quick-gen-domains');
    formatSelect = document.getElementById('quick-gen-format');

    uploadDialog = document.getElementById('upload-dialog');
    uploadDropzone = document.getElementById('upload-dropzone');
    fileInput = document.getElementById('file-input');
    uploadProgress = document.getElementById('upload-progress');
    uploadResults = document.getElementById('upload-results');
    fileList = document.getElementById('file-list');

    pfxDialog = document.getElementById('pfx-dialog');
    pfxForm = document.getElementById('pfx-form');
    pfxPassword = document.getElementById('pfx-password');
    pfxConfirm = document.getElementById('pfx-password-confirm');
    pfxError = document.getElementById('pfx-error');
    pfxGenerateBtn = document.getElementById('pfx-generate');

    // Wire handlers before anything is awaited so an early Enter in quick
    // generate never falls through to a native form submit; load the list
    // alongside the shell.
    state.api = core.createApiClient({});
    quickGenForm.addEventListener('submit', onQuickGenerate);
    filterEl.addEventListener('input', onFilterInput);
    filterEl.addEventListener('keydown', onFilterKeydown);
    document.addEventListener('keydown', onDocumentKeydown);
    detailEl.addEventListener('click', onDetailClick);
    detailEl.addEventListener('keydown', onDetailKeydown);
    window.addEventListener('hashchange', onHashChange);

    document.getElementById('open-upload').addEventListener('click', openUploadDialog);
    setupUploadEventListeners();

    pfxForm.addEventListener('submit', onPfxSubmit);
    document.getElementById('pfx-cancel').addEventListener('click', () => pfxDialog.close());

    await Promise.all([window.MK.shell.mountShell('certificates', { api: state.api }), load()]);
  }

  init().catch((err) => {
    toast('failed to start the certificates page: ' + err.message, 'err');
  });
})();
