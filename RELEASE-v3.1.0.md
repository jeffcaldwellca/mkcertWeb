# Release Notes - Version 3.1.0

**Release Date**: October 9, 2025  
**Type**: Feature Release  
**Severity**: Medium

## Overview

Version 3.1.0 introduces a comprehensive web-based settings management system that allows administrators to configure all application options through an intuitive web interface. Settings are persisted to `config/settings.json` and override environment variables, providing a more user-friendly alternative to editing `.env` files.

## ✨ New Features

### 1. Web-Based Settings Management

**Feature**: Complete settings configuration interface accessible via web browser

**Benefits**:
- No need to edit `.env` files or restart server to change most settings
- Organized tabbed interface for different configuration categories
- Real-time validation and feedback
- Settings persist across server restarts

**Capabilities**:
- **Server Configuration**: HTTP/HTTPS ports, SSL domain, force HTTPS, certificate paths
- **Authentication**: Basic auth credentials, session secrets, OIDC SSO integration
- **Rate Limiting**: Configure CLI, API, and auth rate limits
- **Email Notifications**: SMTP configuration, TLS settings, recipient management
- **Certificate Monitoring**: Cron schedules, warning/critical thresholds
- **Theme Customization**: Default theme mode, primary color selection

**New Endpoints**:
- `GET /api/settings` - Retrieve current settings
- `POST /api/settings` - Save settings to file
- `DELETE /api/settings` - Reset to defaults
- `GET /api/settings/running` - View actual running configuration
- `GET /api/settings/export` - Export settings as JSON backup
- `POST /api/settings/import` - Import settings from JSON

**UI Components**:
- `/settings.html` - Settings management interface
- `settings.js` - Frontend JavaScript for form handling
- Responsive tabbed interface with six categories
- Success/error notifications
- Configuration viewer modal

### 2. Settings Override Mechanism

**Configuration Priority** (highest to lowest):
1. `config/settings.json` - Web UI settings (NEW)
2. `.env` file - Environment variables
3. Default values - Hardcoded in `src/config/index.js`

**Technical Implementation**:
- Deep merge function in `src/config/index.js` ensures nested settings override correctly
- Settings loaded at application startup
- Automatic fallback to defaults if settings file missing
- Settings file excluded from version control for security

**Example**:
```javascript
// config/settings.json overrides .env values
{
  "server": {
    "port": 3001,
    "enableHttps": true
  },
  "email": {
    "enabled": true,
    "smtp": {
      "host": "smtp.company.com"
    }
  }
}
```

### 3. Security Features

**Sensitive Data Protection**:
- Passwords and secrets masked when displayed in UI (`********`)
- Masked values not saved unless explicitly changed
- Settings file added to `.gitignore` automatically
- Authentication required for settings access (if auth enabled)
- Rate limiting applied to all settings endpoints

**Protected Fields**:
- `auth.password` - Basic auth password
- `auth.sessionSecret` - Session encryption key
- `oidc.clientSecret` - OIDC application secret
- `email.smtp.auth.pass` - SMTP password

## 📋 Technical Details

### New Files Created

**Frontend**:
1. `public/settings.html` - Settings management page (1,200+ lines)
2. `public/settings.js` - Frontend logic (500+ lines)
3. `SETTINGS.md` - Comprehensive user documentation
4. `SETTINGS_IMPLEMENTATION.md` - Technical implementation details

**Backend**:
1. `src/routes/settings.js` - REST API endpoints (300+ lines)

**Configuration**:
1. `config/` - Directory for `settings.json` storage

### Files Modified

1. **src/config/index.js**
   - Added settings.json loader
   - Implemented `deepMerge()` function for nested object merging
   - Settings now loaded and merged at startup

2. **server.js**
   - Imported settings routes module
   - Mounted settings routes at `/api/settings`

3. **public/index.html**
   - Added Settings link to navigation bar
   - Simplified email/monitoring configuration section
   - Added pointer to Settings page for configuration

4. **public/scep.html**
   - Added Settings link to navigation bar
   - Consistent navigation across all pages

5. **public/styles.css**
   - Added `.alert-info` style for informational messages
   - Theme-compatible alert styling

6. **.gitignore**
   - Added `config/settings.json` to prevent committing sensitive data

### Configuration Structure

Settings organized into six main categories:

```json
{
  "server": {
    "port": 3000,
    "httpsPort": 3443,
    "enableHttps": false,
    "forceHttps": false,
    "sslDomain": "localhost"
  },
  "auth": {
    "enabled": false,
    "username": "admin",
    "password": "...",
    "sessionSecret": "..."
  },
  "oidc": {
    "enabled": false,
    "issuer": "...",
    "clientId": "...",
    "clientSecret": "...",
    "callbackUrl": "...",
    "scope": "openid profile email"
  },
  "rateLimit": {
    "cli": { "window": 900000, "max": 10 },
    "api": { "window": 900000, "max": 100 },
    "auth": { "window": 900000, "max": 5 }
  },
  "email": {
    "enabled": false,
    "smtp": { /* SMTP config */ },
    "from": "...",
    "to": "...",
    "subject": "..."
  },
  "monitoring": {
    "enabled": false,
    "checkInterval": "0 8 * * *",
    "warningDays": 30,
    "criticalDays": 7,
    "includeUploaded": true
  },
  "theme": {
    "mode": "dark",
    "darkMode": true,
    "primaryColor": "#007bff"
  },
  "paths": {
    "certificates": "certificates",
    "uploaded": "certificates/uploaded"
  }
}
```

## 🎯 User Experience Improvements

### Settings Page Features

1. **Tabbed Navigation**: Six organized tabs for different setting categories
2. **Form Validation**: Real-time validation with helpful error messages
3. **Save Feedback**: Success banner and notifications on save
4. **Reset Functionality**: One-click reset to defaults with confirmation
5. **Import/Export**: Backup and restore settings via JSON files
6. **Configuration Viewer**: View actual running configuration in modal
7. **Responsive Design**: Mobile-friendly interface
8. **Theme Integration**: Matches main application theme (dark/light mode)

### Navigation Enhancements

- Settings link added to all pages (Certificate Manager, SCEP Service)
- Consistent navigation bar across entire application
- Active page highlighted in navigation
- Icon-based navigation for better visual recognition

## ✅ Migration Guide

### For Existing Users

**Option 1: Continue Using .env (No Changes Required)**
- Existing `.env` configurations continue to work
- No migration necessary
- Settings page will show current `.env` values

**Option 2: Migrate to Web UI Settings**
1. Start server with existing `.env` file
2. Navigate to Settings page (`/settings.html`)
3. Review pre-populated values (loaded from `.env`)
4. Click "Save Settings" to persist to `config/settings.json`
5. Settings now stored in file and override `.env`

**Option 3: Hybrid Approach**
- Keep non-sensitive defaults in `.env`
- Use web UI for frequently changed settings
- Web UI settings override `.env` values

### For New Deployments

**Recommended Setup**:
1. Use `.env` file for deployment-specific values (ports, paths)
2. Use Settings UI for operational configuration (email, monitoring)
3. Export settings as JSON for backup
4. Version control `.env` but not `config/settings.json`

## 📝 Important Notes

### Restart Requirements

Some settings require server restart to take effect:
- Server ports (HTTP/HTTPS)
- HTTPS enable/disable
- Authentication configuration
- Rate limiting windows
- Certificate monitoring schedule

Other settings (like SMTP configuration) are loaded dynamically by services.

### Backup Recommendations

1. **Export Settings Regularly**: Use export feature to backup configuration
2. **Document Changes**: Keep notes on why settings were changed
3. **Test in Development**: Test critical changes (auth, ports) in dev first
4. **Settings File Backup**: Consider backing up `config/settings.json` separately

### Security Considerations

- Settings file may contain sensitive data (passwords, secrets)
- File automatically added to `.gitignore`
- Consider using environment variables for secrets in production
- Settings page requires authentication (if auth enabled)
- Rate limiting prevents settings endpoint abuse

## 🔧 API Examples

### Get Current Settings
```bash
curl http://localhost:3000/api/settings
```

### Save Settings
```bash
curl -X POST http://localhost:3000/api/settings \
  -H "Content-Type: application/json" \
  -d '{
    "server": {
      "port": 3001
    },
    "email": {
      "enabled": true,
      "smtp": {
        "host": "smtp.company.com"
      }
    }
  }'
```

### View Running Configuration
```bash
curl http://localhost:3000/api/settings/running
```

### Reset to Defaults
```bash
curl -X DELETE http://localhost:3000/api/settings
```

### Export Settings
```bash
curl http://localhost:3000/api/settings/export > backup.json
```

### Import Settings
```bash
curl -X POST http://localhost:3000/api/settings/import \
  -H "Content-Type: application/json" \
  -d @backup.json
```

## 🐛 Bug Fixes

### Certificate Monitoring Service Logging
- **Issue**: Excessive logging of "Found X certificate files to monitor" on every check
- **Fix**: Commented out verbose logging to reduce log noise
- **Impact**: Cleaner logs without losing important monitoring information

### Debug Logging Cleanup
- **Issue**: Debug console.log statements left in certificate routes
- **Fix**: Removed debug logging statements from `src/routes/certificates.js`
- **Impact**: Cleaner production logs

## 📊 Upgrade Path

### From Version 3.0.1 to 3.1.0

1. **Pull latest code**:
   ```bash
   git pull origin main
   ```

2. **Install dependencies** (if any new ones):
   ```bash
   npm install
   ```

3. **Restart server**:
   ```bash
   npm start
   ```

4. **Access Settings page**: Navigate to `/settings.html`

5. **Review configuration**: Verify settings match your requirements

6. **(Optional) Save settings**: Click "Save Settings" to persist to file

### Rollback Procedure

If issues occur:
1. Delete `config/settings.json` to revert to `.env` values
2. Restart server
3. Settings will load from `.env` as before

## 🔮 Future Enhancements

Potential improvements for future versions:
- Live reload without server restart for certain settings
- Settings validation on backend
- Settings change history/audit log
- Bulk import/export of multiple configurations
- Settings templates for common scenarios
- Environment-specific settings (dev, staging, prod)
- WebSocket-based real-time settings updates
