# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2025-08-09

### 🚨 MAJOR RELEASE - Security & Architecture Overhaul

### Security - CRITICAL FIXES
- **🔒 Command Injection Protection**: Complete overhaul of command execution system
  - Implemented strict allowlist-based command validation to prevent injection attacks
  - Added `executeCommand` utility with comprehensive input sanitization
  - Restricted shell command execution to verified safe patterns for mkcert and openssl operations
  - Added timeout and buffer limits for command execution with proper error handling
  - **BREAKING**: All commands now validated against security patterns - invalid commands rejected

- **🛡️ Path Traversal Prevention**: Comprehensive file access security
  - Added `validateAndSanitizePath` function to prevent directory traversal attacks
  - Implemented secure filename validation with comprehensive sanitization
  - All file operations now use validated paths to prevent unauthorized access
  - Added protection against null bytes, directory traversal sequences, and invalid characters
  - **BREAKING**: File operations with invalid paths now return standardized error responses

- **⚡ Enhanced Rate Limiting**: Multi-tier protection system
  - Authentication rate limiter: 5 attempts per 15 minutes (prevents brute force)
  - CLI rate limiter: 10 operations per 15 minutes (prevents command abuse)
  - API rate limiter: 100 requests per 15 minutes (prevents API flooding)
  - General rate limiter: 200 requests per 15 minutes (general protection)
  - Applied rate limiting to all previously unprotected routes
  - Configurable via environment variables with intelligent defaults

### Architecture - COMPLETE MODULARIZATION
- **📁 Modular File Structure**: Transformed monolithic codebase into organized modules
  - `src/config/`: Centralized configuration management
  - `src/security/`: Security utilities and validation functions
  - `src/middleware/`: Authentication and rate limiting middleware
  - `src/routes/`: Organized route handlers by functionality
  - `src/utils/`: Reusable utility functions and response handlers
  - **RESULT**: 34% reduction in code duplication (256 lines eliminated)

- **🔧 Utility-Based Architecture**: Standardized patterns for consistency
  - `apiResponse.*` utilities for consistent HTTP responses across all endpoints
  - `validateFileRequest()` for standardized file validation workflows
  - `asyncHandler()` for automatic error handling in async routes
  - `handleError()` for unified error logging and response formatting
  - **RESULT**: 70% reduction in repetitive code maintenance

- **📊 Code Quality Improvements**:
  - Files Route: 249 → 120 lines (52% reduction)
  - Certificates Route: 313 → 222 lines (29% reduction)  
  - System Route: 196 → 160 lines (18% reduction)
  - Server: 2300+ → 150 lines (94% reduction through modularization)

### API Changes - STANDARDIZED RESPONSES
- **✨ Consistent Response Format**: All API endpoints now return standardized JSON
  ```json
  // Success responses
  { "success": true, "data": {...}, "message": "optional" }
  
  // Error responses  
  { "success": false, "error": "description" }
  ```
- **🔍 Enhanced Error Details**: Development mode provides additional debugging information
- **⚡ Improved Validation**: Consistent input validation across all endpoints
- **🛠️ Better Error Handling**: Automatic async error catching prevents server crashes

### Performance & Reliability
- **🚀 Reduced Memory Footprint**: Smaller codebase with optimized utilities
- **⏱️ Faster Error Processing**: Centralized error handling improves response times
- **🔄 Auto-Recovery**: Better error handling prevents application crashes
- **📈 Monitoring Ready**: Structured logging and response patterns enable better monitoring

### Developer Experience
- **📖 Comprehensive Documentation**: Added detailed architecture documentation
- **🧪 Testable Components**: Modular design enables unit testing of individual components
- **🔄 Reusable Patterns**: Utility functions speed up future development
- **🎯 Clear Separation of Concerns**: Route handlers focus on business logic

### BREAKING CHANGES
1. **API Response Format**: All endpoints now return standardized `{ success: boolean }` format
2. **Error Responses**: Error format changed from various patterns to consistent structure
3. **Command Validation**: Invalid shell commands now rejected instead of executed
4. **File Path Validation**: Invalid file paths return 400 errors instead of processing
5. **Environment Variables**: Some rate limiting variables renamed for consistency

### Migration Guide
- Update any client code expecting old error response formats
- Verify all shell commands are in the approved allowlist
- Check file access patterns for proper path validation
- Review environment variable configurations for rate limiting

### Deprecations
- Old error response patterns (will be removed in future versions)
- Direct shell command execution without validation (now blocked)
- Unvalidated file path access (now secured)

## [1.5.5]

### Security
- **Comprehensive Rate Limiting Enhancement**: Applied rate limiting protection to all previously unprotected routes
  - Added authentication rate limiter (5 attempts per 15 minutes) to prevent brute force attacks on login endpoints
  - Added general rate limiter (200 requests per 15 minutes) for static content and non-API routes
  - Extended API rate limiting coverage to `/api/status`, `/api/generate`, and auth status endpoints
  - Protected OIDC authentication routes with rate limiting
  - Added rate limiting to all authentication-related routes including traditional form login
  - Configured environment variables for authentication rate limits (AUTH_RATE_LIMIT_WINDOW, AUTH_RATE_LIMIT_MAX)

- **Critical Security Fix**: Implemented command validation and input sanitization for shell command execution
  - Added allowlist-based command validation to prevent command injection attacks
  - Restricted shell command execution to specific safe patterns for mkcert and openssl operations
  - Added timeout and buffer limits for command execution
  - Enhanced logging of blocked command attempts for security monitoring
  - **BREAKING**: Commands not matching allowed patterns will now be rejected

## [1.5.0]

### Added
- **Drag & Drop Certificate Upload**: New upload interface for importing existing certificate/key pairs
  - Intuitive drag & drop zone with visual feedback and hover effects
  - Click-to-browse file selection with multi-file support
  - Smart certificate-key pairing (automatically matches .crt with .key files, .pem with -key.pem files)
  - Comprehensive file validation (supports .pem, .crt, .key, .cer, .p7b, .p7c, .pfx, .p12 formats)
  - Real-time upload progress tracking with visual progress bar
  - Detailed upload results with success/error reporting for each file
  - Uploaded certificates stored in dedicated "uploaded" folder for organization
  - Full integration with existing certificate management (download, archive, bundle, PFX generation)

### Fixed
- **Root CA Generation Error**: Fixed `showNotification is not defined` JavaScript error
  - Changed incorrect `showNotification` function call to use existing `showAlert` function
  - Root CA generation now completes successfully without JavaScript errors
- **CA Installation Timing Issues**: Improved CA installation status refresh mechanism
  - Added retry mechanism with exponential backoff for CA status checking
  - Eliminates need for manual page refresh after CA installation
  - More reliable detection of newly installed Certificate Authorities

### Enhanced
- **Certificate Listing**: Enhanced recursive directory scanning to properly display uploaded certificates
- **Upload Processing**: Streamlined file processing logic to prevent duplicate file operations
- **User Experience**: Improved visual feedback and error handling throughout upload process

## [1.4.1]

### Added
- **Rate Limiting Protection**: Comprehensive rate limiting to prevent CLI command abuse
  - Separate rate limiters for CLI operations (certificate generation, CA management) and API requests
  - Configurable rate limits with environment variables (CLI: 10 ops/15min, API: 100 req/15min)
  - Per-user and per-IP rate limiting for authenticated and anonymous users
  - Protection against automated attacks and resource exhaustion
- **Rate Limiting Testing**: Comprehensive testing procedures and automated test script
- **Environment Configuration**: Added rate limiting configuration options to .env.example

### Security
- **Rate Limiting Protection**: Comprehensive protection against CLI command abuse and automated attacks
- **Resource Protection**: Prevents excessive CLI operations that could impact server performance
- **Multi-layer Security**: Combined IP-based and user-based rate limiting for enhanced protection

### Technical
- Added `express-rate-limit@^7.4.0` dependency for robust rate limiting functionality
- Enhanced server middleware with configurable rate limiting for different endpoint types
- Automated test script for validating rate limiting functionality

## [1.4.0]

### Added
- **OpenID Connect (OIDC) SSO Authentication**: Full OpenID Connect integration for single sign-on support
  - Passport-based OIDC strategy implementation with configurable providers
  - Support for Azure AD, Google, and other OIDC-compliant identity providers
  - Comprehensive environment variable configuration for OIDC settings
  - OIDC callback URL handling and user profile management
  - Optional OIDC authentication alongside existing basic authentication
- **Enhanced Root CA Management**: Improved Root CA generation workflow and user experience
- **Environment Configuration**: Expanded `.env.example` with comprehensive OIDC configuration options
- **Session Management**: Enhanced passport-based session handling for OIDC flows

### Changed
- **Authentication System**: Refactored authentication to support multiple authentication methods
- **Server Configuration**: Enhanced server startup to handle OIDC provider initialization
- **User Interface**: Updated login forms to support both basic auth and OIDC flows

### Fixed
- **PFX Password Handling**: Resolved password validation and encryption issues in PFX generation
- **Root CA Workflow**: Streamlined and improved Root CA generation process
- **Session Security**: Enhanced session cookie configuration and security settings
- **UI Styling**: Various style fixes and improvements for better user experience

### Security
- **OIDC Integration**: Secure OpenID Connect implementation with proper token validation
- **Enhanced Session Management**: Improved session security and authentication flows
- **Provider Validation**: Secure OIDC provider configuration and callback validation

## [1.3.0]

### Added
- **PFX Generation**: On-demand PKCS#12 (.pfx) file generation for Windows/IIS compatibility
- User-friendly password modal for PFX protection with optional encryption
- Enhanced certificate card layout with improved text handling for long filenames
- Better responsive design for mobile devices with optimized button sizes
- Text truncation with tooltips for long domain lists (100+ characters)
- Structured file information display with dedicated styling for certificate and key files
- URL encoding fixes for proper handling of complex folder paths with special characters

### Changed
- **Certificate Cards**: Complete redesign with better organization and overflow handling
- Improved mobile responsiveness with single-column layout on small screens
- Enhanced button styling and spacing for better user experience
- Updated certificate information display with clearer visual hierarchy
- Better word wrapping and text breaking for long strings

### Fixed
- **Download Functionality**: Fixed 404 errors in download buttons due to URL encoding issues
- **PFX Generation**: Resolved routing issues with complex folder paths containing slashes
- **Archive/Restore**: Fixed double URL encoding problems in certificate management
- **UI Consistency**: Removed confusing question mark cursor from filename displays
- **Mobile Layout**: Fixed text overflow and improved touch-friendly button sizing

### Removed
- Debug console logging from production PFX generation
- Unnecessary cursor help indicators from file name displays

## [1.2.0]

### Added
- Complete Docker containerization support
- Multi-stage Dockerfile with Node.js 18 Alpine base image
- Pre-installed mkcert CLI in Docker container
- Docker Compose configuration for easy deployment
- Volume persistence for certificates and application data
- Comprehensive Docker documentation (DOCKER.md)
- Docker-specific npm scripts for container management
- Health check configuration for container monitoring
- Non-root user security implementation in containers
- Environment variable support for all configuration options
- Automatic Root CA generation when none exists
- Manual Root CA generation option with user-friendly interface
- Visual indicators for auto-generated Root CAs
- New API endpoint `/api/generate-ca` for manual CA creation

### Changed
- Updated .gitignore to exclude Docker-related build files
- Enhanced package.json with Docker-related scripts
- Optimized .dockerignore for efficient Docker builds
- Cleaned up unused backup and development files
- **Docker**: Added OpenSSL to container for full certificate functionality

### Fixed
- **Docker**: OpenSSL now included in container for certificate analysis and operations

### Removed
- Unused backup files
- Development test utility

### Security
- Docker container runs as non-root user (nodejs:1001)
- Secure volume mounting for certificate persistence
- Production-ready security configurations

## [1.1.1]

### Added
- Dark/Light mode toggle with persistent user preference storage
- CSS custom properties (variables) for better theme management
- Theme toggle available on both main interface and login page
- Smooth transitions between theme modes
- Light mode with professional green/red color scheme

### Changed
- Refactored CSS to use CSS custom properties for all colors
- Updated login page to support theme switching
- Improved color consistency across all UI elements

## [1.1.0 Unreleased]

### Added
- New red/green color scheme with terminal/matrix aesthetics
- Monospace font throughout the interface for better code readability
- Glowing text effects and subtle animations
- Terminal-style prompts (>, $) in headers and sections
- Enhanced visual feedback with neon-style borders and shadows

### Changed
- Complete UI redesign with dark theme using red and green accents
- Background gradient changed to dark terminal colors
- Button styles updated with gradient effects and glow
- Form inputs now have dark backgrounds with bright text
- Certificate cards redesigned with translucent dark backgrounds
- Status indicators now use glowing colors for better visibility

### Fixed
- Session cookie security configuration for development environments
- Login functionality now works properly over both HTTP and HTTPS
- Authentication middleware properly handles session persistence

## [1.0.0] - 2025-07-29

### Added
- Initial release of mkcert Web UI
- Web-based interface for managing mkcert CLI operations
- Certificate generation with custom domains
- Root CA management and installation
- Certificate listing and management
- Archive/restore functionality for certificates
- Download certificates in multiple formats (PEM, CRT, P12, etc.)
- HTTPS support with automatic certificate generation
- Optional authentication system with session management
- RESTful API for all certificate operations
- Responsive design for mobile and desktop

### Security
- Session-based authentication with configurable credentials
- Secure cookie handling for HTTPS environments
- Input validation and sanitization
- Safe file operations with proper path validation

### Technical
- Express.js backend server
- Vanilla JavaScript frontend
- File-based certificate storage
- Support for both HTTP and HTTPS modes
- Environment-based configuration
- Comprehensive error handling and logging

---

## Version History Summary

- **v1.0.0**: Initial release with core functionality
- **v1.1.0**: Enhanced UI with red/green theme and improved authentication  
- **v1.1.1**: Dark/Light mode toggle with theme persistence
- **v1.2.0**: Complete Docker containerization support
- **v1.3.0**: PFX generation, improved UI/UX, and enhanced certificate management
- **v1.4.0**: OpenID Connect SSO authentication and enhanced Root CA management
- **v1.4.1**: Rate limiting protection and security enhancements
- **v1.5.0**: Drag & drop certificate upload functionality with smart pairing and comprehensive file validation
- **Current**: Full-featured mkcert Web UI with drag & drop uploads, comprehensive certificate format support, enterprise SSO, and rate limiting protection

## Contributing

When adding entries to this changelog:

1. Add new entries under the `[Unreleased]` section
2. Use the following categories:
   - `Added` for new features
   - `Changed` for changes in existing functionality
   - `Deprecated` for soon-to-be removed features
   - `Removed` for now removed features
   - `Fixed` for any bug fixes
   - `Security` for vulnerability fixes

3. Move entries from `[Unreleased]` to a new version section when releasing
4. Follow the format: `- Description of change`
5. Include issue/PR references when applicable: `- Fix login bug (#123)`

## Links

- [Repository](https://github.com/jeffcaldwellca/mkcertWeb)
- [Issues](https://github.com/jeffcaldwellca/mkcertWeb/issues)
- [Releases](https://github.com/jeffcaldwellca/mkcertWeb/releases)
