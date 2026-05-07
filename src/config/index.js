// Configuration module
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Load settings from settings.json if it exists
const SETTINGS_FILE = path.join(__dirname, '../../config/settings.json');
let savedSettings = {};

try {
  if (fs.existsSync(SETTINGS_FILE)) {
    const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
    savedSettings = JSON.parse(settingsData);
    console.log('✓ Loaded settings from settings.json');
    console.log('  Settings override:', Object.keys(savedSettings).join(', '));
  } else {
    console.log('ℹ No settings.json found, using .env and defaults');
  }
} catch (error) {
  console.warn('⚠ Warning: Could not load settings.json:', error.message);
}

/**
 * Deep merge two objects, with source overriding target
 */
function deepMerge(target, source) {
  const result = { ...target };
  
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  
  return result;
}

/**
 * Build a sparse config object containing ONLY env vars that are explicitly set
 * (i.e. process.env.X !== undefined). This is applied last so that env vars in
 * docker-compose / the host environment always win over saved settings.json values.
 */
function buildExplicitEnvOverrides() {
  const e = process.env;

  // Helper: return transformed value only when the env var is actually present
  const str  = (v)        => v !== undefined ? v : undefined;
  const bool = (v)        => v !== undefined ? (v === 'true' || v === '1') : undefined;
  const num  = (v, fb)    => v !== undefined ? (parseInt(v) || fb) : undefined;
  const inv  = (v, fb)    => v !== undefined ? (v !== 'false') : undefined; // inverse-bool (SMTP_TLS_REJECT_UNAUTHORIZED)

  // Remove keys whose value is undefined, recursively
  function clean(obj) {
    const out = {};
    for (const k of Object.keys(obj)) {
      if (obj[k] !== null && typeof obj[k] === 'object' && !Array.isArray(obj[k])) {
        const sub = clean(obj[k]);
        if (Object.keys(sub).length > 0) out[k] = sub;
      } else if (obj[k] !== undefined) {
        out[k] = obj[k];
      }
    }
    return out;
  }

  return clean({
    server: {
      port:        num(e.PORT, 3000),
      httpsPort:   num(e.HTTPS_PORT, 3443),
      host:        str(e.HOST),
      enableHttps: bool(e.ENABLE_HTTPS),
      sslDomain:   str(e.SSL_DOMAIN),
      forceHttps:  bool(e.FORCE_HTTPS)
    },
    auth: {
      enabled:       bool(e.ENABLE_AUTH),
      username:      str(e.AUTH_USERNAME),
      password:      str(e.AUTH_PASSWORD),
      sessionSecret: str(e.SESSION_SECRET)
    },
    oidc: {
      enabled:      bool(e.ENABLE_OIDC),
      issuer:       str(e.OIDC_ISSUER),
      clientId:     str(e.OIDC_CLIENT_ID),
      clientSecret: str(e.OIDC_CLIENT_SECRET),
      callbackUrl:  str(e.OIDC_CALLBACK_URL),
      scope:        str(e.OIDC_SCOPE)
    },
    rateLimit: {
      cli:  { window: num(e.CLI_RATE_LIMIT_WINDOW),  max: num(e.CLI_RATE_LIMIT_MAX) },
      api:  { window: num(e.API_RATE_LIMIT_WINDOW),  max: num(e.API_RATE_LIMIT_MAX) },
      auth: { window: num(e.AUTH_RATE_LIMIT_WINDOW), max: num(e.AUTH_RATE_LIMIT_MAX) }
    },
    theme: {
      mode:         str(e.THEME_MODE),
      primaryColor: str(e.THEME_PRIMARY_COLOR),
      darkMode:     bool(e.THEME_DARK_MODE)
    },
    email: {
      enabled:  bool(e.EMAIL_NOTIFICATIONS_ENABLED),
      smtp: {
        host:   str(e.SMTP_HOST),
        port:   num(e.SMTP_PORT, 587),
        secure: bool(e.SMTP_SECURE),
        auth: {
          user: str(e.SMTP_USER),
          pass: str(e.SMTP_PASSWORD)
        },
        tls: {
          rejectUnauthorized: inv(e.SMTP_TLS_REJECT_UNAUTHORIZED)
        }
      },
      from:    str(e.EMAIL_FROM),
      to:      str(e.EMAIL_TO),
      subject: str(e.EMAIL_SUBJECT)
    },
    ntfy: {
      enabled:  bool(e.NTFY_ENABLED),
      url:      str(e.NTFY_URL),
      topic:    str(e.NTFY_TOPIC),
      token:    str(e.NTFY_TOKEN),
      username: str(e.NTFY_USERNAME),
      password: str(e.NTFY_PASSWORD),
      priority: str(e.NTFY_PRIORITY)
    },
    webhook: {
      enabled: bool(e.WEBHOOK_ENABLED),
      url:     str(e.WEBHOOK_URL)
    },
    monitoring: {
      enabled:        bool(e.CERT_MONITORING_ENABLED),
      checkInterval:  str(e.CERT_CHECK_INTERVAL),
      warningDays:    num(e.CERT_WARNING_DAYS),
      criticalDays:   num(e.CERT_CRITICAL_DAYS),
      includeUploaded: e.CERT_MONITOR_UPLOADED !== undefined ? (e.CERT_MONITOR_UPLOADED !== 'false') : undefined
    },
    paths: {
      certificates: str(e.CERTIFICATES_DIR),
      uploaded:     str(e.UPLOADED_CERTS_DIR)
    }
  });
}

// Base configuration from environment variables
const baseConfig = {
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
  },

  // Email notification configuration
  email: {
    enabled: process.env.EMAIL_NOTIFICATIONS_ENABLED === 'true' || process.env.EMAIL_NOTIFICATIONS_ENABLED === '1',
    smtp: {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      },
      tls: {
        rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false' // Default to true for security
      }
    },
    from: process.env.EMAIL_FROM || 'mkcert-web-ui@localhost',
    to: process.env.EMAIL_TO, // Comma-separated list of recipients
    subject: process.env.EMAIL_SUBJECT || 'Certificate Expiry Alert - mkcert Web UI'
  },

  // NTFY push notification configuration
  ntfy: {
    enabled: process.env.NTFY_ENABLED === 'true' || process.env.NTFY_ENABLED === '1',
    url: process.env.NTFY_URL || 'https://ntfy.sh',
    topic: process.env.NTFY_TOPIC,
    token: process.env.NTFY_TOKEN,
    username: process.env.NTFY_USERNAME,
    password: process.env.NTFY_PASSWORD,
    priority: process.env.NTFY_PRIORITY || 'default'
  },

  // Generic HTTP webhook notification configuration
  webhook: {
    enabled: process.env.WEBHOOK_ENABLED === 'true' || process.env.WEBHOOK_ENABLED === '1',
    url: process.env.WEBHOOK_URL,
    headers: {} // Custom request headers (configure via settings.json)
  },

  // Certificate monitoring configuration
  monitoring: {
    enabled: process.env.CERT_MONITORING_ENABLED === 'true' || process.env.CERT_MONITORING_ENABLED === '1',
    checkInterval: process.env.CERT_CHECK_INTERVAL || '0 8 * * *', // Daily at 8 AM (cron format)
    warningDays: parseInt(process.env.CERT_WARNING_DAYS) || 30, // Warn 30 days before expiry
    criticalDays: parseInt(process.env.CERT_CRITICAL_DAYS) || 7, // Critical warning 7 days before expiry
    includeUploaded: process.env.CERT_MONITOR_UPLOADED !== 'false' // Monitor uploaded certificates by default
  },

  // Paths configuration
  paths: {
    certificates: process.env.CERTIFICATES_DIR || 'certificates',
    uploaded: process.env.UPLOADED_CERTS_DIR || 'certificates/uploaded'
  }
};

// Merge order (lowest → highest priority):
//   1. baseConfig   — env var values or hardcoded defaults
//   2. savedSettings — settings.json (UI-saved config, persisted across restarts)
//   3. envOverrides — env vars that are *explicitly* set win over everything,
//                     so docker-compose / host env vars are never silently ignored
const withSettings = deepMerge(baseConfig, savedSettings);
const envOverrides = buildExplicitEnvOverrides();
const finalConfig  = deepMerge(withSettings, envOverrides);

// Log sample of final configuration for verification
if (Object.keys(savedSettings).length > 0) {
  console.log('  Applied settings - Example: theme.primaryColor =', finalConfig.theme?.primaryColor);
}
if (Object.keys(envOverrides).length > 0) {
  console.log('  Env overrides applied:', Object.keys(envOverrides).join(', '));
}

module.exports = finalConfig;
