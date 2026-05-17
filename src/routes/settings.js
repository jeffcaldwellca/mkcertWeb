const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { apiResponse, asyncHandler } = require('../utils/responses');

const SETTINGS_FILE = path.join(__dirname, '../../config/settings.json');

/**
 * Factory function to create settings routes
 * @param {Object} config - Application configuration
 * @param {Object} rateLimiters - Rate limiting middleware
 * @param {Function} requireAuth - Authentication middleware
 * @returns {express.Router} Express router with settings routes
 */
function createSettingsRoutes(config, rateLimiters, requireAuth) {
  const router = express.Router();

  // SECURITY: settings include credentials, OIDC client secrets, SMTP passwords,
  // webhook URLs, and rate-limit knobs. When auth is disabled application-wide,
  // requireAuth is a no-op AND there is no identity to gate on, so an unauthenticated
  // attacker on the same network could otherwise rewrite credentials, repoint OIDC,
  // or exfiltrate SMTP creds via /export. Refuse the entire settings API in that mode.
  router.use((req, res, next) => {
    if (!config.auth.enabled && !config.oidc.enabled) {
      return apiResponse.forbidden(res, 'Settings API is disabled because authentication is not enabled. Set ENABLE_AUTH=true (or configure OIDC) and restart.');
    }
    return requireAuth(req, res, next);
  });

  // Apply API rate limiter
  router.use(rateLimiters.apiRateLimiter);

  /**
   * Load settings from file or return empty object if file doesn't exist
   */
  async function loadSettings() {
    try {
      const data = await fs.readFile(SETTINGS_FILE, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {}; // File doesn't exist yet
      }
      throw error;
    }
  }

  /**
   * Save settings to file
   */
  async function saveSettings(settings) {
    // Ensure config directory exists
    const configDir = path.dirname(SETTINGS_FILE);
    await fs.mkdir(configDir, { recursive: true });
    
    // Write settings file
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
  }

  /**
   * Sanitize settings before sending to client (remove sensitive data)
   */
  function sanitizeSettings(settings) {
    const sanitized = JSON.parse(JSON.stringify(settings)); // Deep clone
    
    // Remove sensitive fields
    if (sanitized.auth?.password) {
      sanitized.auth.password = ''; // Don't send password to client
    }
    if (sanitized.auth?.sessionSecret) {
      sanitized.auth.sessionSecret = sanitized.auth.sessionSecret ? '********' : '';
    }
    if (sanitized.oidc?.clientSecret) {
      sanitized.oidc.clientSecret = sanitized.oidc.clientSecret ? '********' : '';
    }
    if (sanitized.email?.smtp?.auth?.pass) {
      sanitized.email.smtp.auth.pass = sanitized.email.smtp.auth.pass ? '********' : '';
    }
    
    return sanitized;
  }

  /**
   * Merge user settings with current config, handling nested objects
   */
  function mergeSettings(base, updates) {
    const merged = { ...base };
    
    for (const key in updates) {
      if (updates[key] && typeof updates[key] === 'object' && !Array.isArray(updates[key])) {
        merged[key] = mergeSettings(merged[key] || {}, updates[key]);
      } else {
        merged[key] = updates[key];
      }
    }
    
    return merged;
  }

  /**
   * GET /api/settings
   * Retrieve current settings (shows what's in settings.json, or defaults from config)
   */
  router.get('/', asyncHandler(async (req, res) => {
    try {
      // Load saved settings from file
      const savedSettings = await loadSettings();
      
      // If we have saved settings, use those (merged with config for any missing values)
      // Otherwise return the current config as defaults
      const currentSettings = Object.keys(savedSettings).length > 0 
        ? mergeSettings(config, savedSettings)
        : config;
      
      // Sanitize before sending to client
      const sanitized = sanitizeSettings(currentSettings);
      
      apiResponse.success(res, sanitized, 'Settings retrieved successfully');
    } catch (error) {
      console.error('Error loading settings:', error);
      apiResponse.serverError(res, 'Failed to load settings');
    }
  }));

  /**
   * GET /api/settings/running
   * Get the actual running configuration (what's currently loaded in memory)
   */
  router.get('/running', asyncHandler(async (req, res) => {
    try {
      // Return the actual config object that was loaded at startup
      // This shows what's REALLY running, not what's saved in settings.json
      const sanitized = sanitizeSettings(config);
      
      apiResponse.success(res, sanitized, 'Running configuration retrieved successfully');
    } catch (error) {
      console.error('Error getting running config:', error);
      apiResponse.serverError(res, 'Failed to get running configuration');
    }
  }));

  /**
   * POST /api/settings
   * Save settings to settings.json (overrides .env values)
   */
  router.post('/', asyncHandler(async (req, res) => {
    try {
      const updates = req.body;
      
      // Validate input
      if (!updates || typeof updates !== 'object') {
        return apiResponse.badRequest(res, 'Invalid settings data');
      }
      
      // Load existing saved settings
      const existingSettings = await loadSettings();
      
      // Merge with new updates
      const mergedSettings = mergeSettings(existingSettings, updates);
      
      // Don't save empty or placeholder password values
      if (mergedSettings.auth?.password === '' || mergedSettings.auth?.password === '********') {
        delete mergedSettings.auth.password;
      }
      if (mergedSettings.auth?.sessionSecret === '********') {
        delete mergedSettings.auth.sessionSecret;
      }
      if (mergedSettings.oidc?.clientSecret === '********') {
        delete mergedSettings.oidc.clientSecret;
      }
      if (mergedSettings.email?.smtp?.auth?.pass === '********') {
        delete mergedSettings.email.smtp.auth.pass;
      }
      
      // Save to file
      await saveSettings(mergedSettings);
      
      // Return sanitized settings
      const sanitized = sanitizeSettings(mergedSettings);
      
      apiResponse.success(res, sanitized, 'Settings saved successfully. Restart the server for changes to take effect.');
    } catch (error) {
      console.error('Error saving settings:', error);
      apiResponse.serverError(res, 'Failed to save settings');
    }
  }));

  /**
   * DELETE /api/settings
   * Reset settings to defaults (delete settings.json)
   */
  router.delete('/', asyncHandler(async (req, res) => {
    try {
      // Delete settings file
      try {
        await fs.unlink(SETTINGS_FILE);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
        // File doesn't exist, that's fine
      }
      
      // Return default config (sanitized)
      const sanitized = sanitizeSettings(config);
      
      apiResponse.success(res, sanitized, 'Settings reset to defaults successfully');
    } catch (error) {
      console.error('Error resetting settings:', error);
      apiResponse.serverError(res, 'Failed to reset settings');
    }
  }));

  /**
   * GET /api/settings/export
   * Export current settings as JSON file for backup. Secrets are masked — the
   * exported file is suitable for sharing and for re-import (re-importing the
   * masked placeholders simply leaves the real secrets unchanged, see the POST
   * handler's "don't save placeholder" logic).
   */
  router.get('/export', asyncHandler(async (req, res) => {
    try {
      const savedSettings = await loadSettings();
      const sanitized = sanitizeSettings(savedSettings);

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="mkcert-settings-${Date.now()}.json"`);

      res.send(JSON.stringify(sanitized, null, 2));
    } catch (error) {
      console.error('Error exporting settings:', error);
      apiResponse.serverError(res, 'Failed to export settings');
    }
  }));

  /**
   * POST /api/settings/import
   * Import settings from uploaded JSON file
   */
  router.post('/import', asyncHandler(async (req, res) => {
    try {
      const importedSettings = req.body;
      
      // Validate input
      if (!importedSettings || typeof importedSettings !== 'object') {
        return apiResponse.badRequest(res, 'Invalid settings data');
      }
      
      // Save imported settings
      await saveSettings(importedSettings);
      
      // Return sanitized settings
      const sanitized = sanitizeSettings(importedSettings);
      
      apiResponse.success(res, sanitized, 'Settings imported successfully. Restart the server for changes to take effect.');
    } catch (error) {
      console.error('Error importing settings:', error);
      apiResponse.serverError(res, 'Failed to import settings');
    }
  }));

  return router;
}

module.exports = createSettingsRoutes;
