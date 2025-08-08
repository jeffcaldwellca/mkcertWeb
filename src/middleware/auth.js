// Authentication middleware module
const passport = require('passport');
const OpenIDConnectStrategy = require('passport-openidconnect');

// Authentication middleware factory
const createAuthMiddleware = (config) => {
  // Configure OIDC strategy if enabled
  if (config.oidc.enabled && config.oidc.issuer && config.oidc.clientId && config.oidc.clientSecret) {
    const callbackUrl = config.oidc.callbackUrl || `http://localhost:${config.server.port}/auth/oidc/callback`;
    
    passport.use('oidc', new OpenIDConnectStrategy({
      issuer: config.oidc.issuer,
      authorizationURL: `${config.oidc.issuer}/auth`,
      tokenURL: `${config.oidc.issuer}/token`,
      userInfoURL: `${config.oidc.issuer}/userinfo`,
      clientID: config.oidc.clientId,
      clientSecret: config.oidc.clientSecret,
      callbackURL: callbackUrl,
      scope: config.oidc.scope
    }, (issuer, profile, done) => {
      // You can customize user profile processing here
      const user = {
        id: profile.id,
        email: profile.emails ? profile.emails[0].value : null,
        name: profile.displayName || profile.username,
        provider: 'oidc'
      };
      return done(null, user);
    }));
  }

  // Authentication middleware
  const requireAuth = (req, res, next) => {
    if (!config.auth.enabled) {
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

  return {
    requireAuth
  };
};

module.exports = {
  createAuthMiddleware
};
