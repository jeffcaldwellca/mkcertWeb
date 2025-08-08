// System and API routes module - Refactored to eliminate code duplication
const express = require('express');
const os = require('os');
const path = require('path');
const { executeCommand } = require('../security');
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
      // Legacy properties for backward compatibility
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
