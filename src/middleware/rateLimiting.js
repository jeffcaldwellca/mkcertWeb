// Rate limiting middleware module
const rateLimit = require('express-rate-limit');

const createRateLimiters = (config) => {
  // CLI rate limiter for certificate operations
  const cliRateLimiter = rateLimit({
    windowMs: config.rateLimit.cli.window,
    max: config.rateLimit.cli.max,
    message: {
      error: 'Too many CLI operations, please try again later.',
      retryAfter: Math.ceil(config.rateLimit.cli.window / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Rate limit by IP address and user (if authenticated)
      const ip = req.ip || req.connection.remoteAddress;
      const user = req.user?.username || req.session?.username || 'anonymous';
      return `cli:${ip}:${user}`;
    }
  });

  // API rate limiter for general API endpoints
  const apiRateLimiter = rateLimit({
    windowMs: config.rateLimit.api.window,
    max: config.rateLimit.api.max,
    message: {
      error: 'Too many API requests, please try again later.',
      retryAfter: Math.ceil(config.rateLimit.api.window / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const ip = req.ip || req.connection.remoteAddress;
      const user = req.user?.username || req.session?.username || 'anonymous';
      return `api:${ip}:${user}`;
    }
  });

  // Authentication rate limiter to prevent brute force attacks
  const authRateLimiter = rateLimit({
    windowMs: config.rateLimit.auth.window,
    max: config.rateLimit.auth.max,
    message: {
      error: 'Too many authentication attempts, please try again later.',
      retryAfter: Math.ceil(config.rateLimit.auth.window / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const ip = req.ip || req.connection.remoteAddress;
      return `auth:${ip}`;
    },
    // Strict rate limiting for auth - applies to all auth attempts from same IP
    skipSuccessfulRequests: false,
    skipFailedRequests: false
  });

  // General rate limiter for static content and non-API routes
  const generalRateLimiter = rateLimit({
    windowMs: config.rateLimit.general.window,
    max: config.rateLimit.general.max,
    message: {
      error: 'Too many requests, please try again later.',
      retryAfter: Math.ceil(config.rateLimit.general.window / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const ip = req.ip || req.connection.remoteAddress;
      return `general:${ip}`;
    }
  });

  return {
    cliRateLimiter,
    apiRateLimiter,
    authRateLimiter,
    generalRateLimiter
  };
};

module.exports = {
  createRateLimiters
};
