// Security helpers for the settings API: secret masking and write allowlisting.
//
// These are pure functions (no I/O) so they can be unit-tested and reused by
// both the GET (sanitize) and POST/import (allowlist) settings paths.

const MASK = '********';

// Secret leaves that must never be sent back to a client. Each entry is a path
// into the settings object. `mode: 'value'` masks a scalar; `mode: 'object'`
// masks every value of the object at that path (e.g. webhook auth headers).
const SECRET_DESCRIPTORS = [
  { path: ['auth', 'password'], mode: 'value', empty: true },
  { path: ['auth', 'sessionSecret'], mode: 'value' },
  { path: ['oidc', 'clientSecret'], mode: 'value' },
  { path: ['email', 'smtp', 'auth', 'pass'], mode: 'value' },
  { path: ['ntfy', 'token'], mode: 'value' },
  { path: ['ntfy', 'password'], mode: 'value' },
  { path: ['webhook', 'headers'], mode: 'object' }
];

const SECRET_PATHS = SECRET_DESCRIPTORS.map((d) => d.path);

// Editable settings schema, mirroring the fields in public/settings.html.
// Anything outside this set is rejected on write — this confines POST/import to
// the known schema and blocks prototype pollution and unknown-key injection.
const ALLOWED_PATHS = [
  'auth.enabled', 'auth.username', 'auth.password', 'auth.sessionSecret',
  'email.enabled', 'email.from', 'email.to', 'email.subject',
  'email.smtp.host', 'email.smtp.port', 'email.smtp.secure',
  'email.smtp.auth.user', 'email.smtp.auth.pass', 'email.smtp.tls.rejectUnauthorized',
  'monitoring.enabled', 'monitoring.checkInterval', 'monitoring.warningDays',
  'monitoring.criticalDays', 'monitoring.includeUploaded',
  'ntfy.enabled', 'ntfy.url', 'ntfy.topic', 'ntfy.token',
  'ntfy.username', 'ntfy.password', 'ntfy.priority',
  'oidc.enabled', 'oidc.issuer', 'oidc.clientId', 'oidc.clientSecret',
  'oidc.callbackUrl', 'oidc.scope',
  'paths.certificates', 'paths.uploaded',
  'rateLimit.cli.window', 'rateLimit.cli.max',
  'rateLimit.api.window', 'rateLimit.api.max',
  'rateLimit.auth.window', 'rateLimit.auth.max',
  'server.host', 'server.port', 'server.httpsPort',
  'server.enableHttps', 'server.forceHttps', 'server.sslDomain',
  'theme.mode', 'theme.primaryColor', 'theme.darkMode',
  'webhook.enabled', 'webhook.url'
];

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function getAtPath(obj, path) {
  return path.reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), obj);
}

/**
 * Mask all secret fields. Returns a deep clone; the input is never mutated.
 */
function sanitizeSettings(settings) {
  const out = JSON.parse(JSON.stringify(settings));

  for (const { path, mode, empty } of SECRET_DESCRIPTORS) {
    const parent = getAtPath(out, path.slice(0, -1));
    const key = path[path.length - 1];
    if (!parent || typeof parent !== 'object' || !(key in parent)) continue;

    if (mode === 'object') {
      const headers = parent[key];
      if (headers && typeof headers === 'object') {
        for (const h of Object.keys(headers)) headers[h] = MASK;
      }
    } else if (parent[key]) {
      parent[key] = empty ? '' : MASK;
    }
  }

  return out;
}

/**
 * Build a tree of allowed leaf paths for fast lookup during filtering.
 */
function buildAllowTree(paths) {
  const root = {};
  for (const p of paths) {
    let node = root;
    const parts = p.split('.');
    parts.forEach((part, i) => {
      node[part] = node[part] || (i === parts.length - 1 ? true : {});
      if (i < parts.length - 1) node = node[part];
    });
  }
  return root;
}

const ALLOW_TREE = buildAllowTree(ALLOWED_PATHS);

/**
 * Return a copy of `updates` containing only keys present in the editable
 * schema. Unknown top-level sections, unknown nested keys, and unsafe keys
 * (__proto__/constructor/prototype) are dropped.
 */
function filterAllowedSettings(updates, allowNode = ALLOW_TREE) {
  const out = {};
  if (!updates || typeof updates !== 'object') return out;

  for (const key of Object.keys(updates)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const allow = allowNode[key];
    if (allow === undefined) continue;

    const value = updates[key];
    if (allow === true) {
      out[key] = value;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const filtered = filterAllowedSettings(value, allow);
      if (Object.keys(filtered).length > 0) out[key] = filtered;
    }
    // A nested-allow node with a non-object value is a schema mismatch: drop it.
  }

  return out;
}

/**
 * Delete secret fields whose value is the masked placeholder (or, for
 * auth.password, empty) so persisting a round-tripped settings object leaves
 * the real secret untouched. Mutates `settings` in place.
 */
function stripPlaceholderSecrets(settings) {
  for (const { path, mode, empty } of SECRET_DESCRIPTORS) {
    const parent = getAtPath(settings, path.slice(0, -1));
    const key = path[path.length - 1];
    if (!parent || typeof parent !== 'object' || !(key in parent)) continue;

    if (mode === 'object') {
      const headers = parent[key];
      if (headers && typeof headers === 'object') {
        for (const h of Object.keys(headers)) {
          if (headers[h] === MASK) delete headers[h];
        }
      }
    } else if (parent[key] === MASK || (empty && parent[key] === '')) {
      delete parent[key];
    }
  }
  return settings;
}

module.exports = {
  sanitizeSettings,
  filterAllowedSettings,
  stripPlaceholderSecrets,
  SECRET_PATHS,
  ALLOWED_PATHS,
  MASK
};
