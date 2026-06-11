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
const helmet = require('helmet');

// Single safe execution path — execFile, no shell. (executeCommand isn't
// used directly in server.js anymore; the route modules import it themselves.)
const { runTool } = require('./src/security');
const { buildHttpsRedirectUrl } = require('./src/utils/httpsRedirect');
const { apiResponse } = require('./src/utils/responses');

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

// Security headers via helmet. CSP allows the FontAwesome CDN and inline
// styles/scripts the app currently uses; tighten by removing 'unsafe-inline'
// after migrating the frontend off inline handlers.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src':  ["'self'", "'unsafe-inline'"],
      'style-src':   ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      'font-src':    ["'self'", 'https://cdnjs.cloudflare.com', 'data:'],
      'img-src':     ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'frame-ancestors': ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false, // we serve PEM downloads; COEP would block
  referrerPolicy: { policy: 'no-referrer' }
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Trust the first proxy hop if one is in front of us (so req.secure/req.ip work
// correctly and rate-limiting buckets per-client rather than per-proxy).
// Safe default for LAN/reverse-proxy deployments; tighten if you know better.
app.set('trust proxy', 'loopback,linklocal,uniquelocal');

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

// CSRF Protection
const Tokens = require('csrf');
const tokens = new Tokens();

// CSRF verification middleware — applied to every state-changing request that
// has an authenticated session. GET/HEAD/OPTIONS are exempt by definition.
// We skip the login POST (no session yet) and the OIDC callback (state param
// is the OAuth-layer defense). The frontend already sends the token in
// X-CSRF-Token (public/script.js:141).
const CSRF_EXEMPT_PATHS = new Set([
  '/api/auth/login',
  '/login',
  '/api/auth/logout',     // logout is intentionally low-friction; protected by sameSite
  '/auth/oidc',
  '/auth/oidc/callback',
  '/scep'                 // SCEP is a protocol endpoint, not a browser form
]);
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

// Passport configuration
app.use(passport.initialize());
app.use(passport.session());

// Passport serialization — keep the session cookie small by storing only the
// minimum needed to identify the user. We have no user store to rehydrate
// from, so the deserialized object is exactly what we serialized.
passport.serializeUser((user, done) => {
  done(null, { id: user.id, email: user.email, name: user.name, provider: user.provider });
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
    passport.use('oidc', new OpenIDConnectStrategy({
      issuer: OIDC_ISSUER,
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
    }, (issuer, profile, done) => {
      const user = {
        id: profile.id,
        email: profile.emails ? profile.emails[0].value : null,
        name: profile.displayName || profile.username,
        provider: 'oidc'
      };
      return done(null, user);
    }));
    console.log(`✓ OIDC configured via discovery (${OIDC_ISSUER})${supportsPKCE ? ' with PKCE' : ''}`);
  } catch (err) {
    console.error(`⚠ OIDC discovery failed: ${err.message}`);
    console.error('  OIDC login will be unavailable. Basic auth (if enabled) still works.');
  }
}

// Authentication middleware
const requireAuth = (req, res, next) => {
  if (!ENABLE_AUTH) {
    return next(); // Skip authentication if disabled
  }
  
  // Check for basic auth session or OIDC authentication
  if ((req.session && req.session.authenticated) || (req.user && req.isAuthenticated())) {
    return next();
  } else {
    return res.status(401).json({ 
      success: false, 
      error: 'Authentication required',
      redirectTo: '/login'
    });
  }
};

// Serve static files with conditional authentication
app.use(express.static('public', {
  setHeaders: (res, path) => {
    // No special headers needed for static files
  }
}));

// Authentication routes
if (ENABLE_AUTH) {
  // Login page route
  app.get('/login', (req, res) => {
    if (req.session && req.session.authenticated) {
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
          return res.status(500).json({ success: false, error: 'Login failed' });
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
  app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({
          success: false,
          error: 'Could not log out'
        });
      }
      
      // If using OIDC, also logout from passport
      if (req.user) {
        req.logout((logoutErr) => {
          if (logoutErr) {
            console.error('Passport logout error:', logoutErr);
          }
        });
      }
      
      res.json({
        success: true,
        message: 'Logout successful',
        redirectTo: '/login'
      });
    });
  });

  // OIDC Authentication Routes
  if (ENABLE_OIDC && OIDC_ISSUER && OIDC_CLIENT_ID && OIDC_CLIENT_SECRET) {
    // Initiate OIDC login
    app.get('/auth/oidc',
      passport.authenticate('oidc')
    );

    // OIDC callback
    app.get('/auth/oidc/callback',
      passport.authenticate('oidc', { failureRedirect: '/login?error=oidc_failed' }),
      (req, res) => {
        // Successful authentication, redirect to main page
        res.redirect('/');
      }
    );
  }

  // API endpoint to check authentication methods available
  app.get('/api/auth/methods', (req, res) => {
    res.json({
      basic: true,
      oidc: {
        enabled: !!(ENABLE_OIDC && OIDC_ISSUER && OIDC_CLIENT_ID && OIDC_CLIENT_SECRET)
      }
    });
  });

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
  app.get('/', (req, res, next) => {
    // Check both session authentication and OIDC authentication
    if ((!req.session || !req.session.authenticated) && (!req.user || !req.isAuthenticated())) {
      return res.redirect('/login');
    }
    // Serve the main index.html for authenticated users
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
} else {
  // When authentication is disabled, serve index.html directly
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
  
  // Redirect login page to main page when auth is disabled
  app.get('/login', (req, res) => {
    res.redirect('/');
  });
  
  // Handle POST /login when auth is disabled (redirect to main page)
  app.post('/login', (req, res) => {
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
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = tokens.secretSync();
  }
  res.json({ success: true, csrfToken: tokens.create(req.session.csrfSecret) });
});

app.get('/api/auth/status', rateLimiters.generalRateLimiter, (req, res) => {
  if (ENABLE_AUTH) {
    res.json({
      authenticated: !!(req.session && req.session.authenticated),
      username: req.session ? req.session.username : null,
      authEnabled: true
    });
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

// Mount file routes (upload/download)
app.use(createFileRoutes(config, rateLimiters, requireAuth));

// Mount SCEP routes (must be before system routes to avoid catch-all)
app.use(createSCEPRoutes(config, rateLimiters, requireAuth));

// Mount settings routes
app.use('/api/settings', createSettingsRoutes(config, rateLimiters, requireAuth));

// Mount system routes
app.use(createSystemRoutes(config, rateLimiters, requireAuth));

// (csrf-token, auth/status, config/theme moved above the router mounts to
// avoid being shadowed by the /api/* catch-all in createSystemRoutes.)

// Favicon handler (return 204 No Content if not found)
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// Certificate storage directory — kept for boot-time visibility/logging.
// The actual cert routes resolve their own paths under process.cwd()/certificates.
const CERT_DIR = path.join(__dirname, 'certificates');
fs.ensureDirSync(CERT_DIR);

// Centralized error-handling middleware. asyncHandler forwards all async
// route errors here so error formatting lives in one place.
app.use((err, req, res, next) => {
  console.error(err.stack || err);
  if (res.headersSent) {
    return next(err);
  }
  apiResponse.serverError(res, 'Internal server error', err);
});

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

// HTTPS redirect middleware
function redirectToHTTPS(req, res, next) {
  if (FORCE_HTTPS && !req.secure && req.get('x-forwarded-proto') !== 'https') {
    const target = buildHttpsRedirectUrl(req.get('host'), req.url, HTTPS_PORT);
    if (target) {
      return res.redirect(301, target);
    }
    // No Host header to redirect to — fail loudly rather than crash.
    return res.status(400).send('Missing Host header');
  }
  next();
}

// Start server(s)
async function startServer() {
  try {
    // OIDC discovery happens before we accept any /auth/oidc traffic.
    await configureOIDC();

    // Always start HTTP server (for API and optionally for redirects)
    if (ENABLE_HTTPS && FORCE_HTTPS) {
      // Add HTTPS redirect middleware to HTTP server
      app.use(redirectToHTTPS);
    }
    
    const httpServer = http.createServer(app);
    httpServer.listen(PORT, () => {
      if (ENABLE_HTTPS && FORCE_HTTPS) {
        console.log(`🔄 HTTP server running on http://localhost:${PORT} (redirects to HTTPS)`);
      } else {
        console.log(`🌐 HTTP server running on http://localhost:${PORT}`);
      }
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
          console.log(`🔐 HTTPS server running on https://localhost:${HTTPS_PORT}`);
          console.log(`🔑 SSL Domain: ${SSL_DOMAIN}`);
          console.log(`📁 Certificate storage: ${CERT_DIR}`);
          
          if (FORCE_HTTPS) {
            console.log(`\n🌟 Access the application at: https://localhost:${HTTPS_PORT}`);
            console.log(`   (HTTP requests will be redirected to HTTPS)`);
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
