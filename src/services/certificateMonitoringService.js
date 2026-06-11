// Certificate monitoring service module
const cron = require('node-cron');
const { findAllCertificateFiles, getCertificateExpiry, getCertificateDomains } = require('../utils/certificates');

class CertificateMonitoringService {
  constructor(config, emailService, ntfyService, webhookService) {
    this.config = config;
    this.emailService = emailService;
    this.ntfyService = ntfyService || null;
    this.webhookService = webhookService || null;
    this.cronJob = null;
    this.isRunning = false;
    
    if (config.monitoring.enabled) {
      // Don't let a bad cron expression crash server boot; the explicit
      // POST /api/monitoring/start path still surfaces the error to the user.
      try {
        this.start();
      } catch (error) {
        console.error('Failed to auto-start certificate monitoring service:', error.message);
      }
    }
  }

  start() {
    if (this.cronJob) {
      console.log('Certificate monitoring service is already running');
      return;
    }

    const interval = this.config.monitoring.checkInterval;
    console.log(`Starting certificate monitoring service with interval: ${interval}`);

    // Validate up front so an invalid cron expression is a hard error the
    // caller can report, rather than a silently dead scheduler.
    if (!cron.validate(interval)) {
      throw new Error(`Invalid cron expression for checkInterval: ${JSON.stringify(interval)}`);
    }

    this.cronJob = cron.schedule(interval, async () => {
      await this.checkCertificates();
    }, {
      scheduled: true,
      timezone: "UTC"
    });

    this.isRunning = true;
    console.log('Certificate monitoring service started successfully');

    // Run an initial check shortly after startup. unref() so this timer never
    // keeps the process (or a test run) alive on its own.
    this.initialCheckTimer = setTimeout(() => this.checkCertificates(), 5000);
    if (this.initialCheckTimer.unref) this.initialCheckTimer.unref();
  }

  stop() {
    if (this.initialCheckTimer) {
      clearTimeout(this.initialCheckTimer);
      this.initialCheckTimer = null;
    }
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      this.isRunning = false;
      console.log('Certificate monitoring service stopped');
    }
  }

  restart() {
    this.stop();
    if (this.config.monitoring.enabled) {
      this.start();
    }
  }

  async checkCertificates() {
    if (!this.config.monitoring.enabled) {
      console.log('Certificate monitoring is disabled');
      return;
    }

    console.log('Starting certificate expiry check...');
    
    try {
      const certificateFiles = await this.findCertificatesToMonitor();
      const expiringCertificates = await this.analyzeExpiringCertificates(certificateFiles);
      
      if (expiringCertificates.length > 0) {
        console.log(`Found ${expiringCertificates.length} expiring certificates`);

        let notified = false;

        if (this.config.email.enabled && this.emailService) {
          await this.emailService.sendCertificateExpiryAlert(expiringCertificates);
          notified = true;
        }

        if (this.config.ntfy && this.config.ntfy.enabled && this.ntfyService) {
          await this.ntfyService.sendCertificateExpiryAlert(expiringCertificates);
          notified = true;
        }

        if (this.config.webhook && this.config.webhook.enabled && this.webhookService) {
          await this.webhookService.sendCertificateExpiryAlert(expiringCertificates);
          notified = true;
        }

        if (!notified) {
          console.warn('No notification channels enabled - expiring certificates found but not notified');
          this.logExpiringCertificates(expiringCertificates);
        }
      } else {
        console.log('No expiring certificates found');
      }
    } catch (error) {
      console.error('Error during certificate expiry check:', error.message);
    }
  }

  async findCertificatesToMonitor() {
    let certificateFiles = [];
    
    try {
      // Find generated certificates
      const certificatesDir = this.config.paths?.certificates || 'certificates';
      const generatedCerts = await findAllCertificateFiles(certificatesDir);
      certificateFiles = [...generatedCerts];
      
      // Include uploaded certificates if configured
      if (this.config.monitoring.includeUploaded) {
        const uploadedDir = this.config.paths?.uploaded || 'certificates/uploaded';
        const uploadedCerts = await findAllCertificateFiles(uploadedDir);
        certificateFiles = [...certificateFiles, ...uploadedCerts];
      }
      
      //console.log(`Found ${certificateFiles.length} certificate files to monitor`);
      return certificateFiles;
    } catch (error) {
      console.error('Error finding certificates to monitor:', error.message);
      return [];
    }
  }

  async analyzeExpiringCertificates(certificateFiles) {
    const expiringCertificates = [];
    const now = new Date();
    
    for (const certFile of certificateFiles) {
      try {
        // Skip if not a .pem certificate file
        if (!certFile.name.endsWith('.pem') || certFile.name.includes('-key.pem')) {
          continue;
        }
        
        const certPath = certFile.fullPath;
        
        const expiryDate = await getCertificateExpiry(certPath);
        if (!expiryDate) {
          console.warn(`Could not determine expiry date for: ${certPath}`);
          continue;
        }
        
        const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
        
        // Check if certificate is expiring within the warning period
        if (daysUntilExpiry <= this.config.monitoring.warningDays && daysUntilExpiry >= 0) {
          try {
            const domains = await getCertificateDomains(certPath);
            
            expiringCertificates.push({
              path: certPath,
              expiry: expiryDate,
              daysUntilExpiry,
              domains,
              priority: daysUntilExpiry <= this.config.monitoring.criticalDays ? 'critical' : 'warning'
            });
            
            console.log(`Expiring certificate found: ${certPath} (${daysUntilExpiry} days remaining)`);
          } catch (domainError) {
            console.warn(`Could not extract domains from ${certPath}:`, domainError.message);
            
            // Still include certificate even if domain extraction fails
            expiringCertificates.push({
              path: certPath,
              expiry: expiryDate,
              daysUntilExpiry,
              domains: null,
              priority: daysUntilExpiry <= this.config.monitoring.criticalDays ? 'critical' : 'warning'
            });
          }
        }
      } catch (error) {
        console.error(`Error analyzing certificate ${certFile.fullPath || certFile}:`, error.message);
      }
    }
    
    // Sort by days until expiry (most urgent first)
    expiringCertificates.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
    
    return expiringCertificates;
  }

  logExpiringCertificates(certificates) {
    console.log('\n=== EXPIRING CERTIFICATES REPORT ===');
    certificates.forEach(cert => {
      const urgency = cert.priority === 'critical' ? '🚨 CRITICAL' : '⚠️ WARNING';
      console.log(`${urgency} - ${cert.path}`);
      console.log(`  Expires: ${cert.expiry.toLocaleDateString()}`);
      console.log(`  Days remaining: ${cert.daysUntilExpiry}`);
      if (cert.domains) {
        console.log(`  Domains: ${cert.domains.join(', ')}`);
      }
      console.log('');
    });
    console.log('=====================================\n');
  }

  async manualCheck() {
    console.log('Running manual certificate expiry check...');
    return await this.checkCertificates();
  }

  getStatus() {
    return {
      enabled: this.config.monitoring.enabled,
      running: this.isRunning,
      schedule: this.config.monitoring.checkInterval,
      warningDays: this.config.monitoring.warningDays,
      criticalDays: this.config.monitoring.criticalDays,
      includeUploaded: this.config.monitoring.includeUploaded,
      emailEnabled: this.config.email.enabled,
      ntfyEnabled: !!(this.config.ntfy && this.config.ntfy.enabled),
      webhookEnabled: !!(this.config.webhook && this.config.webhook.enabled)
    };
  }

  updateConfiguration(newConfig) {
    const wasRunning = this.isRunning;
    
    // Update configuration
    Object.assign(this.config.monitoring, newConfig.monitoring || {});
    Object.assign(this.config.email, newConfig.email || {});
    
    // Restart if configuration changed and was running
    if (wasRunning) {
      this.restart();
    }
    
    console.log('Certificate monitoring configuration updated');
  }
}

// Factory function following the project pattern
const createCertificateMonitoringService = (config, emailService) => {
  return new CertificateMonitoringService(config, emailService);
};

module.exports = { CertificateMonitoringService, createCertificateMonitoringService };
