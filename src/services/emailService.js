// Email notification service module
const nodemailer = require('nodemailer');

class EmailService {
  constructor(config) {
    this.config = config;
    this.transporter = null;
    
    if (config.email.enabled && this.isConfigurationValid()) {
      this.initializeTransporter();
    }
  }

  isConfigurationValid() {
    const smtp = this.config.email.smtp;
    return smtp.host && smtp.auth.user && smtp.auth.pass && this.config.email.to;
  }

  initializeTransporter() {
    try {
      this.transporter = nodemailer.createTransporter({
        host: this.config.email.smtp.host,
        port: this.config.email.smtp.port,
        secure: this.config.email.smtp.secure,
        auth: {
          user: this.config.email.smtp.auth.user,
          pass: this.config.email.smtp.auth.pass
        },
        tls: this.config.email.smtp.tls
      });

      console.log('Email service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize email service:', error.message);
      this.transporter = null;
    }
  }

  async verifyConnection() {
    if (!this.transporter) {
      throw new Error('Email service not initialized. Check SMTP configuration.');
    }

    try {
      await this.transporter.verify();
      return { success: true, message: 'SMTP connection verified successfully' };
    } catch (error) {
      console.error('SMTP verification failed:', error.message);
      throw new Error(`SMTP verification failed: ${error.message}`);
    }
  }

  async sendCertificateExpiryAlert(certificates) {
    if (!this.transporter) {
      console.warn('Email service not available - skipping notification');
      return { success: false, message: 'Email service not configured' };
    }

    if (!certificates || certificates.length === 0) {
      return { success: false, message: 'No certificates to notify about' };
    }

    try {
      const emailBody = this.generateExpiryEmailBody(certificates);
      const recipients = this.config.email.to.split(',').map(email => email.trim());

      const mailOptions = {
        from: this.config.email.from,
        to: recipients,
        subject: this.config.email.subject,
        html: emailBody,
        text: this.generatePlainTextBody(certificates)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Certificate expiry notification sent successfully:', result.messageId);
      
      return { 
        success: true, 
        message: `Notification sent to ${recipients.length} recipient(s)`,
        messageId: result.messageId 
      };
    } catch (error) {
      console.error('Failed to send certificate expiry notification:', error.message);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  async sendTestEmail() {
    if (!this.transporter) {
      throw new Error('Email service not initialized');
    }

    try {
      const recipients = this.config.email.to.split(',').map(email => email.trim());
      
      const mailOptions = {
        from: this.config.email.from,
        to: recipients,
        subject: 'Test Email - mkcert Web UI Email Service',
        html: this.generateTestEmailBody(),
        text: 'This is a test email from mkcert Web UI to verify SMTP configuration is working correctly.'
      };

      const result = await this.transporter.sendMail(mailOptions);
      
      return { 
        success: true, 
        message: `Test email sent successfully to ${recipients.length} recipient(s)`,
        messageId: result.messageId 
      };
    } catch (error) {
      console.error('Failed to send test email:', error.message);
      throw new Error(`Failed to send test email: ${error.message}`);
    }
  }

  generateExpiryEmailBody(certificates) {
    const now = new Date();
    const criticalCerts = certificates.filter(cert => {
      const daysUntilExpiry = Math.ceil((cert.expiry - now) / (1000 * 60 * 60 * 24));
      return daysUntilExpiry <= this.config.monitoring.criticalDays;
    });
    const warningCerts = certificates.filter(cert => {
      const daysUntilExpiry = Math.ceil((cert.expiry - now) / (1000 * 60 * 60 * 24));
      return daysUntilExpiry > this.config.monitoring.criticalDays && daysUntilExpiry <= this.config.monitoring.warningDays;
    });

    let html = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .header { background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
            .critical { background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 5px; padding: 15px; margin-bottom: 15px; }
            .warning { background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 5px; padding: 15px; margin-bottom: 15px; }
            .cert-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            .cert-table th, .cert-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            .cert-table th { background-color: #f2f2f2; }
            .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 0.9em; color: #666; }
          </style>
        </head>
        <body>
          <div class="header">
            <h2>🔒 Certificate Expiry Alert - mkcert Web UI</h2>
            <p>This is an automated notification about certificates that are approaching expiry.</p>
          </div>
    `;

    if (criticalCerts.length > 0) {
      html += `
        <div class="critical">
          <h3>🚨 Critical - Expiring Soon (≤ ${this.config.monitoring.criticalDays} days)</h3>
          <table class="cert-table">
            <thead>
              <tr><th>Certificate</th><th>Domains</th><th>Expires</th><th>Days Remaining</th></tr>
            </thead>
            <tbody>
      `;
      
      criticalCerts.forEach(cert => {
        const daysRemaining = Math.ceil((cert.expiry - now) / (1000 * 60 * 60 * 24));
        html += `
          <tr>
            <td>${cert.path}</td>
            <td>${cert.domains ? cert.domains.join(', ') : 'N/A'}</td>
            <td>${cert.expiry.toLocaleDateString()}</td>
            <td style="color: #dc3545; font-weight: bold;">${daysRemaining}</td>
          </tr>
        `;
      });
      
      html += '</tbody></table></div>';
    }

    if (warningCerts.length > 0) {
      html += `
        <div class="warning">
          <h3>⚠️ Warning - Expiring Soon (≤ ${this.config.monitoring.warningDays} days)</h3>
          <table class="cert-table">
            <thead>
              <tr><th>Certificate</th><th>Domains</th><th>Expires</th><th>Days Remaining</th></tr>
            </thead>
            <tbody>
      `;
      
      warningCerts.forEach(cert => {
        const daysRemaining = Math.ceil((cert.expiry - now) / (1000 * 60 * 60 * 24));
        html += `
          <tr>
            <td>${cert.path}</td>
            <td>${cert.domains ? cert.domains.join(', ') : 'N/A'}</td>
            <td>${cert.expiry.toLocaleDateString()}</td>
            <td style="color: #ffc107; font-weight: bold;">${daysRemaining}</td>
          </tr>
        `;
      });
      
      html += '</tbody></table></div>';
    }

    html += `
          <div class="footer">
            <p><strong>Action Required:</strong> Please renew the certificates listed above to avoid service interruptions.</p>
            <p>This notification was sent by mkcert Web UI certificate monitoring service.</p>
            <p><em>Generated on ${now.toLocaleString()}</em></p>
          </div>
        </body>
      </html>
    `;

    return html;
  }

  generatePlainTextBody(certificates) {
    const now = new Date();
    let text = 'Certificate Expiry Alert - mkcert Web UI\n';
    text += '=' .repeat(50) + '\n\n';
    text += 'The following certificates are approaching expiry:\n\n';

    certificates.forEach(cert => {
      const daysRemaining = Math.ceil((cert.expiry - now) / (1000 * 60 * 60 * 24));
      const priority = daysRemaining <= this.config.monitoring.criticalDays ? 'CRITICAL' : 'WARNING';
      
      text += `[${priority}] ${cert.path}\n`;
      text += `  Domains: ${cert.domains ? cert.domains.join(', ') : 'N/A'}\n`;
      text += `  Expires: ${cert.expiry.toLocaleDateString()}\n`;
      text += `  Days remaining: ${daysRemaining}\n\n`;
    });

    text += 'Please renew the certificates listed above to avoid service interruptions.\n\n';
    text += `Generated on ${now.toLocaleString()}\n`;

    return text;
  }

  generateTestEmailBody() {
    return `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .header { background-color: #d4edda; border: 1px solid #c3e6cb; border-radius: 5px; padding: 20px; margin-bottom: 20px; }
            .content { padding: 20px; }
            .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 0.9em; color: #666; }
          </style>
        </head>
        <body>
          <div class="header">
            <h2>✅ Test Email - mkcert Web UI</h2>
            <p>This is a test email to verify your SMTP configuration is working correctly.</p>
          </div>
          <div class="content">
            <p>If you received this email, your email notification service has been configured successfully!</p>
            <p><strong>Configuration Details:</strong></p>
            <ul>
              <li>SMTP Host: ${this.config.email.smtp.host}</li>
              <li>SMTP Port: ${this.config.email.smtp.port}</li>
              <li>Secure Connection: ${this.config.email.smtp.secure ? 'Yes' : 'No'}</li>
              <li>From Address: ${this.config.email.from}</li>
            </ul>
          </div>
          <div class="footer">
            <p>Test email sent by mkcert Web UI Email Service</p>
            <p><em>Generated on ${new Date().toLocaleString()}</em></p>
          </div>
        </body>
      </html>
    `;
  }
}

// Factory function following the project pattern
const createEmailService = (config) => {
  return new EmailService(config);
};

module.exports = { EmailService, createEmailService };
