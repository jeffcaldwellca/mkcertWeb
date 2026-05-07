// Generic HTTP webhook notification service
const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * Sends an HTTP/HTTPS request and returns a promise resolving to { statusCode, body }.
 */
function makeRequest(urlString, method, headers, body) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(urlString);
    } catch (err) {
      return reject(new Error(`Invalid webhook URL: ${urlString}`));
    }

    const transport = parsedUrl.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers,
      timeout: 10000
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Webhook request timed out after 10 seconds'));
    });

    req.on('error', reject);

    if (body) req.write(body);
    req.end();
  });
}

class WebhookService {
  constructor(config) {
    this.config = config;
  }

  isConfigurationValid() {
    const { webhook } = this.config;
    if (!webhook || !webhook.url) return false;
    try {
      new URL(webhook.url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Build headers for the webhook request, merging defaults with custom headers.
   */
  _buildHeaders(extraHeaders = {}) {
    const base = {
      'Content-Type': 'application/json',
      'User-Agent': 'mkcert-web-ui/webhook'
    };

    // Merge custom headers from config (values must be strings)
    const custom = this.config.webhook.headers || {};
    const safeCustom = Object.fromEntries(
      Object.entries(custom)
        .filter(([, v]) => typeof v === 'string')
    );

    return { ...base, ...safeCustom, ...extraHeaders };
  }

  /**
   * POST a JSON payload to the configured webhook URL.
   * @param {object} payload
   */
  async sendPayload(payload) {
    if (!this.isConfigurationValid()) {
      throw new Error('Webhook service not configured. Set webhook.url.');
    }

    const body = JSON.stringify(payload);
    const headers = this._buildHeaders({ 'Content-Length': Buffer.byteLength(body).toString() });

    const response = await makeRequest(this.config.webhook.url, 'POST', headers, body);

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Webhook returned HTTP ${response.statusCode}: ${response.body}`);
    }

    return { success: true, statusCode: response.statusCode };
  }

  /**
   * Send a certificate expiry alert to the webhook endpoint.
   * @param {Array} certificates  Array of expiring certificate objects
   */
  async sendCertificateExpiryAlert(certificates) {
    if (!certificates || certificates.length === 0) {
      return { success: false, message: 'No certificates to notify about' };
    }

    const critical = certificates.filter(c => c.priority === 'critical');
    const warning = certificates.filter(c => c.priority === 'warning');

    const payload = {
      title: critical.length > 0
        ? `CRITICAL: ${critical.length} certificate(s) expiring very soon`
        : `Warning: ${warning.length} certificate(s) expiring soon`,
      message: `${certificates.length} certificate(s) are approaching expiry. ` +
        (critical.length > 0 ? `${critical.length} CRITICAL, ` : '') +
        `${warning.length} warning.`,
      severity: critical.length > 0 ? 'critical' : 'warning',
      timestamp: new Date().toISOString(),
      certificates: certificates.map(cert => ({
        path: cert.path,
        domains: cert.domains || [],
        daysUntilExpiry: cert.daysUntilExpiry,
        expiry: cert.expiry ? cert.expiry.toISOString() : null,
        priority: cert.priority
      })),
      summary: {
        total: certificates.length,
        critical: critical.length,
        warning: warning.length
      }
    };

    try {
      const result = await this.sendPayload(payload);
      console.log('Webhook certificate expiry notification sent successfully');
      return { success: true, message: `Webhook notification sent (${certificates.length} certificate(s))`, ...result };
    } catch (error) {
      console.error('Failed to send webhook notification:', error.message);
      throw error;
    }
  }

  /**
   * Send a test payload to verify the webhook endpoint is reachable.
   */
  async sendTestNotification() {
    if (!this.isConfigurationValid()) {
      throw new Error('Webhook service not configured. Set webhook.url.');
    }

    const payload = {
      title: 'Test Notification — mkcert Web UI',
      message: 'This is a test notification from mkcert Web UI to verify the webhook endpoint is working correctly.',
      severity: 'info',
      timestamp: new Date().toISOString(),
      test: true
    };

    try {
      const result = await this.sendPayload(payload);
      return { success: true, message: 'Test webhook notification sent successfully', ...result };
    } catch (error) {
      console.error('Failed to send test webhook notification:', error.message);
      throw new Error(`Failed to send test webhook notification: ${error.message}`);
    }
  }
}

module.exports = { WebhookService };
