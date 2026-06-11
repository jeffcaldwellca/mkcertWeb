// Build the HTTPS redirect target for the FORCE_HTTPS middleware.

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

module.exports = { buildHttpsRedirectUrl, stripHostPort };
