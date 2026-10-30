// System and API routes module - Refactored to eliminate code duplication
const express = require('express');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { runTool, executeCommand } = require('../security');
const { apiResponse, asyncHandler, publicReason } = require('../utils/responses');
// Read from package.json rather than npm_package_version: the Docker image
// starts with `node server.js`, so npm never sets that variable.
const { version: APP_VERSION } = require('../../package.json');

const createSystemRoutes = (config, rateLimiters, requireAuth) => {
  const router = express.Router();
  const { generalRateLimiter, apiRateLimiter } = rateLimiters;

  // Health check endpoint
  router.get('/api/health', generalRateLimiter, (req, res) => {
    apiResponse.success(res, {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: APP_VERSION
    });
  });

  // System information endpoint
  router.get('/api/system', requireAuth, generalRateLimiter, asyncHandler(async (req, res) => {
    const systemInfo = {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      uptime: os.uptime(),
      loadavg: os.loadavg(),
      totalmem: os.totalmem(),
      freemem: os.freemem(),
      cpus: os.cpus().length,
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'development'
    };

    apiResponse.success(res, systemInfo);
  }));

  // Configuration endpoint (filtered for client use)
  router.get('/api/config', requireAuth, generalRateLimiter, asyncHandler(async (req, res) => {
    const clientConfig = {
      server: {
        port: config.server.port,
        host: config.server.host
      },
      auth: {
        enabled: config.auth.enabled
      },
      oidc: {
        enabled: config.oidc.enabled,
        issuer: config.oidc.issuer,
        displayName: config.oidc.displayName
      },
      theme: config.theme,
      features: {
        rateLimiting: true,
        fileUpload: true,
        certificateManagement: true
      }
    };

    apiResponse.success(res, clientConfig);
  }));

  // Rate limiting status endpoint
  router.get('/api/rate-limit/status', generalRateLimiter, (req, res) => {
    // This endpoint provides information about rate limiting
    // The actual rate limit headers are set by the middleware
    apiResponse.success(res, {
      rateLimiting: {
        enabled: true,
        limits: {
          general: `${config.rateLimit.general.max} requests per ${config.rateLimit.general.window / 1000} seconds`,
          api: `${config.rateLimit.api.max} requests per ${config.rateLimit.api.window / 1000} seconds`,
          cli: `${config.rateLimit.cli.max} requests per ${config.rateLimit.cli.window / 1000} seconds`,
          auth: `${config.rateLimit.auth.max} requests per ${config.rateLimit.auth.window / 1000} seconds`
        }
      }
    });
  });

  // Server status endpoint
  router.get('/api/status', generalRateLimiter, asyncHandler(async (req, res) => {
    // Check mkcert availability
    let mkcertInstalled = false;
    try {
      await executeCommand('mkcert -help');
      mkcertInstalled = true;
    } catch (error) {
      console.log('mkcert not available:', error.message);
    }

    // Check OpenSSL availability
    let opensslAvailable = false;
    try {
      await executeCommand('openssl version');
      opensslAvailable = true;
    } catch (error) {
      console.log('OpenSSL not available:', error.message);
    }

    // Check CA status
    let caExists = false;

    try {
      const result = await executeCommand('mkcert -CAROOT');
      if (result.stdout && result.stdout.trim()) {
        const caRoot = result.stdout.trim();
        // Check if CA files actually exist
        const fs = require('fs');
        const rootCAPath = path.join(caRoot, 'rootCA.pem');
        const rootCAKeyPath = path.join(caRoot, 'rootCA-key.pem');
        caExists = fs.existsSync(rootCAPath) && fs.existsSync(rootCAKeyPath);
      }
    } catch (error) {
      console.error('Error checking CA status:', error);
    }

    // SECURITY: this route is public (the top bar shows the tool dots before
    // login), so it carries only booleans: no paths, pid, memory or versions.
    const status = {
      server: {
        running: true,
        uptime: process.uptime()
      },
      ca: {
        exists: caExists
      },
      // What the UI reads (shell.js status dots, root-ca.js)
      mkcertInstalled: mkcertInstalled,
      opensslAvailable: opensslAvailable,
      caExists: caExists,
      features: {
        authentication: config.auth.enabled === true,
        oidc: !!(config.oidc.enabled && config.oidc.issuer && config.oidc.clientId),
        rateLimiting: true,
        fileManagement: true,
        certificateManagement: true
      },
      environment: {
        nodeEnv: process.env.NODE_ENV || 'development',
        platform: os.platform(),
        arch: os.arch()
      }
    };

    apiResponse.success(res, status);
  }));

  // CA management endpoints
  // POST /api/install-ca  — runs `mkcert -install` (no destructive effects;
  // adds the root CA to the system trust store if it isn't already).
  router.post('/api/install-ca', requireAuth, rateLimiters.cliRateLimiter, asyncHandler(async (req, res) => {
    try {
      const result = await runTool('mkcert', ['-install']);
      apiResponse.success(res, { output: result.stdout }, 'CA installed successfully');
    } catch (err) {
      apiResponse.serverError(res, 'Failed to install the root CA', err, { reason: publicReason(err) });
    }
  }));

  // POST /api/generate-ca — generates a new root CA via `mkcert -install`
  // (mkcert creates one on first install) and copies it to certificates/ so
  // the UI can offer a download link.
  router.post('/api/generate-ca', requireAuth, rateLimiters.cliRateLimiter, asyncHandler(async (req, res) => {
    try {
      await runTool('mkcert', ['-help']);
    } catch (err) {
      return apiResponse.serverError(res, 'mkcert is not installed or not on PATH', err, { reason: publicReason(err) });
    }

    let caRoot;
    try {
      const result = await runTool('mkcert', ['-CAROOT']);
      caRoot = result.stdout.trim();
    } catch (err) {
      return apiResponse.serverError(res, 'Failed to read mkcert CA root directory', err, { reason: publicReason(err) });
    }

    const caKeyPath  = path.join(caRoot, 'rootCA-key.pem');
    const caCertPath = path.join(caRoot, 'rootCA.pem');
    const publicCertDir  = path.join(process.cwd(), 'certificates');
    const publicCertPath = path.join(publicCertDir, 'mkcert-rootCA.pem');

    // Copy the CA certificate into certificates/ so the UI can offer it for
    // download. Returns whether it's there afterwards — the frontend shows a
    // "copied to public download area" note based on caCopiedToPublic.
    const copyCaToPublic = async ({ overwrite }) => {
      try {
        await fs.ensureDir(publicCertDir);
        if (overwrite || !(await fs.pathExists(publicCertPath))) {
          await fs.copy(caCertPath, publicCertPath);
        }
        return true;
      } catch (e) {
        console.error('Failed to copy Root CA to public area:', e.message);
        return false;
      }
    };

    const alreadyExists = await fs.pathExists(caKeyPath) && await fs.pathExists(caCertPath);
    if (alreadyExists) {
      const caCopiedToPublic = await copyCaToPublic({ overwrite: false });
      return apiResponse.success(res, {
        caRoot, caExists: true, action: 'none', caCopiedToPublic
      }, 'Root CA already exists');
    }

    // `mkcert -install` creates the CA files first, then adds the CA to the
    // system trust store. The second step needs root/sudo, which the Docker
    // image (non-root `nodejs` user) doesn't have, so it exits non-zero even
    // though the CA was created. Treat the trust-store step as best-effort and
    // decide success by whether the CA files exist.
    let installResult = null;
    let installError = null;
    try {
      installResult = await runTool('mkcert', ['-install']);
    } catch (err) {
      installError = err;
    }

    const created = await fs.pathExists(caKeyPath) && await fs.pathExists(caCertPath);
    if (!created) {
      if (installError) {
        return apiResponse.serverError(res, 'Failed to generate the root CA', installError,
          { reason: publicReason(installError) });
      }
      return apiResponse.serverError(res, 'mkcert -install ran but CA files were not created');
    }

    const caCopiedToPublic = await copyCaToPublic({ overwrite: true });

    const trustStoreInstalled = !installError;
    if (!trustStoreInstalled) {
      console.warn('Root CA created, but adding it to the system trust store failed (expected without root, e.g. in Docker):',
        (installError.stderr || installError.error || installError.message || '').trim());
    }
    apiResponse.success(res, {
      caRoot, caExists: true, action: 'generated', trustStoreInstalled, caCopiedToPublic,
      // stdout only: on a trust-store failure stderr (logged above) can hold paths.
      output: installResult ? installResult.stdout : ''
    }, trustStoreInstalled
      ? 'Root CA generated and installed successfully'
      : 'Root CA generated. It was not added to this server\'s system trust store (requires root, e.g. not available in Docker) — download the CA certificate and install it on your client devices.');
  }));

  // POST /api/uninstall-ca — removes the root CA from the system trust store.
  // SECURITY: this is destructive and would break every cert this server has
  // issued. Require explicit confirm:true and only allow it when auth is enabled
  // (so an anonymous LAN attacker can't break trust with a single POST).
  router.post('/api/uninstall-ca', requireAuth, rateLimiters.cliRateLimiter, asyncHandler(async (req, res) => {
    // Only ENABLE_AUTH counts: without it there is no login, even with OIDC configured.
    if (config.auth.enabled !== true) {
      return apiResponse.forbidden(res, 'mkcert -uninstall is destructive and is only available when authentication is enabled (ENABLE_AUTH=true)');
    }
    if (req.body?.confirm !== true) {
      return apiResponse.badRequest(res, 'Pass { "confirm": true } to acknowledge this will remove the local root CA from the system trust store');
    }
    console.warn(`⚠ mkcert -uninstall requested by ${req.session?.username || req.user?.email || 'unknown'} from ${req.ip}`);
    try {
      const result = await runTool('mkcert', ['-uninstall']);
      apiResponse.success(res, { output: result.stdout }, 'CA uninstalled');
    } catch (err) {
      apiResponse.serverError(res, 'Failed to uninstall the root CA', err, { reason: publicReason(err) });
    }
  }));

  // API endpoints discovery. Keys are "METHOD /path"; keep this in step with
  // the routes mounted in server.js (test/api-index.test.js guards it).
  router.get('/api', generalRateLimiter, asyncHandler(async (req, res) => {
    const endpoints = {
      authentication: {
        'GET /api/auth/status': 'Check authentication status',
        'GET /api/auth/methods': 'Get available authentication methods',
        'POST /api/auth/login': 'Log in with username and password (basic auth enabled)',
        'POST /api/auth/logout': 'Log out the current session (basic auth enabled)',
        'GET /api/csrf-token': 'Get a CSRF token for state-changing requests'
      },
      certificates: {
        'GET /api/certificates': 'List all certificates',
        'POST /api/execute': 'Run an mkcert command (generate, caroot, install-ca, uninstall-ca)',
        'POST /api/upload': 'Upload certificate and key files',
        'POST /api/certificates/:folder/:certname/archive': 'Archive a certificate',
        'POST /api/certificates/:folder/:certname/restore': 'Restore an archived certificate (?swap=true|false)',
        'DELETE /api/certificates/:folder/:certname': 'Delete a certificate (?archived=true|false)',
        'PUT /api/certificates/:folder/:certname/notes': 'Save or clear a certificate note',
        'POST /api/generate/pfx/:folder/:certname': 'Generate and download a PFX bundle',
        'GET /api/download/cert/:folder/:filename': 'Download a certificate file',
        'GET /api/download/key/:folder/:filename': 'Download a private key file',
        'GET /api/download/bundle/:folder/:certname': 'Download a certificate and key as a ZIP'
      },
      rootCA: {
        'GET /api/rootca/info': 'Get root CA details',
        'GET /api/download/rootca': 'Download the root CA certificate',
        'POST /api/install-ca': 'Install the root CA in the system trust store',
        'POST /api/generate-ca': 'Generate a root CA',
        'POST /api/uninstall-ca': 'Remove the root CA from the system trust store (auth enabled, confirm required)'
      },
      notifications: {
        'GET /api/email/status': 'Get email configuration status',
        'POST /api/email/test': 'Send a test email',
        'POST /api/email/verify': 'Verify the SMTP connection',
        'GET /api/monitoring/status': 'Get certificate monitoring status',
        'POST /api/monitoring/check': 'Run a certificate expiry check now',
        'POST /api/monitoring/start': 'Start or restart certificate monitoring',
        'POST /api/monitoring/stop': 'Stop certificate monitoring',
        'GET /api/monitoring/expiring': 'List certificates that expire soon',
        'PUT /api/monitoring/config': 'Update monitoring configuration at runtime',
        'GET /api/ntfy/status': 'Get ntfy configuration status',
        'POST /api/ntfy/test': 'Send a test ntfy notification',
        'GET /api/webhook/status': 'Get webhook configuration status',
        'POST /api/webhook/test': 'Send a test webhook'
      },
      scep: {
        'GET /scep': 'SCEP protocol endpoint (GetCACaps, GetCACert)',
        'POST /scep': 'SCEP protocol endpoint (PKIOperation)',
        'POST /api/scep/challenge': 'Generate a challenge password',
        'GET /api/scep/challenges': 'List challenge passwords',
        'POST /api/scep/certificate': 'Issue a certificate through the SCEP workflow',
        'GET /api/scep/certificates': 'List SCEP certificates',
        'GET /api/scep/certificates/:commonName': 'Get SCEP certificate details',
        'GET /api/scep/config': 'Get SCEP configuration',
        'GET /api/scep/enterprise-ca/status': 'Get enterprise CA status',
        'GET /api/scep/templates': 'List certificate templates',
        'POST /api/scep/validate-upn': 'Validate a user principal name'
      },
      settings: {
        'GET /api/settings': 'Get saved settings',
        'GET /api/settings/running': 'Get the running configuration',
        'POST /api/settings': 'Save settings',
        'DELETE /api/settings': 'Reset settings to defaults',
        'GET /api/settings/export': 'Export settings as JSON',
        'POST /api/settings/import': 'Import settings from JSON'
      },
      system: {
        'GET /api': 'This endpoint index',
        'GET /api/health': 'Health check',
        'GET /api/status': 'Server status',
        'GET /api/system': 'System information',
        'GET /api/config': 'Client configuration',
        'GET /api/config/theme': 'Default UI theme',
        'GET /api/rate-limit/status': 'Rate limiting status'
      }
    };

    apiResponse.success(res, {
      name: 'mkcert Web UI API',
      version: APP_VERSION,
      description: 'REST API for mkcert certificate management',
      endpoints: endpoints
    });
  }));

  // Catch-all for undefined API routes
  router.use('/api/*', (req, res) => {
    apiResponse.notFound(res, 'API endpoint not found');
  });

  return router;
};

module.exports = {
  createSystemRoutes
};
