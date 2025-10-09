# Settings Feature Implementation Summary

## Overview
Implemented a comprehensive settings management system that allows configuration of all mkcert Web UI options through a web interface. Settings are persisted to `config/settings.json` and override `.env` file values.

## Files Created

### Frontend
1. **public/settings.html** - Settings page with tabbed interface for all configuration categories
2. **public/settings.js** - Frontend JavaScript for form handling, API calls, and validation
3. **SETTINGS.md** - Comprehensive documentation for the settings feature

### Backend
1. **src/routes/settings.js** - REST API endpoints for reading/saving settings
   - GET /api/settings - Retrieve current settings
   - POST /api/settings - Save settings
   - DELETE /api/settings - Reset to defaults
   - GET /api/settings/export - Export settings as JSON
   - POST /api/settings/import - Import settings from JSON

### Configuration
1. **config/** - Directory for settings.json storage

## Files Modified

### Configuration System
1. **src/config/index.js**
   - Added settings.json loader
   - Implemented deep merge function
   - Settings.json values override .env values

### Server Integration
2. **server.js**
   - Imported settings routes
   - Mounted settings routes at /api/settings

### Navigation
3. **public/index.html**
   - Added Settings link to navigation
   - Simplified email/monitoring configuration section (moved config to settings page)

4. **public/scep.html**
   - Added Settings link to navigation

### Styling
5. **public/styles.css**
   - Added .alert-info style for informational alerts

### Version Control
6. **.gitignore**
   - Added config/settings.json to prevent committing sensitive data

## Features Implemented

### Settings Categories
1. **Server Configuration**
   - HTTP/HTTPS ports
   - SSL domain
   - HTTPS enable/force options
   - Certificate directory paths

2. **Authentication**
   - Basic auth (username, password, session secret)
   - OIDC SSO (issuer, client ID, client secret, callback URL, scopes)

3. **Rate Limiting**
   - CLI rate limits
   - API rate limits
   - Auth rate limits

4. **Email Notifications**
   - SMTP configuration
   - TLS/SSL settings
   - From/To addresses
   - Email subject customization

5. **Certificate Monitoring**
   - Enable/disable monitoring
   - Cron schedule
   - Warning/critical thresholds
   - Include uploaded certificates option

6. **Theme**
   - Default theme mode
   - Primary color
   - Dark mode preference

### Security Features
- Sensitive fields (passwords, secrets) are masked when retrieved
- Placeholder values (********) are not saved unless explicitly changed
- Authentication required for settings access (if enabled)
- Rate limiting applied to all settings endpoints
- Settings file excluded from version control

### User Experience
- Tabbed interface for organized settings
- Real-time form validation
- Success/error notifications
- Auto-save feedback
- Reset to defaults functionality
- Import/export for backup/restore

## Override Mechanism

Configuration priority (highest to lowest):
1. **config/settings.json** (UI settings)
2. **.env file** (environment variables)
3. **Default values** (hardcoded in src/config/index.js)

The deep merge function ensures that UI settings override .env values at any nesting level.

## Testing Checklist

- [x] Settings page loads correctly
- [x] Tab navigation works
- [x] Form fields populate from current config
- [x] Settings save successfully
- [x] Settings persist after server restart
- [x] Settings override .env values
- [x] Sensitive fields are masked
- [x] Reset to defaults works
- [x] Navigation links work on all pages
- [x] Authentication applies to settings page
- [x] Rate limiting applies to settings endpoints

## Usage Instructions

1. **Access Settings**: Click "Settings" in the navigation menu
2. **Modify Settings**: Edit fields in any tab
3. **Save**: Click "Save Settings" button
4. **Restart**: Restart server for certain changes to take effect
5. **Reset**: Click "Reset to Defaults" to revert all changes

## Notes for Deployment

1. Ensure `config/` directory has write permissions
2. Review settings after deployment
3. Backup `config/settings.json` before major changes
4. Some settings (ports, HTTPS) require server restart
5. Settings file is gitignored - deploy settings separately or use .env

## Future Enhancements

Potential improvements for future versions:
- Live reload without server restart for certain settings
- Settings validation on the backend
- Settings change history/audit log
- Bulk import/export of multiple configurations
- Settings templates for common scenarios
- Environment-specific settings (dev, staging, prod)
