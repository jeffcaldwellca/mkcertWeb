// Single source of truth for "is this request authenticated, and as whom?"
//
// There are two login paths that must be treated identically everywhere:
//   1. Basic (username/password) login sets req.session.authenticated/username.
//   2. OIDC login goes through passport, which stores the user under
//      req.session.passport and exposes it as req.user / req.isAuthenticated().
//
// Previously /api/auth/status only checked path (1), so an OIDC user would be
// served index.html by GET / but then immediately bounced back to /login by
// the frontend's auth-status check (GitHub #43).
function getAuthState(req) {
  if (req && req.session && req.session.authenticated) {
    return { authenticated: true, username: req.session.username || null };
  }
  if (req && req.user && typeof req.isAuthenticated === 'function' && req.isAuthenticated()) {
    const u = req.user;
    return { authenticated: true, username: u.name || u.email || u.id || null };
  }
  return { authenticated: false, username: null };
}

function isAuthenticated(req) {
  return getAuthState(req).authenticated;
}

module.exports = { getAuthState, isAuthenticated };
