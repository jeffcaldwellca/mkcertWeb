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

// Import application modules
const config = require('./src/config');
const { createRateLimiters } = require('./src/middleware/rateLimiting');
const { createAuthMiddleware } = require('./src/middleware/auth');
const { createAuthRoutes } = require('./src/routes/auth');
const { createCertificateRoutes } = require('./src/routes/certificates');
const { createFileRoutes } = require('./src/routes/files');
const { createSystemRoutes } = require('./src/routes/system');

// Initialize Express app
const app = express();

// Create rate limiters
const rateLimiters = createRateLimiters(config);

// Create authentication middleware
const { requireAuth } = createAuthMiddleware(config, passport);

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

// Apply general rate limiting to all routes
app.use(rateLimiters.generalRateLimiter);

// Static file serving
app.use(express.static('public'));

// Mount route modules
app.use('/', createAuthRoutes(config, rateLimiters));
app.use('/', createCertificateRoutes(config, rateLimiters, requireAuth));
app.use('/', createFileRoutes(config, rateLimiters, requireAuth));
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
        const keyPath = `${config.server.sslDomain}-key.pem`;
        const certPath = `${config.server.sslDomain}.pem`;
        
        // Check if SSL certificates exist
        if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
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
    
    if (config.auth.enabled) {
      console.log('\n🔐 Authentication Details:');
      console.log(`   • Username: ${config.auth.username}`);
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
      console.log(`   Login credentials: ${config.auth.username} / [password from environment]`);
    }
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Received SIGTERM, shutting down gracefully...');
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
