# Settings Configuration Guide

## Overview

The Settings page provides a web-based interface for managing all mkcert Web UI configuration options. Settings configured through the UI are stored in `config/settings.json` and take precedence over environment variables defined in `.env`.

## Features

- **Tabbed Interface**: Organized settings by category (Server, Authentication, Rate Limiting, Email, Monitoring, Theme)
- **Persistent Storage**: Settings are saved to `config/settings.json` and persist across server restarts
- **Override Mechanism**: Settings from the UI override `.env` values
- **Security**: Sensitive values (passwords, secrets) are masked when displayed and only saved when explicitly changed
- **Import/Export**: Backup and restore settings via JSON export/import
- **Real-time Validation**: Form validation before saving

## Settings Categories

### Server Configuration
- HTTP and HTTPS ports
- SSL domain and certificate settings
- HTTPS enable/force options
- Certificate storage paths

### Authentication
- **Basic Authentication**: Enable/disable, username, password, session secret
- **OIDC SSO**: OpenID Connect integration for enterprise authentication (Azure AD, Google, Okta, etc.)

### Rate Limiting
- **CLI Rate Limiting**: Protect certificate generation endpoints
- **API Rate Limiting**: General API request limits
- **Auth Rate Limiting**: Login attempt throttling

### Email Notifications
- SMTP server configuration
- TLS/SSL settings
- From/To addresses
- Test email functionality

### Certificate Monitoring
- Automatic certificate expiry checking
- Cron-based scheduling
- Warning and critical thresholds
- Email alert integration

### Theme
- Default theme mode (light/dark)
- Primary color customization

## Usage

### Accessing Settings
1. Navigate to the Settings page via the navigation menu
2. Authentication is required if auth is enabled
3. Click on tabs to view different setting categories

### Saving Settings
1. Modify desired settings in the form
2. Click "Save Settings" button
3. Settings are immediately saved to `config/settings.json`
4. Some settings may require a server restart to take effect

### Resetting to Defaults
1. Click "Reset to Defaults" button
2. Confirm the action
3. All custom settings are deleted, reverting to `.env` or default values

### Import/Export Settings
- **Export**: Use the export endpoint `/api/settings/export` to download current settings as JSON
- **Import**: POST to `/api/settings/import` with JSON data to restore settings

## Technical Details

### Storage Mechanism
- Settings are stored in `config/settings.json`
- File is created automatically on first save
- Nested object structure mirrors the application configuration

### Override Priority
1. **Highest**: Values from `config/settings.json` (UI settings)
2. **Middle**: Environment variables from `.env` file
3. **Lowest**: Default values in `src/config/index.js`

### Configuration Loading
The config loader (`src/config/index.js`) performs a deep merge:
```javascript
finalConfig = deepMerge(envConfig, savedSettings)
```

### API Endpoints
- `GET /api/settings` - Retrieve current settings
- `POST /api/settings` - Save settings
- `DELETE /api/settings` - Reset to defaults
- `GET /api/settings/export` - Export settings as JSON
- `POST /api/settings/import` - Import settings from JSON

### Security Considerations
- Sensitive fields (passwords, secrets) are sanitized before sending to client
- Masked values (`********`) are not saved unless explicitly changed
- Settings file is added to `.gitignore` to prevent committing sensitive data
- Authentication required for settings access (if enabled)
- Rate limiting applied to settings endpoints

## Migration from .env

To migrate existing `.env` configuration to the Settings UI:

1. Start the server with your existing `.env` file
2. Navigate to the Settings page
3. Review the pre-populated values (loaded from `.env`)
4. Make any desired changes
5. Click "Save Settings"
6. Settings are now stored in `config/settings.json` and will override `.env`

## Restart Requirements

The following settings require a server restart to take effect:
- Server ports (HTTP/HTTPS)
- HTTPS enable/disable
- Authentication configuration
- Rate limiting windows
- Certificate monitoring schedule

Other settings (like email SMTP) are loaded dynamically by services and may not require restart.

## Troubleshooting

### Settings Not Saving
- Check console for error messages
- Verify write permissions on `config/` directory
- Check server logs for detailed error information

### Settings Not Taking Effect
- Some settings require server restart
- Check that `config/settings.json` was created
- Verify settings file is valid JSON

### Lost Settings
- Check if `config/settings.json` exists
- Restore from backup using import feature
- Settings file may have been deleted or corrupted

## Best Practices

1. **Backup Settings**: Regularly export settings for backup
2. **Test Changes**: Test critical changes (auth, ports) in development first
3. **Document Custom Values**: Keep notes on why certain settings were changed
4. **Use Environment Variables for Secrets**: Consider keeping sensitive data in `.env` (not committed to git) and using settings UI for non-sensitive configuration
5. **Review After Updates**: Check settings page after updating the application

## Development

### Adding New Settings
1. Add setting to `src/config/index.js` base configuration
2. Add form field to `public/settings.html` in appropriate tab
3. Ensure field name matches nested config path (e.g., `email.smtp.host`)
4. Update this documentation

### Testing Settings
```bash
# Start server
npm run dev

# Test settings endpoint
curl http://localhost:3000/api/settings

# Save test settings
curl -X POST http://localhost:3000/api/settings \
  -H "Content-Type: application/json" \
  -d '{"server":{"port":3001}}'

# Reset settings
curl -X DELETE http://localhost:3000/api/settings
```
