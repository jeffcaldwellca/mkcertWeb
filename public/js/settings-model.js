(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.MK = root.MK || {}; root.MK.settingsModel = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SECTION_GROUPS = [
    { label: 'SERVER', sections: ['server'] },
    { label: 'ACCESS', sections: ['auth', 'ratelimit'] },
    { label: 'ALERTS', sections: ['email', 'ntfy', 'webhook', 'monitoring'] },
    { label: 'APPEARANCE', sections: ['theme'] }
  ];

  const ENABLE_KEY = {
    auth: 'auth.enabled',
    email: 'email.enabled',
    ntfy: 'ntfy.enabled',
    webhook: 'webhook.enabled',
    monitoring: 'monitoring.enabled'
  };

  function flatten(obj, prefix = '') {
    const out = {};
    for (const key of Object.keys(obj || {})) {
      const value = obj[key];
      const path = prefix ? prefix + '.' + key : key;
      if (value && typeof value === 'object' && !Array.isArray(value)) Object.assign(out, flatten(value, path));
      else out[path] = value;
    }
    return out;
  }

  function diffSettings(saved, current) {
    const a = flatten(saved);
    const b = flatten(current);
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const changed = [];
    for (const k of keys) {
      const inA = Object.prototype.hasOwnProperty.call(a, k);
      const inB = Object.prototype.hasOwnProperty.call(b, k);
      if (inA !== inB || String(a[k]) !== String(b[k])) changed.push(k);
    }
    return changed.sort();
  }

  function matchesSetting(setting, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    const s = setting || {};
    return String(s.label || '').toLowerCase().includes(q) || String(s.key || '').toLowerCase().includes(q);
  }

  function sectionFromHash(hash) {
    const m = /^#section=([A-Za-z0-9_-]+)$/.exec(String(hash || ''));
    if (!m) return null;
    const ids = SECTION_GROUPS.flatMap((g) => g.sections);
    return ids.includes(m[1]) ? m[1] : null;
  }

  return { SECTION_GROUPS, ENABLE_KEY, flatten, diffSettings, matchesSetting, sectionFromHash };
});
