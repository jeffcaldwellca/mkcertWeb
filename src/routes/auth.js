// Authentication routes module
const express = require('express');
const path = require('path');
const passport = require('passport');

const createAuthRoutes = (config, rateLimiters) => {
  const router = express.Router();
  const { authRateLimiter, generalRateLimiter } = rateLimiters;

  if (config.auth.enabled) {
    // Login page route
    router.get('/login', generalRateLimiter, (req, res) => {
      if (req.session && req.session.authenticated) {
        return res.redirect('/');
      }
      res.sendFile(path.join(__dirname, '../../public', 'login.html'));
    });

    // Login API
    router.post('/api/auth/login', authRateLimiter, async (req, res) => {
      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: 'Username and password are required'
        });
      }
      
      // Check credentials
      if (username === config.auth.username && password === config.auth.password) {
        req.session.authenticated = true;
        req.session.username = username;
        res.json({
          success: true,
          message: 'Login successful',
          redirectTo: '/'
        });
      } else {
        res.status(401).json({
          success: false,
          error: 'Invalid username or password'
        });
      }
    });

    // Logout API
    router.post('/api/auth/logout', (req, res) => {
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
    if (config.oidc.enabled && config.oidc.issuer && config.oidc.clientId && config.oidc.clientSecret) {
      // Initiate OIDC login
      router.get('/auth/oidc', authRateLimiter, passport.authenticate('oidc'));

      // OIDC callback
      router.get('/auth/oidc/callback', authRateLimiter,
        passport.authenticate('oidc', { failureRedirect: '/login?error=oidc_failed' }),
        (req, res) => {
          // Successful authentication, redirect to main page
          res.redirect('/');
        }
      );
    }

    // Traditional form-based login route
    router.post('/login', authRateLimiter, async (req, res) => {
      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.redirect('/login?error=missing_credentials');
      }
      
      if (username === config.auth.username && password === config.auth.password) {
        req.session.authenticated = true;
        req.session.username = username;
        res.redirect('/');
      } else {
        res.redirect('/login?error=invalid_credentials');
      }
    });

    // Redirect root to login if not authenticated
    router.get('/', generalRateLimiter, (req, res, next) => {
      // Check both session authentication and OIDC authentication
      if ((!req.session || !req.session.authenticated) && (!req.user || !req.isAuthenticated())) {
        return res.redirect('/login');
      }
      // Serve the main index.html for authenticated users
      res.sendFile(path.join(__dirname, '../../public', 'index.html'));
    });
  } else {
    // When authentication is disabled, serve index.html directly
    router.get('/', generalRateLimiter, (req, res) => {
      res.sendFile(path.join(__dirname, '../../public', 'index.html'));
    });
    
    // Redirect login page to main page when auth is disabled
    router.get('/login', generalRateLimiter, (req, res) => {
      res.redirect('/');
    });
    
    // Handle POST /login when auth is disabled (redirect to main page)
    router.post('/login', authRateLimiter, (req, res) => {
      res.redirect('/');
    });
  }

  // API endpoint to check authentication methods available
  router.get('/api/auth/methods', (req, res) => {
    res.json({
      basic: true,
      oidc: {
        enabled: !!(config.oidc.enabled && config.oidc.issuer && config.oidc.clientId && config.oidc.clientSecret)
      }
    });
  });

  // Auth status endpoint (always available)
  router.get('/api/auth/status', (req, res) => {
    if (config.auth.enabled) {
      res.json({
        authenticated: req.session && req.session.authenticated,
        username: req.session ? req.session.username : null,
        authEnabled: true
      });
    } else {
      res.json({
        authenticated: false,
        username: null,
        authEnabled: false
      });
    }
  });

  return router;
};

module.exports = {
  createAuthRoutes
};
