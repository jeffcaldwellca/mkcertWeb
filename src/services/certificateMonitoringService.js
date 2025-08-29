// Certificate monitoring service module
const cron = require('node-cron');
const { findAllCertificateFiles, getCertificateExpiry, getCertificateDomains } = require('../utils/certificates');

class CertificateMonitoringService {
  constructor(config, emailService) {
    this.config = config;
    this.emailService = emailService;
    this.cronJob = null;
    this.isRunning = false;
    
    if (config.monitoring.enabled) {
      this.start();
    }
  }

  start() {
    if (this.cronJob) {
      console.log('Certificate monitoring service is already running');
      return;
    }

    try {
      console.log(`Starting certificate monitoring service with interval: ${this.config.monitoring.checkInterval}`);
      
      this.cronJob = cron.schedule(this.config.monitoring.checkInterval, async () => {
        await this.checkCertificates();
      }, {
        scheduled: true,
        timezone: "UTC"
      });

      this.isRunning = true;
      console.log('Certificate monitoring service started successfully');
      
      // Run an initial check
      setTimeout(() => this.checkCertificates(), 5000); // 5 second delay
    } catch (error) {
      console.error('Failed to start certificate monitoring service:', error.message);
    }
  }

  stop() {
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
        
        if (this.config.email.enabled && this.emailService) {
          await this.emailService.sendCertificateExpiryAlert(expiringCertificates);
        } else {
          console.warn('Email notifications disabled - expiring certificates found but not notified');
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
      const generatedCerts = await findAllCertificateFiles();
      certificateFiles = [...generatedCerts];
      
      // Include uploaded certificates if configured
      if (this.config.monitoring.includeUploaded) {
        const uploadedCerts = await findAllCertificateFiles('certificates/uploaded');
        certificateFiles = [...certificateFiles, ...uploadedCerts];
      }
      
      console.log(`Found ${certificateFiles.length} certificate files to monitor`);
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
        if (!certFile.endsWith('.pem') || certFile.includes('-key.pem')) {
          continue;
        }
        
        const expiryDate = await getCertificateExpiry(certFile);
        if (!expiryDate) {
          console.warn(`Could not determine expiry date for: ${certFile}`);
          continue;
        }
        
        const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
        
        // Check if certificate is expiring within the warning period
        if (daysUntilExpiry <= this.config.monitoring.warningDays && daysUntilExpiry >= 0) {
          try {
            const domains = await getCertificateDomains(certFile);
            
            expiringCertificates.push({
              path: certFile,
              expiry: expiryDate,
              daysUntilExpiry,
              domains,
              priority: daysUntilExpiry <= this.config.monitoring.criticalDays ? 'critical' : 'warning'
            });
            
            console.log(`Expiring certificate found: ${certFile} (${daysUntilExpiry} days remaining)`);
          } catch (domainError) {
            console.warn(`Could not extract domains from ${certFile}:`, domainError.message);
            
            // Still include certificate even if domain extraction fails
            expiringCertificates.push({
              path: certFile,
              expiry: expiryDate,
              daysUntilExpiry,
              domains: null,
              priority: daysUntilExpiry <= this.config.monitoring.criticalDays ? 'critical' : 'warning'
            });
          }
        }
      } catch (error) {
        console.error(`Error analyzing certificate ${certFile}:`, error.message);
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
      emailEnabled: this.config.email.enabled
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
