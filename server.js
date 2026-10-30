// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const https = require('https');
const http = require('http');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const passport = require('passport');
const OpenIDConnectStrategy = require('passport-openidconnect');
const { securityHeaders } = require('./src/config/securityHeaders');

// Single safe execution path — execFile, no shell. (executeCommand isn't
// used directly in server.js anymore; the route modules import it themselves.)
const { runTool } = require('./src/security');
const { createHttpsRedirect } = require('./src/utils/httpsRedirect');
const { apiResponse, errorHandler } = require('./src/utils/responses');
const { getAuthState, isAuthenticated, createRequireAuth } = require('./src/utils/authState');
const { buildEndSessionUrl } = require('./src/utils/oidcLogout');

// Import SCEP routes
const { createSCEPRoutes } = require('./src/routes/scep');

// Import notification routes and services
const createNotificationRoutes = require('./src/routes/notifications');

// Import certificate, system, settings, and file routes
const { createCertificateRoutes } = require('./src/routes/certificates');
const { createSystemRoutes } = require('./src/routes/system');
const createSettingsRoutes = require('./src/routes/settings');
const { createFileRoutes } = require('./src/routes/files');

const config = require('./src/config');
const { EmailService } = require('./src/services/emailService');
const { NtfyService } = require('./src/services/ntfyService');
const { WebhookService } = require('./src/services/webhookService');
const { CertificateMonitoringService } = require('./src/services/certificateMonitoringService');
const { createRateLimiters } = require('./src/middleware/rateLimiting');
const { verifyCsrf, issueCsrfToken } = require('./src/middleware/csrf');

// CSRF is enforced by our own middleware (src/middleware/csrf.js, applied with
// app.use(verifyCsrf) below), which this rule doesn't recognise.
// nosemgrep: javascript.express.security.audit.express-check-csurf-middleware-usage.express-check-csurf-middleware-usage
const app = express();
// Use config.* for all runtime values — this respects settings.json AND env var overrides
const PORT       = config.server.port;
const HTTPS_PORT = config.server.httpsPort;
const ENABLE_HTTPS = config.server.enableHttps;
const SSL_DOMAIN   = config.server.sslDomain;
const FORCE_HTTPS  = config.server.forceHttps;

// Authentication configuration
const ENABLE_AUTH    = config.auth.enabled;
const AUTH_USERNAME  = config.auth.username;
const AUTH_PASSWORD  = config.auth.password;

// SECURITY: refuse to run with the published default session secret.
// If unset (or still the documented placeholder), mint a per-process random secret.
// This invalidates sessions across restarts when no real secret is configured,
// which is the desired behavior — it forces operators to set one in production.
const DEFAULT_SESSION_SECRET = 'mkcert-web-ui-secret-key-change-in-production';
const TEST_SESSION_SECRET    = 'test-secret-key-for-development';
let SESSION_SECRET = config.auth.sessionSecret;
if (!SESSION_SECRET || SESSION_SECRET === DEFAULT_SESSION_SECRET || SESSION_SECRET === TEST_SESSION_SECRET) {
  SESSION_SECRET = require('crypto').randomBytes(48).toString('hex');
  console.warn('⚠ SESSION_SECRET not configured (or using a known default). Generated an ephemeral secret for this process.');
  console.warn('  Sessions will not survive restarts. Set SESSION_SECRET to a long random string in production.');
}

// SECURITY: hash the password at startup so the plaintext doesn't sit in memory or get
// reflected back through any future logging/error path. Also accept a pre-hashed value
// via AUTH_PASSWORD_HASH for operators who prefer not to put plaintext in env.
let AUTH_PASSWORD_HASH = process.env.AUTH_PASSWORD_HASH || null;
if (ENABLE_AUTH && !AUTH_PASSWORD_HASH) {
  let plaintext = AUTH_PASSWORD;
  if (!plaintext || plaintext === 'admin') {
    plaintext = require('crypto').randomBytes(18).toString('base64');
    console.warn('⚠ AUTH_PASSWORD not set (or still "admin"). Generated a random one-time password:');
    console.warn(`   username: ${AUTH_USERNAME}`);
    console.warn(`   password: ${plaintext}`);
    console.warn('  Set AUTH_PASSWORD (or AUTH_PASSWORD_HASH) to keep credentials stable across restarts.');
  }
  AUTH_PASSWORD_HASH = bcrypt.hashSync(plaintext, 12);
}

// Timing-safe string compare for the username (constant-time on equal-length buffers).
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return require('crypto').timingSafeEqual(ab, bb);
}

// OIDC configuration
const ENABLE_OIDC      = config.oidc.enabled;
const OIDC_ISSUER      = config.oidc.issuer;
const OIDC_CLIENT_ID   = config.oidc.clientId;
const OIDC_CLIENT_SECRET = config.oidc.clientSecret;
const OIDC_CALLBACK_URL  = config.oidc.callbackUrl || `http://localhost:${PORT}/auth/oidc/callback`;
const OIDC_SCOPE         = config.oidc.scope || 'openid profile email';
// Populated from discovery at boot; null if the provider doesn't support RP-initiated logout.
let OIDC_END_SESSION_ENDPOINT = null;

// Middleware
// CORS: same-origin app. Allow cross-origin only if explicitly configured via
// ALLOWED_ORIGINS (comma-separated). Otherwise no CORS is emitted, which
// makes the browser's same-origin policy do its job.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
if (allowedOrigins.length > 0) {
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true
  }));
}

// Security headers via helmet — options live in src/config/securityHeaders.js
// so tests can assert the CSP without booting the server.
app.use(securityHeaders());

// FORCE_HTTPS: redirect plain-HTTP requests before any static file or route
// can answer them. It only redirects once the HTTPS server is listening (so a
// failed HTTPS start doesn't send everyone to a dead port), and never for
// /api/health (the Docker health check) or /scep. X-Forwarded-Proto counts
// only from trusted proxies (see 'trust proxy' below).
let httpsListening = false;
if (ENABLE_HTTPS && FORCE_HTTPS) {
  app.use(createHttpsRedirect({ httpsPort: HTTPS_PORT, isActive: () => httpsListening }));
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Which proxies may set X-Forwarded-For/-Proto (req.ip for rate limiting,
// req.secure for FORCE_HTTPS). TRUST_PROXY, default
// 'loopback,linklocal,uniquelocal'; see src/config/trustProxy.js.
app.set('trust proxy', config.server.trustProxy);

// Session configuration
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'mkcertweb.sid',
  cookie: {
    // 'auto' = secure when the connection is TLS, plain otherwise. Works in dev + prod.
    secure: ENABLE_HTTPS ? 'auto' : false,
    httpOnly: true,
    sameSite: 'lax', // CSRF defense; 'lax' allows OIDC redirect-back to carry the cookie
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Rate limiters need to exist before auth routes are registered (we apply
// authRateLimiter to the login POST). Services that depend on config can be
// created later — only the limiter map needs to be hoisted.
const rateLimiters = createRateLimiters(config);

// Passport configuration
app.use(passport.initialize());
app.use(passport.session());

// Passport serialization — keep the session cookie small by storing only the
// minimum needed to identify the user. We have no user store to rehydrate
// from, so the deserialized object is exactly what we serialized.
passport.serializeUser((user, done) => {
  // idToken is kept server-side only (session store), for id_token_hint at logout.
  done(null, { id: user.id, email: user.email, name: user.name, provider: user.provider, idToken: user.idToken });
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

// OIDC Strategy Configuration — uses discovery instead of guessing endpoint
// paths. We fetch ${issuer}/.well-known/openid-configuration at startup and
// hand the discovered URLs to passport-openidconnect, which doesn't do
// discovery on its own. Falls back to error logging (rather than crashing
// boot) so basic auth still works when OIDC is misconfigured.
async function discoverOIDC(issuer) {
  // Trim trailing slash so we don't get a double slash in the URL
  const base = issuer.replace(/\/$/, '');
  const url  = `${base}/.well-known/openid-configuration`;
  const res  = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Discovery failed: ${res.status} ${res.statusText} for ${url}`);
  const doc = await res.json();
  for (const field of ['authorization_endpoint', 'token_endpoint', 'userinfo_endpoint']) {
    if (!doc[field]) throw new Error(`Discovery doc from ${url} is missing ${field}`);
  }
  return doc;
}

async function configureOIDC() {
  if (!(ENABLE_OIDC && OIDC_ISSUER && OIDC_CLIENT_ID && OIDC_CLIENT_SECRET)) return;
  try {
    const doc = await discoverOIDC(OIDC_ISSUER);
    const supportsPKCE = Array.isArray(doc.code_challenge_methods_supported)
      && doc.code_challenge_methods_supported.includes('S256');
    // The strategy compares the ID token's `iss` claim against this value
    // with strict equality, so use the issuer the provider advertises rather
    // than the (possibly trailing-slash-different) configured string.
    const issuer = doc.issuer || OIDC_ISSUER;
    if (doc.issuer && doc.issuer !== OIDC_ISSUER) {
      console.warn(`  OIDC issuer normalised: configured "${OIDC_ISSUER}", provider reports "${doc.issuer}"`);
    }
    passport.use('oidc', new OpenIDConnectStrategy({
      issuer,
      authorizationURL: doc.authorization_endpoint,
      tokenURL:         doc.token_endpoint,
      userInfoURL:      doc.userinfo_endpoint,
      clientID:         OIDC_CLIENT_ID,
      clientSecret:     OIDC_CLIENT_SECRET,
      callbackURL:      OIDC_CALLBACK_URL,
      scope:            OIDC_SCOPE,
      // passport-openidconnect generates a `state` param by default and
      // validates it on callback (the OAuth 2.0 CSRF defense).
      pkce: supportsPKCE
    }, (issuer, profile, context, idToken, accessToken, refreshToken, done) => {
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
    OIDC_END_SESSION_ENDPOINT = doc.end_session_endpoint || null;
    console.log(`✓ OIDC configured via discovery (${issuer})${supportsPKCE ? ' with PKCE' : ''}${OIDC_END_SESSION_ENDPOINT ? ', RP-initiated logout' : ''}`);
  } catch (err) {
    console.error(`⚠ OIDC discovery failed: ${err.message}`);
    console.error('  OIDC login will be unavailable. Basic auth (if enabled) still works.');
  }
}

// Authentication middleware: a no-op unless ENABLE_AUTH is on (basic or OIDC
// session otherwise required).
const requireAuth = createRequireAuth(ENABLE_AUTH);

// Serve static files from the code tree (not the working directory). index:
// false so "/" falls through to app.get('/') below, which sends anonymous
// visitors to /login when auth is on. The other pages, /index.html included,
// are plain static files: their data comes from API routes that need a
// session, and a 401 there sends the browser to /login.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Authentication routes
if (ENABLE_AUTH) {
  // Login page route
  app.get('/login', rateLimiters.generalRateLimiter, (req, res) => {
    if (isAuthenticated(req)) {
      return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  });

  // Login API
  app.post('/api/auth/login', rateLimiters.authRateLimiter, async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required'
      });
    }

    // Always run bcrypt.compare even on a username miss so timing doesn't leak
    // which axis failed (username vs. password).
    const usernameOk = safeEqual(username, AUTH_USERNAME);
    const passwordOk = await bcrypt.compare(password, AUTH_PASSWORD_HASH);

    if (usernameOk && passwordOk) {
      // Rotate the session ID on successful login (session fixation defense)
      req.session.regenerate((err) => {
        if (err) {
          return apiResponse.serverError(res, 'Login failed', err);
        }
        req.session.authenticated = true;
        req.session.username = username;
        res.json({ success: true, message: 'Login successful', redirectTo: '/' });
      });
    } else {
      res.status(401).json({
        success: false,
        error: 'Invalid username or password'
      });
    }
  });

  // Logout API
  app.post('/api/auth/logout', rateLimiters.generalRateLimiter, (req, res) => {
    // For SSO users, also end the session at the provider (RP-initiated
    // logout) so "Login with SSO" doesn't silently sign them straight back in.
    // Work this out before destroying the session, since req.user goes with it.
    let redirectTo = '/login';
    if (req.user && req.user.provider === 'oidc' && OIDC_END_SESSION_ENDPOINT) {
      const postLogoutRedirectUri = new URL('/login', OIDC_CALLBACK_URL).toString();
      redirectTo = buildEndSessionUrl(OIDC_END_SESSION_ENDPOINT, { idToken: req.user.idToken, postLogoutRedirectUri }) || '/login';
    }
    // Destroying the session removes both the basic-auth flags and the
    // passport user in one step. (Calling req.logout() after destroy() used
    // to make passport complain about missing session support.)
    req.session.destroy((err) => {
      if (err) {
        return apiResponse.serverError(res, 'Could not log out', err);
      }
      res.clearCookie('mkcertweb.sid');
      res.json({ success: true, message: 'Logout successful', redirectTo });
    });
  });

  // OIDC Authentication Routes
  if (ENABLE_OIDC && OIDC_ISSUER && OIDC_CLIENT_ID && OIDC_CLIENT_SECRET) {
    // Initiate OIDC login
    app.get('/auth/oidc', rateLimiters.generalRateLimiter,
      passport.authenticate('oidc')
    );

    // OIDC callback
    // Custom callback so the strategy's failure reason (issuer mismatch,
    // bad nonce, expired token, ...) reaches the server log instead of being
    // swallowed by failureRedirect.
    app.get('/auth/oidc/callback', rateLimiters.generalRateLimiter, (req, res, next) => {
      passport.authenticate('oidc', (err, user, info) => {
        if (err || !user) {
          const reason = (err && err.message) || (info && info.message) || 'unknown reason';
          console.error(`⚠ OIDC login failed: ${reason}`);
          return res.redirect('/login?error=oidc_failed');
        }
        req.login(user, (loginErr) => {
          if (loginErr) {
            console.error(`⚠ OIDC session setup failed: ${loginErr.message}`);
            return res.redirect('/login?error=oidc_failed');
          }
          res.redirect('/');
        });
      })(req, res, next);
    });
  }

  // Traditional form-based login route
  app.post('/login', rateLimiters.authRateLimiter, async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.redirect('/login?error=missing_credentials');
    }

    const usernameOk = safeEqual(username, AUTH_USERNAME);
    const passwordOk = await bcrypt.compare(password, AUTH_PASSWORD_HASH);

    if (usernameOk && passwordOk) {
      req.session.regenerate((err) => {
        if (err) return res.redirect('/login?error=session_error');
        req.session.authenticated = true;
        req.session.username = username;
        res.redirect('/');
      });
    } else {
      res.redirect('/login?error=invalid_credentials');
    }
  });

  // Redirect root to login if not authenticated
  app.get('/', rateLimiters.generalRateLimiter, (req, res, next) => {
    // Check both session authentication and OIDC authentication
    if (!isAuthenticated(req)) {
      return res.redirect('/login');
    }
    // Serve the main index.html for authenticated users
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
} else {
  // When authentication is disabled, serve index.html directly
  app.get('/', rateLimiters.generalRateLimiter, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
  
  // Redirect login page to main page when auth is disabled
  app.get('/login', rateLimiters.generalRateLimiter, (req, res) => {
    res.redirect('/');
  });
  
  // Handle POST /login when auth is disabled (redirect to main page)
  app.post('/login', rateLimiters.generalRateLimiter, (req, res) => {
    res.redirect('/');
  });
}

// Initialize services for email notifications and certificate monitoring
const emailService = new EmailService(config);
const ntfyService = new NtfyService(config);
const webhookService = new WebhookService(config);
const monitoringService = new CertificateMonitoringService(config, emailService, ntfyService, webhookService);

// (rateLimiters was created earlier so it could be applied to the login routes)

// Apply CSRF verification to every request reaching the route handlers below.
// Auth/login/OIDC paths are exempted inside verifyCsrf itself.
app.use(verifyCsrf);

// These "always available" endpoints MUST be registered before the mounted
// routers, because createSystemRoutes mounts a `/api/*` catch-all 404 that
// would otherwise shadow them.
app.get('/api/csrf-token', rateLimiters.generalRateLimiter, (req, res) => {
  res.json({ success: true, csrfToken: issueCsrfToken(req) });
});

app.get('/api/auth/status', rateLimiters.generalRateLimiter, (req, res) => {
  if (ENABLE_AUTH) {
    // Covers both basic-auth sessions and OIDC/passport logins (#43).
    const { authenticated, username } = getAuthState(req);
    res.json({ authenticated, username, authEnabled: true });
  } else {
    res.json({ authenticated: false, username: null, authEnabled: false });
  }
});

app.get('/api/auth/methods', rateLimiters.generalRateLimiter, (req, res) => {
  res.json({
    basic: ENABLE_AUTH,
    oidc: { enabled: !!(ENABLE_OIDC && OIDC_ISSUER && OIDC_CLIENT_ID && OIDC_CLIENT_SECRET) }
  });
});

app.get('/api/config/theme', rateLimiters.generalRateLimiter, (req, res) => {
  const defaultTheme = config.theme.mode || 'dark';
  res.json({ defaultTheme: ['dark', 'light'].includes(defaultTheme) ? defaultTheme : 'dark' });
});

// Mount notification routes
app.use(createNotificationRoutes(config, rateLimiters, requireAuth, emailService, monitoringService, ntfyService, webhookService));

// Mount certificate routes
app.use(createCertificateRoutes(config, rateLimiters, requireAuth));

// Mount file routes (upload)
app.use(createFileRoutes(config, rateLimiters, requireAuth));

// Mount SCEP routes (must be before system routes to avoid catch-all)
app.use(createSCEPRoutes(config, rateLimiters, requireAuth));

// Mount settings routes
app.use('/api/settings', createSettingsRoutes(config, rateLimiters, requireAuth));

// Mount system routes
app.use(createSystemRoutes(config, rateLimiters, requireAuth));

// Browsers ask for /favicon.ico before (or without) reading the page's
// <link rel="icon">; the icon lives in public/assets/.
app.get('/favicon.ico', (req, res) => {
  res.redirect(301, '/assets/favicon.ico');
});

// Certificate storage directory, for the startup log. The certificate routes
// resolve process.cwd()/certificates, so log (and create) that same path.
const CERT_DIR = path.join(process.cwd(), 'certificates');
fs.ensureDirSync(CERT_DIR);

// Centralized error-handling middleware. asyncHandler forwards all async
// route errors here so error formatting lives in one place: exposed 4xx
// (bad JSON, oversized body) keep their status with a fixed message;
// everything else is a 500 with a ref, full error in the log.
app.use(errorHandler);

// Auto-generate SSL certificates for HTTPS
async function generateSSLCertificate() {
  const sslDir = path.join(__dirname, 'ssl');
  const certPath = path.join(sslDir, `${SSL_DOMAIN}.pem`);
  const keyPath  = path.join(sslDir, `${SSL_DOMAIN}-key.pem`);

  await fs.ensureDir(sslDir);

  if (await fs.pathExists(certPath) && await fs.pathExists(keyPath)) {
    console.log(`✓ SSL certificates already exist for domain: ${SSL_DOMAIN}`);
    return { certPath, keyPath };
  }

  console.log(`🔐 Generating SSL certificate for domain: ${SSL_DOMAIN}...`);
  await runTool('mkcert', [
    '-cert-file', certPath,
    '-key-file',  keyPath,
    SSL_DOMAIN, '127.0.0.1', '::1'
  ]);
  console.log(`✓ SSL certificate generated successfully`);
  console.log(`   Certificate: ${certPath}`);
  console.log(`   Private Key: ${keyPath}`);
  return { certPath, keyPath };
}

// Start server(s)
async function startServer() {
  try {
    // OIDC discovery happens before we accept any /auth/oidc traffic.
    await configureOIDC();

    // Always start the HTTP server (it redirects once HTTPS is up, with FORCE_HTTPS)
    const httpServer = http.createServer(app);
    // Redirects are announced only once HTTPS is actually listening.
    httpServer.listen(PORT, () => {
      console.log(`🌐 HTTP server running on http://localhost:${PORT}`);
    });
    
    // Start HTTPS server if enabled
    if (ENABLE_HTTPS) {
      try {
        const { certPath, keyPath } = await generateSSLCertificate();
        
        const options = {
          key: await fs.readFile(keyPath),
          cert: await fs.readFile(certPath)
        };
        
        const httpsServer = https.createServer(options, app);
        httpsServer.listen(HTTPS_PORT, () => {
          httpsListening = true;
          console.log(`🔐 HTTPS server running on https://localhost:${HTTPS_PORT}`);
          console.log(`🔑 SSL Domain: ${SSL_DOMAIN}`);
          console.log(`📁 Certificate storage: ${CERT_DIR}`);
          
          if (FORCE_HTTPS) {
            console.log(`🔄 HTTP requests on port ${PORT} now redirect to HTTPS (except /api/health and /scep)`);
            console.log(`\n🌟 Access the application at: https://localhost:${HTTPS_PORT}`);
          } else {
            console.log(`\n🌟 Application available at:`);
            console.log(`   HTTP:  http://localhost:${PORT}`);
            console.log(`   HTTPS: https://localhost:${HTTPS_PORT}`);
          }
        });
        
        httpsServer.on('error', (error) => {
          console.error(`❌ HTTPS server error:`, error);
          process.exit(1);
        });
        
      } catch (sslError) {
        console.error(`❌ Failed to start HTTPS server:`, sslError);
        console.log(`🔄 Falling back to HTTP only...`);
        if (FORCE_HTTPS) {
          console.warn(`⚠ FORCE_HTTPS is set, but HTTPS is not running: plain-HTTP requests are NOT redirected and are served over HTTP.`);
        }
        console.log(`📁 Certificate storage: ${CERT_DIR}`);
      }
    } else {
      console.log(`📁 Certificate storage: ${CERT_DIR}`);
      console.log(`\n🌟 Access the application at: http://localhost:${PORT}`);
      console.log(`   (To enable HTTPS, set ENABLE_HTTPS=true)`);
    }
    
  } catch (error) {
    console.error(`❌ Failed to start server:`, error);
    process.exit(1);
  }
}

startServer();

module.exports = app;
