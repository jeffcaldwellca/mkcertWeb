// Email, NTFY, webhook, and monitoring routes module
const express = require('express');
const cron = require('node-cron');
const { apiResponse, asyncHandler, publicReason } = require('../utils/responses');

const createNotificationRoutes = (config, rateLimiters, requireAuth, emailService, monitoringService, ntfyService, webhookService) => {
  const router = express.Router();
  const { apiRateLimiter, cliRateLimiter } = rateLimiters;

  // Get email configuration status
  router.get('/api/email/status', requireAuth, apiRateLimiter, asyncHandler(async (req, res) => {
    const status = {
      enabled: config.email.enabled,
      configured: emailService && emailService.isConfigurationValid(),
      smtp: {
        host: config.email.smtp.host,
        port: config.email.smtp.port,
        secure: config.email.smtp.secure,
        user: config.email.smtp.auth.user ? '***configured***' : null
      },
      from: config.email.from,
      to: config.email.to ? config.email.to.split(',').map(email => email.trim()) : null
    };

    apiResponse.success(res, status, 'Email configuration status retrieved');
  }));

  // Test email configuration
  router.post('/api/email/test', requireAuth, cliRateLimiter, asyncHandler(async (req, res) => {
    if (!config.email.enabled) {
      return apiResponse.badRequest(res, 'Email notifications are disabled');
    }

    if (!emailService || !emailService.isConfigurationValid()) {
      return apiResponse.badRequest(res, 'Email service not properly configured');
    }

    try {
      // First verify SMTP connection
      await emailService.verifyConnection();
      
      // Then send test email
      const result = await emailService.sendTestEmail();
      
      apiResponse.success(res, result, 'Test email sent successfully');
    } catch (error) {
      apiResponse.serverError(res, 'Email test failed', error, { reason: publicReason(error) });
    }
  }));

  // Verify SMTP connection only
  router.post('/api/email/verify', requireAuth, cliRateLimiter, asyncHandler(async (req, res) => {
    if (!config.email.enabled) {
      return apiResponse.badRequest(res, 'Email notifications are disabled');
    }

    if (!emailService || !emailService.isConfigurationValid()) {
      return apiResponse.badRequest(res, 'Email service not properly configured');
    }

    try {
      const result = await emailService.verifyConnection();
      apiResponse.success(res, result, 'SMTP connection verified');
    } catch (error) {
      apiResponse.serverError(res, 'SMTP verification failed', error, { reason: publicReason(error) });
    }
  }));

  // Get certificate monitoring status
  router.get('/api/monitoring/status', requireAuth, apiRateLimiter, asyncHandler(async (req, res) => {
    const status = monitoringService.getStatus();
    apiResponse.success(res, status, 'Certificate monitoring status retrieved');
  }));

  // Manually trigger certificate expiry check
  router.post('/api/monitoring/check', requireAuth, cliRateLimiter, asyncHandler(async (req, res) => {
    if (!config.monitoring.enabled) {
      return apiResponse.badRequest(res, 'Certificate monitoring is disabled');
    }

    try {
      await monitoringService.manualCheck();
      apiResponse.success(res, { message: 'Manual certificate check completed' }, 'Certificate check completed');
    } catch (error) {
      apiResponse.serverError(res, 'Certificate check failed', error);
    }
  }));

  // Start/restart certificate monitoring
  router.post('/api/monitoring/start', requireAuth, cliRateLimiter, asyncHandler(async (req, res) => {
    if (!config.monitoring.enabled) {
      return apiResponse.badRequest(res, 'Certificate monitoring is disabled in configuration');
    }

    try {
      monitoringService.start();
      apiResponse.success(res, { message: 'Certificate monitoring started' }, 'Monitoring service started');
    } catch (error) {
      apiResponse.serverError(res, 'Failed to start monitoring', error);
    }
  }));

  // Stop certificate monitoring
  router.post('/api/monitoring/stop', requireAuth, cliRateLimiter, asyncHandler(async (req, res) => {
    try {
      monitoringService.stop();
      apiResponse.success(res, { message: 'Certificate monitoring stopped' }, 'Monitoring service stopped');
    } catch (error) {
      apiResponse.serverError(res, 'Failed to stop monitoring', error);
    }
  }));

  // Get recent expiring certificates without sending email
  router.get('/api/monitoring/expiring', requireAuth, apiRateLimiter, asyncHandler(async (req, res) => {
    try {
      const certificateFiles = await monitoringService.findCertificatesToMonitor();
      const expiringCertificates = await monitoringService.analyzeExpiringCertificates(certificateFiles);
      
      const summary = {
        total: expiringCertificates.length,
        critical: expiringCertificates.filter(cert => cert.priority === 'critical').length,
        warning: expiringCertificates.filter(cert => cert.priority === 'warning').length,
        certificates: expiringCertificates.map(cert => ({
          path: cert.path,
          expiry: cert.expiry,
          daysUntilExpiry: cert.daysUntilExpiry,
          domains: cert.domains,
          priority: cert.priority
        }))
      };

      apiResponse.success(res, summary, 'Expiring certificates retrieved');
    } catch (error) {
      apiResponse.serverError(res, 'Failed to check certificates', error);
    }
  }));

  // Update monitoring configuration (runtime updates)
  router.put('/api/monitoring/config', requireAuth, cliRateLimiter, asyncHandler(async (req, res) => {
    const { warningDays, criticalDays, checkInterval, includeUploaded } = req.body;
    
    const updates = {};
    
    if (warningDays !== undefined) {
      if (typeof warningDays !== 'number' || warningDays < 1 || warningDays > 365) {
        return apiResponse.badRequest(res, 'Warning days must be a number between 1 and 365');
      }
      updates.warningDays = warningDays;
    }
    
    if (criticalDays !== undefined) {
      if (typeof criticalDays !== 'number' || criticalDays < 1 || criticalDays > 365) {
        return apiResponse.badRequest(res, 'Critical days must be a number between 1 and 365');
      }
      updates.criticalDays = criticalDays;
    }
    
    if (checkInterval !== undefined) {
      // Validate the cron expression here so a bad value is rejected before it
      // mutates runtime config or restarts (and kills) the scheduler.
      if (typeof checkInterval !== 'string' || !cron.validate(checkInterval)) {
        return apiResponse.badRequest(res, 'Check interval must be a valid cron expression');
      }
      updates.checkInterval = checkInterval;
    }
    
    if (includeUploaded !== undefined) {
      if (typeof includeUploaded !== 'boolean') {
        return apiResponse.badRequest(res, 'Include uploaded must be a boolean');
      }
      updates.includeUploaded = includeUploaded;
    }

    try {
      // Update runtime configuration
      Object.assign(config.monitoring, updates);
      
      // Update monitoring service
      monitoringService.updateConfiguration({ monitoring: updates });
      
      apiResponse.success(res, { 
        message: 'Monitoring configuration updated',
        updates: updates 
      }, 'Configuration updated successfully');
    } catch (error) {
      apiResponse.serverError(res, 'Failed to update configuration', error);
    }
  }));

  // ── NTFY routes ──────────────────────────────────────────────────────────────

  // Get NTFY configuration status
  router.get('/api/ntfy/status', requireAuth, apiRateLimiter, asyncHandler(async (req, res) => {
    const ntfy = config.ntfy || {};
    const status = {
      enabled: !!ntfy.enabled,
      configured: ntfyService ? ntfyService.isConfigurationValid() : false,
      url: ntfy.url || null,
      topic: ntfy.topic || null,
      priority: ntfy.priority || 'default',
      authMethod: ntfy.token ? 'token' : (ntfy.username ? 'basic' : 'none')
    };
    apiResponse.success(res, status, 'NTFY configuration status retrieved');
  }));

  // Test NTFY configuration
  router.post('/api/ntfy/test', requireAuth, cliRateLimiter, asyncHandler(async (req, res) => {
    if (!config.ntfy || !config.ntfy.enabled) {
      return apiResponse.badRequest(res, 'NTFY notifications are disabled');
    }

    if (!ntfyService || !ntfyService.isConfigurationValid()) {
      return apiResponse.badRequest(res, 'NTFY service not properly configured. Set ntfy.url and ntfy.topic.');
    }

    try {
      const result = await ntfyService.sendTestNotification();
      apiResponse.success(res, result, 'Test NTFY notification sent successfully');
    } catch (error) {
      apiResponse.serverError(res, 'NTFY test failed', error, { reason: publicReason(error) });
    }
  }));

  // ── Webhook routes ────────────────────────────────────────────────────────────

  // Get webhook configuration status
  router.get('/api/webhook/status', requireAuth, apiRateLimiter, asyncHandler(async (req, res) => {
    const wh = config.webhook || {};
    const status = {
      enabled: !!wh.enabled,
      configured: webhookService ? webhookService.isConfigurationValid() : false,
      url: wh.url || null,
      hasCustomHeaders: !!(wh.headers && Object.keys(wh.headers).length > 0)
    };
    apiResponse.success(res, status, 'Webhook configuration status retrieved');
  }));

  // Test webhook configuration
  router.post('/api/webhook/test', requireAuth, cliRateLimiter, asyncHandler(async (req, res) => {
    if (!config.webhook || !config.webhook.enabled) {
      return apiResponse.badRequest(res, 'Webhook notifications are disabled');
    }

    if (!webhookService || !webhookService.isConfigurationValid()) {
      return apiResponse.badRequest(res, 'Webhook service not properly configured. Set webhook.url.');
    }

    try {
      const result = await webhookService.sendTestNotification();
      apiResponse.success(res, result, 'Test webhook notification sent successfully');
    } catch (error) {
      apiResponse.serverError(res, 'Webhook test failed', error, { reason: publicReason(error) });
    }
  }));

  return router;
};

module.exports = createNotificationRoutes;
