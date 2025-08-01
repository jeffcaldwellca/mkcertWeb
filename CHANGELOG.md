# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2025-08-01

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
- **Current**: Full-featured mkcert Web UI with comprehensive certificate format support and enterprise SSO

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
