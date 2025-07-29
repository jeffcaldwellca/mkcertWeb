# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

## [1.1.0]

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
- **Current**: Enhanced UI with red/green theme and improved authentication

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
