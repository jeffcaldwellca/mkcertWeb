// System and API routes module - Refactored to eliminate code duplication
const express = require('express');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { runTool, executeCommand } = require('../security');
const { apiResponse, handleError, asyncHandler } = require('../utils/responses');

const createSystemRoutes = (config, rateLimiters, requireAuth) => {
  const router = express.Router();
  const { generalRateLimiter, apiRateLimiter } = rateLimiters;

  // Health check endpoint
  router.get('/api/health', generalRateLimiter, (req, res) => {
    apiResponse.success(res, {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0'
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
      workingDirectory: process.cwd(),
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
          general: `${config.rateLimiting.general.max} requests per ${config.rateLimiting.general.windowMs / 1000} seconds`,
          api: `${config.rateLimiting.api.max} requests per ${config.rateLimiting.api.windowMs / 1000} seconds`,
          cli: `${config.rateLimiting.cli.max} requests per ${config.rateLimiting.cli.windowMs / 1000} seconds`,
          auth: `${config.rateLimiting.auth.max} requests per ${config.rateLimiting.auth.windowMs / 1000} seconds`
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
    let caRoot = null;
    
    try {
      const result = await executeCommand('mkcert -CAROOT');
      if (result.stdout && result.stdout.trim()) {
        caRoot = result.stdout.trim();
        // Check if CA files actually exist
        const fs = require('fs');
        const rootCAPath = path.join(caRoot, 'rootCA.pem');
        const rootCAKeyPath = path.join(caRoot, 'rootCA-key.pem');
        caExists = fs.existsSync(rootCAPath) && fs.existsSync(rootCAKeyPath);
      }
    } catch (error) {
      console.error('Error checking CA status:', error);
    }

    const status = {
      server: {
        running: true,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        pid: process.pid,
        version: process.version
      },
      ca: {
        exists: caExists,
        root: caRoot
      },
      // Frontend compatibility properties
      mkcertInstalled: mkcertInstalled,
      opensslAvailable: opensslAvailable,
      caExists: caExists,
      caRoot: caRoot,
      features: {
        authentication: config.auth.enabled,
        oidc: config.oidc.enabled && config.oidc.issuer && config.oidc.clientId,
        rateLimiting: true,
        fileManagement: true,
        certificateManagement: true
      },
      environment: {
        nodeEnv: process.env.NODE_ENV || 'development',
        workingDir: process.cwd(),
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
      apiResponse.serverError(res, err.error || err.message || 'Install failed');
    }
  }));

  // POST /api/generate-ca — generates a new root CA via `mkcert -install`
  // (mkcert creates one on first install) and copies it to certificates/ so
  // the UI can offer a download link.
  router.post('/api/generate-ca', requireAuth, rateLimiters.cliRateLimiter, asyncHandler(async (req, res) => {
    try {
      await runTool('mkcert', ['-help']);
    } catch (_) {
      return apiResponse.serverError(res, 'mkcert is not installed or not on PATH');
    }

    let caRoot;
    try {
      const result = await runTool('mkcert', ['-CAROOT']);
      caRoot = result.stdout.trim();
    } catch (_) {
      return apiResponse.serverError(res, 'Failed to read mkcert CA root directory');
    }

    const caKeyPath  = path.join(caRoot, 'rootCA-key.pem');
    const caCertPath = path.join(caRoot, 'rootCA.pem');
    const publicCertDir  = path.join(process.cwd(), 'certificates');
    const publicCertPath = path.join(publicCertDir, 'mkcert-rootCA.pem');

    const alreadyExists = await fs.pathExists(caKeyPath) && await fs.pathExists(caCertPath);
    if (alreadyExists) {
      try {
        await fs.ensureDir(publicCertDir);
        if (!(await fs.pathExists(publicCertPath))) await fs.copy(caCertPath, publicCertPath);
      } catch (e) {
        console.error('Failed to copy existing Root CA to public area:', e.message);
      }
      return apiResponse.success(res, {
        caRoot, caExists: true, action: 'none', publicCACertPath: publicCertPath
      }, 'Root CA already exists');
    }

    try {
      const installResult = await runTool('mkcert', ['-install']);
      const created = await fs.pathExists(caKeyPath) && await fs.pathExists(caCertPath);
      if (!created) {
        return apiResponse.serverError(res, 'mkcert -install ran but CA files were not created');
      }
      try {
        await fs.ensureDir(publicCertDir);
        await fs.copy(caCertPath, publicCertPath);
      } catch (e) {
        console.error('Failed to copy new Root CA to public area:', e.message);
      }
      apiResponse.success(res, {
        caRoot, caExists: true, action: 'generated',
        output: installResult.stdout, publicCACertPath: publicCertPath
      }, 'Root CA generated and installed successfully');
    } catch (err) {
      const message = err.error || err.message || 'Unknown error';
      const detail  = err.stderr ? err.stderr.trim() : null;
      console.error('Error generating Root CA:', message, detail || '');
      apiResponse.serverError(res, detail ? `${message} — ${detail}` : message);
    }
  }));

  // POST /api/uninstall-ca — removes the root CA from the system trust store.
  // SECURITY: this is destructive and would break every cert this server has
  // issued. Require explicit confirm:true and only allow it when auth is enabled
  // (so an anonymous LAN attacker can't break trust with a single POST).
  router.post('/api/uninstall-ca', requireAuth, rateLimiters.cliRateLimiter, asyncHandler(async (req, res) => {
    if (!config.auth.enabled && !config.oidc.enabled) {
      return apiResponse.forbidden(res, 'mkcert -uninstall is destructive and is only available when authentication is enabled');
    }
    if (req.body?.confirm !== true) {
      return apiResponse.badRequest(res, 'Pass { "confirm": true } to acknowledge this will remove the local root CA from the system trust store');
    }
    console.warn(`⚠ mkcert -uninstall requested by ${req.session?.username || req.user?.email || 'unknown'} from ${req.ip}`);
    try {
      const result = await runTool('mkcert', ['-uninstall']);
      apiResponse.success(res, { output: result.stdout }, 'CA uninstalled');
    } catch (err) {
      apiResponse.serverError(res, err.error || err.message || 'Uninstall failed');
    }
  }));

  // API endpoints discovery
  router.get('/api', generalRateLimiter, asyncHandler(async (req, res) => {
    const endpoints = {
      authentication: {
        '/api/auth/status': 'GET - Check authentication status',
        '/api/auth/methods': 'GET - Get available authentication methods',
        '/api/auth/login': 'POST - Login with credentials',
        '/api/auth/logout': 'POST - Logout current session'
      },
      certificates: {
        '/api/certificates': 'GET - List all certificates',
        '/api/certificate/:filename': 'GET - Get certificate details',
        '/api/certificate/:filename': 'DELETE - Delete certificate',
        '/api/commands': 'GET - Get available mkcert commands',
        '/api/execute': 'POST - Execute mkcert command'
      },
      files: {
        '/api/files': 'GET - List certificate files',
        '/api/file/:filename/content': 'GET - Get file content',
        '/api/upload': 'POST - Upload certificate file',
        '/download/:filename': 'GET - Download certificate file'
      },
      system: {
        '/api/health': 'GET - Health check',
        '/api/status': 'GET - Server status',
        '/api/system': 'GET - System information',
        '/api/config': 'GET - Client configuration',
        '/api/rate-limit/status': 'GET - Rate limiting status'
      }
    };

    apiResponse.success(res, {
      name: 'mkcert Web UI API',
      version: process.env.npm_package_version || '1.0.0',
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
