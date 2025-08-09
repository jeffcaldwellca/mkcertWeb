# GitHub Copilot Instructions for mkcert Web UI

## Project Overview

This is a secure Node.js/Express web interface for managing SSL certificates using the `mkcert` CLI tool. The project emphasizes **enterprise-grade security** with command injection protection, comprehensive rate limiting, and modular architecture.

## Architecture & Key Patterns

### Modular Factory Pattern
- All major components use factory functions that accept `config` parameter
- Routes: `createCertificateRoutes(config, rateLimiters, requireAuth)`
- Middleware: `createAuthMiddleware(config)`, `createRateLimiters(config)`
- This enables dependency injection and easier testing

### Security-First Command Execution
All CLI operations go through `src/security/index.js`:
```javascript
// NEVER use direct exec() - always use this wrapper
const result = await security.executeCommand('mkcert localhost example.com');
```
- Commands are validated against strict allowlist patterns
- Path traversal protection via `validateAndSanitizePath()`
- 30-second timeout and buffer limits prevent hanging

### Multi-Tier Rate Limiting
Four distinct rate limiters with different purposes:
- `cliRateLimiter`: 10/15min for certificate operations
- `apiRateLimiter`: 100/15min for API endpoints  
- `authRateLimiter`: 5/15min for login attempts
- `generalRateLimiter`: 200/15min for static content

Apply correct limiter based on endpoint type.

### Standardized API Responses
Use `src/utils/responses.js` helpers instead of raw `res.json()`:
```javascript
// ✅ Correct
apiResponse.success(res, { certificates }, 'Certificates retrieved');
apiResponse.badRequest(res, 'Invalid domain format');

// ❌ Avoid
res.json({ success: true, data: certificates });
```

## Development Workflows

### Local Development Setup
```bash
# Install mkcert first (required)
mkcert -install

# Development with auto-reload
npm run dev              # HTTP only
npm run https-dev        # HTTPS enabled

# Production-like testing
npm run https-only       # Force HTTPS redirect
```

### Docker Development
```bash
# Quick containerized testing
docker-compose up -d     # Uses production config
docker-compose logs -f   # Monitor logs

# View rate limiting in action
docker-compose logs | grep "Too many"
```

### Environment Configuration
Config is centralized in `src/config/index.js` with environment variable precedence:
- Development defaults in code
- Override via `.env` file (copy from `.env.example`)
- Container overrides via `docker-compose.yml`

## File Organization Conventions

### Route Structure
- Routes are mounted in `server.js` with middleware dependencies
- Each route module exports factory: `createXxxRoutes(config, rateLimiters, requireAuth)`
- Route handlers use `asyncHandler()` wrapper for error handling

### Security Module Usage
When adding new CLI operations:
1. Add command pattern to `allowedPatterns` in `src/security/index.js`
2. Test against `dangerousPatterns` checks
3. Use `validateAndSanitizePath()` for file operations

### Certificate Directory Structure
```
certificates/
├── uploaded/           # User-uploaded certificates
│   └── archive/       # Soft-deleted certificates
└── [timestamp-folder]/ # Generated certificate folders
    ├── domain.pem
    ├── domain-key.pem
    └── domain.pfx     # Generated on-demand
```

## Key Integration Points

### Authentication Flow
- Basic auth: Session-based with `req.session.authenticated`
- OIDC SSO: Passport.js integration with `req.user` object
- Auth bypass: `config.auth.enabled = false` for development

### Certificate Operations
Core operations via `src/utils/certificates.js`:
- `getCertificateExpiry()` - OpenSSL certificate inspection
- `getCertificateDomains()` - Extract CN and SAN domains  
- `findAllCertificateFiles()` - Recursive certificate discovery

### Error Handling Strategy
- Security violations: Log and return generic error messages
- CLI failures: Return specific mkcert/openssl error output
- Rate limiting: Standard HTTP 429 with retry-after headers
- Development vs production: Detailed errors only in dev mode

## Testing & Debugging

### Manual Testing Commands
```bash
# Test certificate generation
curl -X POST localhost:3000/api/execute \
  -H "Content-Type: application/json" \
  -d '{"command":"generate","input":"test.local"}'

# Test rate limiting (run 11 times quickly)
for i in {1..11}; do curl localhost:3000/api/certificates; done

# Verify security (should fail)
curl -X POST localhost:3000/api/execute \
  -d '{"command":"rm -rf /"}'  # Blocked by security module
```

### Log Analysis Patterns
- Security blocks: `"Security: Blocked unsafe command"`
- Rate limit hits: `"Too many [type] requests"`
- CLI timeouts: `"Command timed out after 30 seconds"`

## Common Gotchas

- Rate limiters use IP+user composite keys - test with different IPs
- HTTPS certificates auto-generated in project root (`.pem` files)
- PFX files generated on-demand, not stored permanently
- Command patterns are case-sensitive in security validation
- Docker containers need volume mounts for certificate persistence

## Adding New Features

1. **New CLI Command**: Update `allowedPatterns` in `src/security/index.js`
2. **New API Endpoint**: Use appropriate rate limiter and `asyncHandler()`
3. **New Configuration**: Add to `src/config/index.js` with env var support
4. **New Authentication Method**: Extend `src/middleware/auth.js` factory pattern

Follow the established factory pattern and security-first approach for consistency.
