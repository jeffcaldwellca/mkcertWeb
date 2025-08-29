// Load environment variables from .env file
require('dotenv').config();

// Import core dependencies
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const https = require('https');
const http = require('http');
const session = require('express-session');
const passport = require('passport');
const Tokens = require('csrf');

// Import application modules
const config = require('./src/config');
const { createRateLimiters } = require('./src/middleware/rateLimiting');
const { createAuthMiddleware } = require('./src/middleware/auth');
const { createAuthRoutes } = require('./src/routes/auth');
const { createCertificateRoutes } = require('./src/routes/certificates');
const { createFileRoutes } = require('./src/routes/files');
const { createSystemRoutes } = require('./src/routes/system');
const createNotificationRoutes = require('./src/routes/notifications');
const { createEmailService } = require('./src/services/emailService');
const { createCertificateMonitoringService } = require('./src/services/certificateMonitoringService');

// Initialize Express app
const app = express();

// Create rate limiters
const rateLimiters = createRateLimiters(config);

// Create authentication middleware
const { requireAuth } = createAuthMiddleware(config, passport);

// Initialize email service
const emailService = createEmailService(config);

// Initialize certificate monitoring service
const monitoringService = createCertificateMonitoringService(config, emailService);

// Trust proxy if behind reverse proxy
app.set('trust proxy', 1);

// Session configuration
app.use(session({
  secret: config.auth.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.server.enableHttps && config.server.forceHttps,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Passport initialization (for OIDC support)
app.use(passport.initialize());
app.use(passport.session());

// Middleware configuration
app.use(cors({
  origin: config.server.enableHttps ? 
    `https://${config.server.sslDomain}:${config.server.httpsPort}` : 
    `http://${config.server.host}:${config.server.port}`,
  credentials: true
}));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// CSRF Protection
const tokens = new Tokens();
const csrfProtection = (req, res, next) => {
  // Skip CSRF for GET requests and API status endpoints that don't modify state
  if (req.method === 'GET' || req.path === '/api/health' || req.path === '/api/status' || req.path === '/api/csrf-token') {
    return next();
  }

  // Skip CSRF for non-authenticated endpoints when auth is disabled
  if (!config.auth.enabled && (req.path === '/api/auth/status' || req.path === '/api/auth/methods')) {
    return next();
  }

  // Initialize CSRF token in session if it doesn't exist
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = tokens.secretSync();
  }

  // For POST requests, verify the CSRF token
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    const token = (req.body && req.body._csrf) || req.headers['x-csrf-token'] || req.headers['csrf-token'];
    
    if (!token || !tokens.verify(req.session.csrfSecret, token)) {
      return res.status(403).json({
        success: false,
        error: 'Invalid CSRF token',
        code: 'CSRF_INVALID'
      });
    }
  }

  // Add CSRF token to response locals for templates/frontend
  res.locals.csrfToken = tokens.create(req.session.csrfSecret);
  
  // Add CSRF token to response headers for frontend use
  res.setHeader('X-CSRF-Token', res.locals.csrfToken);
  
  next();
};

// Apply CSRF protection
app.use(csrfProtection);

// Apply general rate limiting to all routes
app.use(rateLimiters.generalRateLimiter);

// Static file serving
app.use(express.static('public'));

// CSRF token endpoint for frontend
app.get('/api/csrf-token', (req, res) => {
  // Ensure session has CSRF secret
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = tokens.secretSync();
  }
  
  const token = tokens.create(req.session.csrfSecret);
  res.json({
    success: true,
    csrfToken: token
  });
});

// Mount route modules
app.use('/', createAuthRoutes(config, rateLimiters));
app.use('/', createCertificateRoutes(config, rateLimiters, requireAuth));
app.use('/', createFileRoutes(config, rateLimiters, requireAuth));

// Mount notification routes BEFORE system routes to avoid catch-all
try {
  const notificationRoutes = createNotificationRoutes(config, rateLimiters, requireAuth, emailService, monitoringService);
  app.use('/', notificationRoutes);
  console.log('✅ Notification routes mounted successfully');
} catch (error) {
  console.error('❌ Failed to mount notification routes:', error.message);
  console.error('Error details:', error);
}

// Mount system routes LAST (it has a catch-all for /api/*)
app.use('/', createSystemRoutes(config, rateLimiters, requireAuth));

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  
  // Don't expose internal errors in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(500).json({
    success: false,
    error: isDevelopment ? error.message : 'Internal server error',
    ...(isDevelopment && { stack: error.stack })
  });
});

// 404 handler for all other routes
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.path,
    method: req.method
  });
});

// HTTPS redirect middleware (if HTTPS is enabled and forced)
if (config.server.enableHttps && config.server.forceHttps) {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}

// Server startup function
async function startServer() {
  try {
    console.log('🚀 Starting mkcert Web UI server...');
    console.log(`📁 Working directory: ${process.cwd()}`);
    console.log(`🔐 Authentication: ${config.auth.enabled ? 'Enabled' : 'Disabled'}`);
    
    if (config.oidc.enabled && config.oidc.issuer) {
      console.log(`🔑 OIDC: Enabled (${config.oidc.displayName || config.oidc.issuer})`);
    }

    // Start HTTP server
    const httpServer = http.createServer(app);
    httpServer.listen(config.server.port, config.server.host, () => {
      console.log(`🌐 HTTP Server running at http://${config.server.host}:${config.server.port}`);
    });

    // Start HTTPS server if enabled
    if (config.server.enableHttps) {
      try {
        const fs = require('fs');
        // Use certificates folder for interface SSL certificates
        const certificatesDir = path.join(__dirname, 'certificates');
        const keyPath = path.join(certificatesDir, `${config.server.sslDomain}-key.pem`);
        const certPath = path.join(certificatesDir, `${config.server.sslDomain}.pem`);
        
        // Ensure certificates directory exists
        if (!fs.existsSync(certificatesDir)) {
          fs.mkdirSync(certificatesDir, { recursive: true });
        }
        
        // Check if SSL certificates exist in certificates folder, fallback to root
        let certificatesFound = fs.existsSync(keyPath) && fs.existsSync(certPath);
        
        if (!certificatesFound) {
          // Check for legacy certificates in root directory
          const rootKeyPath = path.join(__dirname, `${config.server.sslDomain}-key.pem`);
          const rootCertPath = path.join(__dirname, `${config.server.sslDomain}.pem`);
          
          if (fs.existsSync(rootKeyPath) && fs.existsSync(rootCertPath)) {
            console.log('📋 Found existing SSL certificates in root directory, moving to certificates folder...');
            fs.copyFileSync(rootKeyPath, keyPath);
            fs.copyFileSync(rootCertPath, certPath);
            // Remove old certificates from root
            fs.unlinkSync(rootKeyPath);
            fs.unlinkSync(rootCertPath);
            certificatesFound = true;
          } else {
            // Auto-generate SSL certificates for the interface
            console.log(`🔧 Auto-generating SSL certificates for ${config.server.sslDomain}...`);
            const security = require('./src/security');
            try {
              await security.executeCommand(
                `mkcert -cert-file "${config.server.sslDomain}.pem" -key-file "${config.server.sslDomain}-key.pem" ${config.server.sslDomain}`,
                { cwd: certificatesDir }
              );
              console.log('✅ SSL certificates generated successfully');
              certificatesFound = true;
            } catch (error) {
              console.log(`⚠️  Could not auto-generate SSL certificates: ${error.message}`);
              console.log('💡 Please generate certificates manually with: mkcert localhost');
            }
          }
        }
        
        // Check if SSL certificates exist
        if (certificatesFound && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
          const httpsOptions = {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
          };
          
          const httpsServer = https.createServer(httpsOptions, app);
          httpsServer.listen(config.server.httpsPort, config.server.host, () => {
            console.log(`🔒 HTTPS Server running at https://${config.server.host}:${config.server.httpsPort}`);
          });
        } else {
          console.log(`⚠️  HTTPS enabled but certificates not found: ${keyPath}, ${certPath}`);
          console.log('💡 Generate certificates with: mkcert localhost');
        }
      } catch (error) {
        console.error('❌ Failed to start HTTPS server:', error.message);
        console.log('🔄 Continuing with HTTP only...');
      }
    }

    // Display configuration summary
    console.log('\n📋 Configuration Summary:');
    console.log(`   • Port: ${config.server.port}`);
    console.log(`   • HTTPS: ${config.server.enableHttps ? 'Enabled' : 'Disabled'}`);
    if (config.server.enableHttps) {
      console.log(`   • HTTPS Port: ${config.server.httpsPort}`);
      console.log(`   • Force HTTPS: ${config.server.forceHttps ? 'Yes' : 'No'}`);
    }
    console.log(`   • Authentication: ${config.auth.enabled ? 'Required' : 'Disabled'}`);
    console.log(`   • Rate Limiting: Enabled`);
    console.log(`   • Theme: ${config.theme.mode}`);
    console.log(`   • Email Notifications: ${config.email.enabled ? 'Enabled' : 'Disabled'}`);
    console.log(`   • Certificate Monitoring: ${config.monitoring.enabled ? 'Enabled' : 'Disabled'}`);
    
    if (config.email.enabled) {
      console.log('\n📧 Email Notification Details:');
      console.log(`   • SMTP Host: ${config.email.smtp.host || 'Not configured'}`);
      console.log(`   • SMTP Port: ${config.email.smtp.port}`);
      console.log(`   • From Address: ${config.email.from}`);
      console.log(`   • Recipients: ${config.email.to ? config.email.to.split(',').length + ' configured' : 'Not configured'}`);
      console.log(`   • Service Status: ${emailService && emailService.isConfigurationValid() ? 'Ready' : 'Needs configuration'}`);
    }
    
    if (config.monitoring.enabled) {
      console.log('\n🔍 Certificate Monitoring Details:');
      console.log(`   • Check Schedule: ${config.monitoring.checkInterval}`);
      console.log(`   • Warning Period: ${config.monitoring.warningDays} days`);
      console.log(`   • Critical Period: ${config.monitoring.criticalDays} days`);
      console.log(`   • Monitor Uploaded: ${config.monitoring.includeUploaded ? 'Yes' : 'No'}`);
      console.log(`   • Service Status: ${monitoringService.getStatus().running ? 'Running' : 'Stopped'}`);
    }
    
    if (config.auth.enabled) {
      console.log('\n🔐 Authentication Details:');
      console.log(`   • Username: [configured]`);
      console.log(`   • OIDC: ${config.oidc.enabled && config.oidc.issuer ? 'Enabled' : 'Disabled'}`);
      if (config.oidc.enabled && config.oidc.issuer) {
        console.log(`   • OIDC Provider: ${config.oidc.displayName || config.oidc.issuer}`);
      }
    }

    console.log('\n✅ Server started successfully!');
    
    if (!config.auth.enabled) {
      console.log(`\n🌍 Open your browser and visit: http://${config.server.host}:${config.server.port}`);
      if (config.server.enableHttps) {
        console.log(`   Or (HTTPS): https://${config.server.host}:${config.server.httpsPort}`);
      }
    } else {
      console.log(`\n🔒 Authentication required. Visit the login page first.`);
      console.log(`   Login credentials: [username from environment] / [password from environment]`);
    }
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  if (monitoringService) {
    monitoringService.stop();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Received SIGTERM, shutting down gracefully...');
  if (monitoringService) {
    monitoringService.stop();
  }
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the server
startServer();

// Export app for testing
module.exports = app;
