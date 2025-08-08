// Configuration module
require('dotenv').config();

module.exports = {
  // Server configuration
  server: {
    port: parseInt(process.env.PORT) || 3000,
    httpsPort: parseInt(process.env.HTTPS_PORT) || 3443,
    host: process.env.HOST || 'localhost',
    enableHttps: process.env.ENABLE_HTTPS === 'true' || process.env.ENABLE_HTTPS === '1',
    sslDomain: process.env.SSL_DOMAIN || 'localhost',
    forceHttps: process.env.FORCE_HTTPS === 'true' || process.env.FORCE_HTTPS === '1'
  },

  // Authentication configuration
  auth: {
    enabled: process.env.ENABLE_AUTH === 'true' || process.env.ENABLE_AUTH === '1',
    username: process.env.AUTH_USERNAME || 'admin',
    password: process.env.AUTH_PASSWORD || 'admin',
    sessionSecret: process.env.SESSION_SECRET || 'mkcert-web-ui-secret-key-change-in-production'
  },

  // OIDC configuration
  oidc: {
    enabled: process.env.ENABLE_OIDC === 'true' || process.env.ENABLE_OIDC === '1',
    issuer: process.env.OIDC_ISSUER,
    clientId: process.env.OIDC_CLIENT_ID,
    clientSecret: process.env.OIDC_CLIENT_SECRET,
    callbackUrl: process.env.OIDC_CALLBACK_URL,
    scope: process.env.OIDC_SCOPE || 'openid profile email'
  },

  // Rate limiting configuration
  rateLimit: {
    cli: {
      window: parseInt(process.env.CLI_RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
      max: parseInt(process.env.CLI_RATE_LIMIT_MAX) || 10 // 10 requests per window
    },
    api: {
      window: parseInt(process.env.API_RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes  
      max: parseInt(process.env.API_RATE_LIMIT_MAX) || 100 // 100 requests per window
    },
    auth: {
      window: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
      max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 5 // 5 login attempts per window
    },
    general: {
      window: 15 * 60 * 1000, // 15 minutes
      max: 200 // 200 requests per window (more lenient for static content)
    }
  },

  // Theme configuration
  theme: {
    mode: process.env.THEME_MODE || 'light',
    primaryColor: process.env.THEME_PRIMARY_COLOR || '#007bff',
    darkMode: process.env.THEME_DARK_MODE === 'true' || process.env.THEME_DARK_MODE === '1'
  }
};
