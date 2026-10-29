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

// Connections from this machine itself (e.g. the Docker HEALTHCHECK, which
// requests http://localhost:3000/). Uses the socket address, not req.ip, so a
// client forwarded by a proxy is never exempt.
function isLoopbackAddress(addr) {
  if (!addr) return false;
  const a = addr.startsWith('::ffff:') ? addr.slice(7) : addr;
  return a === '::1' || /^127\.\d+\.\d+\.\d+$/.test(a);
}

// SCEP clients talk plain HTTP (messages are protected by PKCS#7) and don't
// follow redirects, so the protocol endpoint is never redirected.
const EXEMPT_PATHS = new Set(['/scep']);

/**
 * Express middleware that answers plain-HTTP requests with a 301 to the same
 * URL on the HTTPS port. Register it before static files and routes.
 *
 * @param {object} options
 * @param {number} options.httpsPort
 * @param {() => boolean} [options.isActive] - redirect only while this returns
 *   true (server.js: once the HTTPS server is listening)
 * @param {boolean} [options.exemptLoopback=true] - let loopback clients through
 */
function createHttpsRedirect({ httpsPort, isActive = () => true, exemptLoopback = true }) {
  return (req, res, next) => {
    if (!isActive()) return next();
    if (req.secure || req.get('x-forwarded-proto') === 'https') return next();
    if (EXEMPT_PATHS.has(req.path)) return next();
    if (exemptLoopback && isLoopbackAddress(req.socket && req.socket.remoteAddress)) return next();
    const target = buildHttpsRedirectUrl(req.get('host'), req.originalUrl, httpsPort);
    if (target) return res.redirect(301, target);
    // No Host header to redirect to: fail loudly rather than crash.
    return res.status(400).send('Missing Host header');
  };
}

module.exports = { buildHttpsRedirectUrl, stripHostPort, isLoopbackAddress, createHttpsRedirect };
