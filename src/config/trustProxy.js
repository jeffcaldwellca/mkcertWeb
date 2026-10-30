// TRUST_PROXY: Express's 'trust proxy' setting, which decides whose
// X-Forwarded-For / X-Forwarded-Proto headers are believed (client IP for
// rate limiting, req.secure for FORCE_HTTPS). Environment-only on purpose.
const express = require('express');

// The value before TRUST_PROXY existed: any loopback, link-local or private
// (RFC 1918 / ULA) address. Keeps a proxy container on a Docker network
// working, but lets any client on a private LAN spoof the headers.
const DEFAULT_TRUST_PROXY = 'loopback,linklocal,uniquelocal';

/**
 * Parse TRUST_PROXY into a value for app.set('trust proxy', …):
 * unset/blank → the default; "true"/"false" → boolean; a whole number → hop
 * count; anything else → a comma-separated list of addresses, CIDRs or the
 * named ranges loopback, linklocal, uniquelocal. Throws on a value Express
 * would reject, so a typo can't start the server with the wrong trust.
 */
function parseTrustProxy(raw) {
  const text = raw === undefined || raw === null ? '' : String(raw).trim();
  if (text === '') return DEFAULT_TRUST_PROXY;
  const lower = text.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (/^\d+$/.test(text)) return Number(text);
  const list = text.split(',').map((s) => s.trim()).filter(Boolean).join(',');
  try {
    express().set('trust proxy', list); // compiles the list; throws on a bad entry
  } catch (err) {
    throw new Error(`TRUST_PROXY: invalid value "${text}": ${err.message}. ` +
      'Use true, false, a hop count, or comma-separated addresses, CIDRs or loopback/linklocal/uniquelocal.');
  }
  return list;
}

module.exports = { parseTrustProxy, DEFAULT_TRUST_PROXY };
