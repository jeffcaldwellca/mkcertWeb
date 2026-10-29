(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.MK = root.MK || {}; root.MK.certModel = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ATTENTION_DAYS = 30;
  const DAY_MS = 86400000;

  function isRootCAName(cert) {
    return cert.name === 'mkcert-rootCA' || !!(cert.cert && cert.cert.filename === 'mkcert-rootCA.pem');
  }

  // Where a cert lives, and whether the server lets the UI act on it.
  function locationOf(cert) {
    const isRootCA = isRootCAName(cert);
    if (cert.isInterfaceSSL) {
      return { folderParam: 'interface-ssl', label: 'Interface SSL', readOnly: true, isRootCA };
    }
    // Every per-cert route rejects the uploaded folder, so it is view-only.
    if (cert.folder === 'uploaded') {
      return { folderParam: 'uploaded', label: 'Uploaded', readOnly: true, isRootCA };
    }
    if (cert.folder) {
      return { folderParam: cert.folder, label: cert.folder, readOnly: false, isRootCA };
    }
    if (isRootCA) {
      return { folderParam: 'root-ca', label: 'Root CA', readOnly: true, isRootCA };
    }
    return { folderParam: 'legacy', label: 'Legacy', readOnly: cert.canEdit === false, isRootCA };
  }

  // Archived and active certs can share folder + name, so the key marks archived ones.
  function certKey(cert) {
    return locationOf(cert).folderParam + '/' + (cert.isArchived ? 'archive/' : '') + cert.name;
  }

  // The active cert sharing an archived cert's folder + name, if any.
  // Deleting the archived copy would also remove it on the server.
  function activeTwinOf(cert, certs) {
    if (!cert || !cert.isArchived) return null;
    const folder = locationOf(cert).folderParam;
    return (certs || []).find((c) => !c.isArchived && c.name === cert.name &&
      locationOf(c).folderParam === folder) || null;
  }

  function classify(cert, now) {
    if (!cert.expiry) return { state: 'unknown', daysLeft: null };
    const expiry = new Date(cert.expiry);
    if (isNaN(expiry.getTime())) return { state: 'unknown', daysLeft: null };
    const daysLeft = Math.ceil((expiry - now) / DAY_MS);
    let state = 'valid';
    if (daysLeft < 0) state = 'expired';
    else if (daysLeft <= ATTENTION_DAYS) state = 'attention';
    return { state, daysLeft };
  }

  const GROUP_LABELS = {
    attention: 'NEEDS ATTENTION',
    healthy: 'HEALTHY',
    readonly: 'READ-ONLY',
    archived: 'ARCHIVED'
  };
  const GROUP_ORDER = ['attention', 'healthy', 'readonly', 'archived'];

  function groupIdOf(cert, state) {
    if (cert.isArchived) return 'archived';
    if (locationOf(cert).readOnly) return 'readonly';
    return (state === 'expired' || state === 'attention') ? 'attention' : 'healthy';
  }

  function groupCertificates(certs, now) {
    const buckets = { attention: [], healthy: [], readonly: [], archived: [] };
    (certs || []).forEach((cert) => {
      const c = classify(cert, now);
      buckets[groupIdOf(cert, c.state)].push({ cert, daysLeft: c.daysLeft });
    });
    return GROUP_ORDER
      .filter((id) => buckets[id].length > 0)
      .map((id) => ({
        id,
        label: GROUP_LABELS[id],
        items: buckets[id].sort((a, b) => {
          if (a.daysLeft !== b.daysLeft) {
            if (a.daysLeft === null) return 1;
            if (b.daysLeft === null) return -1;
            return a.daysLeft - b.daysLeft;
          }
          return String(a.cert.name).localeCompare(String(b.cert.name));
        }).map((x) => x.cert)
      }));
  }

  function metaLine(cert, now) {
    const { state, daysLeft } = classify(cert, now);
    let head;
    if (state === 'unknown') head = 'expiry unknown';
    else if (state === 'expired') head = 'expired ' + Math.abs(daysLeft) + 'd ago';
    else if (state === 'attention') head = 'expires in ' + daysLeft + 'd';
    else head = daysLeft + 'd left';
    const n = Array.isArray(cert.domains) ? cert.domains.length : 0;
    return head + ' · ' + n + (n === 1 ? ' SAN' : ' SANs');
  }

  function matchesQuery(cert, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    const fields = [cert.name, cert.format, locationOf(cert).label]
      .concat(Array.isArray(cert.domains) ? cert.domains : []);
    return fields.some((f) => f != null && String(f).toLowerCase().includes(q));
  }

  function parseQuickGenerate(text) {
    const tokens = String(text || '').split(/[\s,]+/).filter(Boolean);
    if (tokens.length && tokens[0].toLowerCase() === 'mkcert') tokens.shift();
    return tokens.filter((t, i) => tokens.indexOf(t) === i);
  }

  function resolveSelection(groups, hashKey) {
    const keys = [];
    (groups || []).forEach((g) => g.items.forEach((c) => keys.push(certKey(c))));
    if (hashKey && keys.includes(hashKey)) return hashKey;
    return keys.length ? keys[0] : null;
  }

  function parseHash(hash) {
    const m = /^#cert=(.+)$/.exec(String(hash || ''));
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch (e) { return null; }
  }

  function formatHash(key) {
    return '#cert=' + encodeURIComponent(key);
  }

  return {
    ATTENTION_DAYS, locationOf, certKey, activeTwinOf, classify, groupCertificates, metaLine,
    matchesQuery, parseQuickGenerate, resolveSelection, parseHash, formatHash
  };
});
