// NTFY push notification service
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
      return reject(new Error(`Invalid URL: ${urlString}`));
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
      reject(new Error('Request timed out after 10 seconds'));
    });

    req.on('error', reject);

    if (body) req.write(body);
    req.end();
  });
}

class NtfyService {
  constructor(config) {
    this.config = config;
  }

  isConfigurationValid() {
    const { ntfy } = this.config;
    return !!(ntfy && ntfy.url && ntfy.topic);
  }

  /**
   * Build the full ntfy publish URL: <baseUrl>/<topic>
   */
  _publishUrl() {
    const base = this.config.ntfy.url.replace(/\/$/, '');
    return `${base}/${encodeURIComponent(this.config.ntfy.topic)}`;
  }

  /**
   * Build Authorization header value based on config.
   * Priority: Bearer token > Basic auth > none.
   */
  _authHeader() {
    const { token, username, password } = this.config.ntfy;
    if (token) {
      return `Bearer ${token}`;
    }
    if (username && password) {
      const encoded = Buffer.from(`${username}:${password}`).toString('base64');
      return `Basic ${encoded}`;
    }
    return null;
  }

  /**
   * Map internal priority label to ntfy priority value.
   * ntfy accepts: min | low | default | high | urgent
   */
  _mapPriority(priority) {
    const map = { min: 'min', low: 'low', default: 'default', high: 'high', urgent: 'urgent', critical: 'urgent', warning: 'high' };
    return map[priority] || 'default';
  }

  /**
   * Send a notification to the configured NTFY topic.
   * @param {string} title
   * @param {string} message  Plain text body
   * @param {string} [priority]  'min'|'low'|'default'|'high'|'urgent'
   * @param {string[]} [tags]    ntfy emoji tags
   */
  async sendNotification(title, message, priority = 'default', tags = []) {
    if (!this.isConfigurationValid()) {
      throw new Error('NTFY service not configured. Set ntfy.url and ntfy.topic.');
    }

    const url = this._publishUrl();
    const headers = {
      'Content-Type': 'text/plain',
      'Title': title,
      'Priority': this._mapPriority(priority)
    };

    if (tags.length > 0) {
      headers['Tags'] = tags.join(',');
    }

    const authHeader = this._authHeader();
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    const response = await makeRequest(url, 'POST', headers, message);

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`NTFY returned HTTP ${response.statusCode}: ${response.body}`);
    }

    return { success: true, statusCode: response.statusCode };
  }

  /**
   * Send a certificate expiry alert notification.
   * @param {Array} certificates  Array of expiring certificate objects
   */
  async sendCertificateExpiryAlert(certificates) {
    if (!certificates || certificates.length === 0) {
      return { success: false, message: 'No certificates to notify about' };
    }

    const critical = certificates.filter(c => c.priority === 'critical');
    const warning = certificates.filter(c => c.priority === 'warning');

    const overallPriority = critical.length > 0 ? 'urgent' : 'high';
    const tags = critical.length > 0 ? ['rotating_light', 'lock'] : ['warning', 'lock'];

    const title = critical.length > 0
      ? `CRITICAL: ${critical.length} certificate(s) expiring very soon`
      : `Warning: ${warning.length} certificate(s) expiring soon`;

    const lines = certificates.map(cert => {
      const domainsStr = cert.domains ? cert.domains.join(', ') : 'unknown';
      const urgency = cert.priority === 'critical' ? '[CRITICAL]' : '[WARNING]';
      return `${urgency} ${domainsStr} — ${cert.daysUntilExpiry} day(s) remaining`;
    });

    const message = lines.join('\n');

    try {
      const result = await this.sendNotification(title, message, overallPriority, tags);
      console.log('NTFY certificate expiry notification sent successfully');
      return { success: true, message: `NTFY notification sent (${certificates.length} certificate(s))`, ...result };
    } catch (error) {
      console.error('Failed to send NTFY notification:', error.message);
      throw error;
    }
  }

  /**
   * Send a test notification to verify configuration.
   */
  async sendTestNotification() {
    if (!this.isConfigurationValid()) {
      throw new Error('NTFY service not configured. Set ntfy.url and ntfy.topic.');
    }

    try {
      const result = await this.sendNotification(
        'Test Notification — mkcert Web UI',
        'This is a test notification from mkcert Web UI to verify NTFY configuration is working correctly.',
        'default',
        ['white_check_mark']
      );
      return { success: true, message: 'Test NTFY notification sent successfully', ...result };
    } catch (error) {
      console.error('Failed to send test NTFY notification:', error.message);
      throw new Error(`Failed to send test NTFY notification: ${error.message}`);
    }
  }
}

module.exports = { NtfyService };
