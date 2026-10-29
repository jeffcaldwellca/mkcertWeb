// FORCE_HTTPS: redirect plain-HTTP requests to the HTTPS server.

// Strip an optional :port from a Host header value, handling bracketed IPv6.
function stripHostPort(host) {
  if (host.startsWith('[')) {
    const m = host.match(/^(\[[^\]]+\])(?::\d+)?$/);
    return m ? m[1] : host;
  }
  const colon = host.indexOf(':');
  return colon === -1 ? host : host.slice(0, colon);
}

/**
 * Construct an absolute https:// URL pointing at the same host on the HTTPS
 * port. Returns null when there is no Host to redirect to (caller should then
 * skip the redirect rather than crash).
 *
 * Unlike a naive host.replace(httpPort, httpsPort), this never substitutes the
 * port digits where they happen to appear inside an IP address or hostname.
 *
 * @param {string|undefined} host - the raw Host header (may include a port)
 * @param {string} url - the request URL/path to preserve
 * @param {number} httpsPort - the port the HTTPS server listens on
 * @returns {string|null}
 */
function buildHttpsRedirectUrl(host, url, httpsPort) {
  if (!host) return null;
  const bareHost = stripHostPort(host);
  const portSuffix = Number(httpsPort) === 443 ? '' : `:${httpsPort}`;
  return `https://${bareHost}${portSuffix}${url}`;
}

// Paths that are never redirected:
// - /scep: SCEP clients talk plain HTTP (messages are protected by PKCS#7)
//   and don't follow redirects;
// - /api/health: the Docker HEALTHCHECK probes it over plain HTTP.
// Exemption is by path only, never by client address: behind a reverse proxy
// on the same host every request comes from loopback.
const EXEMPT_PATHS = new Set(['/scep', '/api/health']);

/**
 * Express middleware that answers plain-HTTP requests with a 301 to the same
 * URL on the HTTPS port. Register it before static files and routes.
 *
 * "Already HTTPS" is req.secure only: with the app's `trust proxy` setting it
 * honours X-Forwarded-Proto from trusted proxies, and ignores it from anyone
 * else, so a client can't skip the redirect by sending the header itself.
 *
 * @param {object} options
 * @param {number} options.httpsPort
 * @param {() => boolean} [options.isActive] - redirect only while this returns
 *   true (server.js: once the HTTPS server is listening)
 */
function createHttpsRedirect({ httpsPort, isActive = () => true }) {
  return (req, res, next) => {
    if (!isActive()) return next();
    if (req.secure) return next();
    if (EXEMPT_PATHS.has(req.path)) return next();
    const target = buildHttpsRedirectUrl(req.get('host'), req.originalUrl, httpsPort);
    if (target) return res.redirect(301, target);
    // No Host header to redirect to: fail loudly rather than crash.
    return res.status(400).send('Missing Host header');
  };
}

module.exports = { buildHttpsRedirectUrl, stripHostPort, createHttpsRedirect };
