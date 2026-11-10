// OIDC strategy registration via discovery.
//
// passport-openidconnect doesn't do discovery on its own, so we fetch
// ${issuer}/.well-known/openid-configuration and hand it the discovered URLs.
// Discovery is attempted at startup and, if that failed (provider not up yet,
// network blip), again whenever someone tries to sign in with SSO (#59). A
// failure never crashes boot, so basic auth keeps working meanwhile.
const OpenIDConnectStrategy = require('passport-openidconnect');

const DEFAULT_DISCOVERY_TIMEOUT_MS = 10_000;
// After a failed attempt, wait this long before contacting the provider
// again, so a burst of SSO clicks doesn't hammer a provider that is down.
const DEFAULT_RETRY_COOLDOWN_MS = 10_000;

async function discoverOIDC(issuer, timeoutMs) {
  // Trim trailing slash so we don't get a double slash in the URL
  const base = issuer.replace(/\/$/, '');
  const url  = `${base}/.well-known/openid-configuration`;
  let res;
  try {
    res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err.name === 'TimeoutError') throw new Error(`Discovery timed out after ${timeoutMs}ms for ${url}`);
    const cause = err.cause && (err.cause.code || err.cause.message);
    throw new Error(`Discovery request failed for ${url}: ${cause || err.message}`);
  }
  if (!res.ok) throw new Error(`Discovery failed: ${res.status} ${res.statusText} for ${url}`);
  const doc = await res.json();
  for (const field of ['authorization_endpoint', 'token_endpoint', 'userinfo_endpoint']) {
    if (!doc[field]) throw new Error(`Discovery doc from ${url} is missing ${field}`);
  }
  return doc;
}

function createOidcManager({
  passport,
  issuer: configuredIssuer,
  clientId,
  clientSecret,
  callbackUrl,
  scope,
  discoveryTimeoutMs = DEFAULT_DISCOVERY_TIMEOUT_MS,
  retryCooldownMs = DEFAULT_RETRY_COOLDOWN_MS,
  now = Date.now,
  logger = console
}) {
  let configured = false;
  let endSessionEndpoint = null;
  let inFlight = null;
  let lastFailureAt = null;

  async function configure() {
    const doc = await discoverOIDC(configuredIssuer, discoveryTimeoutMs);
    const supportsPKCE = Array.isArray(doc.code_challenge_methods_supported)
      && doc.code_challenge_methods_supported.includes('S256');
    // The strategy compares the ID token's `iss` claim against this value
    // with strict equality, so use the issuer the provider advertises rather
    // than the (possibly trailing-slash-different) configured string.
    const issuer = doc.issuer || configuredIssuer;
    if (doc.issuer && doc.issuer !== configuredIssuer) {
      logger.warn(`  OIDC issuer normalised: configured "${configuredIssuer}", provider reports "${doc.issuer}"`);
    }
    passport.use('oidc', new OpenIDConnectStrategy({
      issuer,
      authorizationURL: doc.authorization_endpoint,
      tokenURL:         doc.token_endpoint,
      userInfoURL:      doc.userinfo_endpoint,
      clientID:         clientId,
      clientSecret,
      callbackURL:      callbackUrl,
      scope,
      // passport-openidconnect generates a `state` param by default and
      // validates it on callback (the OAuth 2.0 CSRF defense).
      pkce: supportsPKCE
    }, (iss, profile, context, idToken, accessToken, refreshToken, done) => {
      // 7-arg verify signature so we receive the raw ID token (needed for
      // id_token_hint on RP-initiated logout).
      const user = {
        id: profile.id,
        email: profile.emails ? profile.emails[0].value : null,
        name: profile.displayName || profile.username,
        provider: 'oidc',
        idToken
      };
      return done(null, user);
    }));
    endSessionEndpoint = doc.end_session_endpoint || null;
    configured = true;
    logger.log(`✓ OIDC configured via discovery (${issuer})${supportsPKCE ? ' with PKCE' : ''}${endSessionEndpoint ? ', RP-initiated logout' : ''}`);
  }

  // Resolves true once the 'oidc' strategy is registered. Never rejects:
  // a discovery failure is logged and resolves false. Concurrent callers
  // share one attempt.
  function ensureConfigured() {
    if (configured) return Promise.resolve(true);
    if (inFlight) return inFlight;
    if (lastFailureAt !== null && now() - lastFailureAt < retryCooldownMs) return Promise.resolve(false);

    inFlight = configure()
      .then(() => true)
      .catch((err) => {
        lastFailureAt = now();
        logger.error(`⚠ OIDC discovery failed: ${err.message}`);
        logger.error('  OIDC login is unavailable until the provider can be reached; discovery is retried on the next SSO sign-in. Basic auth still works.');
        return false;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  }

  // Route guard for /auth/oidc and its callback: (re)try discovery if the
  // strategy isn't registered yet, and send the browser back to the login
  // page rather than letting passport throw "Unknown authentication strategy".
  function requireStrategy(req, res, next) {
    ensureConfigured().then((ok) => {
      if (ok) return next();
      res.redirect('/login?error=oidc_unavailable');
    }).catch(next);
  }

  return {
    ensureConfigured,
    requireStrategy,
    isConfigured: () => configured,
    endSessionEndpoint: () => endSessionEndpoint
  };
}

module.exports = { createOidcManager };
