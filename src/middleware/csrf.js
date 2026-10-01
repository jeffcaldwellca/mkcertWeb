// CSRF protection middleware module
//
// Each session gets its own secret; the frontend fetches a token from
// /api/csrf-token and sends it in the X-CSRF-Token header (see apiRequest in
// public/script.js). verifyCsrf rejects any state-changing request without a
// valid token. The session cookie is also sameSite: 'lax' (see server.js).
const Tokens = require('csrf');
const tokens = new Tokens();

// GET/HEAD/OPTIONS are exempt by definition. We also skip the login POST (no
// session yet) and the OIDC callback (state param is the OAuth-layer defense).
const CSRF_EXEMPT_PATHS = new Set([
  '/api/auth/login',
  '/login',
  '/api/auth/logout',     // logout is intentionally low-friction; protected by sameSite
  '/auth/oidc',
  '/auth/oidc/callback',
  '/scep'                 // SCEP is a protocol endpoint, not a browser form
]);

// Returns a token for the session, creating the session's secret on first use.
function issueCsrfToken(req) {
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = tokens.secretSync();
  }
  return tokens.create(req.session.csrfSecret);
}

function verifyCsrf(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (CSRF_EXEMPT_PATHS.has(req.path)) return next();
  const secret = req.session && req.session.csrfSecret;
  const token  = req.get('x-csrf-token') || (req.body && req.body._csrf);
  if (!secret || !token || !tokens.verify(secret, token)) {
    return res.status(403).json({ success: false, error: 'Invalid CSRF token', code: 'CSRF_INVALID' });
  }
  next();
}

module.exports = { verifyCsrf, issueCsrfToken, CSRF_EXEMPT_PATHS };
