// HOLDING FILE — adopted (and then deleted) by Task 7: Notifications page (public/notifications.html, public/js/notifications.js).
// No page loads this file. It holds the notification & monitoring code from the
// retired public/script.js, copied verbatim, so Task 7 can port it.
//
// Free references these functions had in script.js (not copied here) and
// their replacements on the redesigned pages:
//   apiRequest(endpoint, {method})  -> api.get/post from MK.shell.mountShell()
//   showAlert(msg, type)            -> MK.core.toast(msg, 'ok'|'err'|'info')
//   escapeHtml(s)                   -> MK.core.escapeHtml
//
// Markup these functions targeted in the old public/index.html:
/*
        <!-- Email & Monitoring Configuration Section -->
        <section class="notifications-section">
            <h2><i class="fas fa-bell"></i> Notifications & Monitoring</h2>
            
            <!-- Email Status Card -->
            <div class="notification-card">
                <h3><i class="fas fa-envelope"></i> Email Notifications</h3>
                <div id="email-status" class="notification-status">
                    <div class="loading">
                        <i class="fas fa-spinner fa-spin"></i> Checking email configuration...
                    </div>
                </div>
                <div class="notification-actions" id="email-actions" style="display: none;">
                    <button id="test-email-btn" class="btn btn-secondary">
                        <i class="fas fa-paper-plane"></i> Send Test Email
                    </button>
                    <button id="verify-smtp-btn" class="btn btn-outline">
                        <i class="fas fa-check-circle"></i> Verify SMTP
                    </button>
                </div>
            </div>

            <!-- Monitoring Status Card -->
            <div class="notification-card">
                <h3><i class="fas fa-shield-alt"></i> Certificate Monitoring</h3>
                <div id="monitoring-status" class="notification-status">
                    <div class="loading">
                        <i class="fas fa-spinner fa-spin"></i> Checking monitoring status...
                    </div>
                </div>
                <div class="notification-actions" id="monitoring-actions" style="display: none;">
                    <button id="check-expiry-btn" class="btn btn-secondary">
                        <i class="fas fa-search"></i> Check Now
                    </button>
                    <button id="start-monitoring-btn" class="btn btn-success" style="display: none;">
                        <i class="fas fa-play"></i> Start Monitoring
                    </button>
                    <button id="stop-monitoring-btn" class="btn btn-warning" style="display: none;">
                        <i class="fas fa-stop"></i> Stop Monitoring
                    </button>
                </div>
            </div>

            <!-- Expiring Certificates Card -->
            <div class="notification-card" id="expiring-certs-card" style="display: none;">
                <h3><i class="fas fa-exclamation-triangle"></i> Expiring Certificates</h3>
                <div id="expiring-certs-list"></div>
            </div>

            <!-- Configuration Help -->
            <div class="notification-help">
                <p style="text-align: center; padding: 15px;">
                    <i class="fas fa-cog"></i> 
                    <a href="/settings.html" style="color: var(--primary-color); text-decoration: none; font-weight: 500;">
                        Configure email and monitoring settings in the Settings page
                    </a>
                </p>
            </div>
        </section>
*/

// ================================
// Notification & Monitoring Functions
// ================================

// Setup notification event listeners
function setupNotificationEventListeners() {
    // Email test button
    const testEmailBtn = document.getElementById('test-email-btn');
    if (testEmailBtn) {
        testEmailBtn.addEventListener('click', testEmailConfiguration);
    }

    // SMTP verify button
    const verifySmtpBtn = document.getElementById('verify-smtp-btn');
    if (verifySmtpBtn) {
        verifySmtpBtn.addEventListener('click', verifySmtpConnection);
    }

    // Certificate expiry check button
    const checkExpiryBtn = document.getElementById('check-expiry-btn');
    if (checkExpiryBtn) {
        checkExpiryBtn.addEventListener('click', checkCertificateExpiry);
    }

    // Start monitoring button
    const startMonitoringBtn = document.getElementById('start-monitoring-btn');
    if (startMonitoringBtn) {
        startMonitoringBtn.addEventListener('click', startCertificateMonitoring);
    }

    // Stop monitoring button
    const stopMonitoringBtn = document.getElementById('stop-monitoring-btn');
    if (stopMonitoringBtn) {
        stopMonitoringBtn.addEventListener('click', stopCertificateMonitoring);
    }

    // Load notification status on page load
    loadNotificationStatus();
}

// Load notification and monitoring status
async function loadNotificationStatus() {
    await Promise.all([
        loadEmailStatus(),
        loadMonitoringStatus(),
        loadExpiringCertificates()
    ]);
}

// Load email configuration status
async function loadEmailStatus() {
    try {
        console.log('Loading email status...');
        const response = await apiRequest('/email/status');
        
        const statusElement = document.getElementById('email-status');
        const actionsElement = document.getElementById('email-actions');
        
        if (!statusElement) return;

        let statusHtml = '';
        let statusClass = '';

        if (!response.enabled) {
            statusClass = 'status-disabled';
            statusHtml = `
                <div class="status-indicator disabled">
                    <i class="fas fa-times-circle"></i>
                    Email notifications are disabled
                </div>
                <p class="text-muted" style="margin-top: 0.5rem;">
                    Set EMAIL_NOTIFICATIONS_ENABLED=true to enable email notifications
                </p>
            `;
        } else if (!response.configured) {
            statusClass = 'status-error';
            statusHtml = `
                <div class="status-indicator error">
                    <i class="fas fa-exclamation-circle"></i>
                    Email service not configured
                </div>
                <p class="text-muted" style="margin-top: 0.5rem;">
                    Missing required SMTP configuration (host, user, password, recipients)
                </p>
            `;
        } else {
            statusClass = 'status-enabled';
            // SMTP host/from/recipients come from settings.json / env vars;
            // operators control them, but they can still contain characters
            // that would corrupt the page if pasted carelessly. Escape.
            statusHtml = `
                <div class="status-indicator enabled">
                    <i class="fas fa-check-circle"></i>
                    Email service configured and ready
                </div>
                <div style="margin-top: 0.8rem; font-size: 0.9rem;">
                    <div><strong>SMTP Host:</strong> ${escapeHtml(response.smtp.host)}</div>
                    <div><strong>Port:</strong> ${escapeHtml(String(response.smtp.port))} ${response.smtp.secure ? '(SSL)' : '(TLS)'}</div>
                    <div><strong>From:</strong> ${escapeHtml(response.from)}</div>
                    <div><strong>Recipients:</strong> ${response.to ? escapeHtml(response.to.join(', ')) : 'Not configured'}</div>
                </div>
            `;

            // Show action buttons for configured email
            if (actionsElement) {
                actionsElement.style.display = 'flex';
            }
        }

        statusElement.className = `notification-status ${statusClass}`;
        statusElement.innerHTML = statusHtml;

    } catch (error) {
        console.error('Failed to load email status:', error);
        const statusElement = document.getElementById('email-status');
        if (statusElement) {
            statusElement.className = 'notification-status status-error';
            statusElement.innerHTML = `
                <div class="status-indicator error">
                    <i class="fas fa-exclamation-triangle"></i>
                    Failed to load email status: ${escapeHtml(error.message)}
                </div>
            `;
        }
    }
}

// Load certificate monitoring status
async function loadMonitoringStatus() {
    try {
        console.log('Loading monitoring status...');
        const response = await apiRequest('/monitoring/status');
        
        const statusElement = document.getElementById('monitoring-status');
        const actionsElement = document.getElementById('monitoring-actions');
        
        if (!statusElement) return;

        let statusHtml = '';
        let statusClass = '';

        if (!response.enabled) {
            statusClass = 'status-disabled';
            statusHtml = `
                <div class="status-indicator disabled">
                    <i class="fas fa-times-circle"></i>
                    Certificate monitoring is disabled
                </div>
                <p class="text-muted" style="margin-top: 0.5rem;">
                    Set CERT_MONITORING_ENABLED=true to enable automatic monitoring
                </p>
            `;
        } else {
            statusClass = response.running ? 'status-enabled' : 'status-error';
            const statusIcon = response.running ? 'check-circle' : 'pause-circle';
            const statusText = response.running ? 'running' : 'stopped';
            
            // response.schedule is a cron expression set in config; escape in
            // case the operator types HTML characters into it.
            statusHtml = `
                <div class="status-indicator ${response.running ? 'running' : 'stopped'}">
                    <i class="fas fa-${statusIcon}"></i>
                    Certificate monitoring is ${statusText}
                </div>
                <div style="margin-top: 0.8rem; font-size: 0.9rem;">
                    <div><strong>Schedule:</strong> ${escapeHtml(response.schedule)}</div>
                    <div><strong>Warning Period:</strong> ${escapeHtml(String(response.warningDays))} days</div>
                    <div><strong>Critical Period:</strong> ${escapeHtml(String(response.criticalDays))} days</div>
                    <div><strong>Monitor Uploaded:</strong> ${response.includeUploaded ? 'Yes' : 'No'}</div>
                    <div><strong>Email Alerts:</strong> ${response.emailEnabled ? 'Enabled' : 'Disabled'}</div>
                </div>
            `;
            
            // Show action buttons
            if (actionsElement) {
                actionsElement.style.display = 'flex';
                
                // Show appropriate start/stop buttons
                const startBtn = document.getElementById('start-monitoring-btn');
                const stopBtn = document.getElementById('stop-monitoring-btn');
                
                if (startBtn) {
                    startBtn.style.display = response.running ? 'none' : 'inline-block';
                }
                if (stopBtn) {
                    stopBtn.style.display = response.running ? 'inline-block' : 'none';
                }
            }
        }

        statusElement.className = `notification-status ${statusClass}`;
        statusElement.innerHTML = statusHtml;

    } catch (error) {
        console.error('Failed to load monitoring status:', error);
        const statusElement = document.getElementById('monitoring-status');
        if (statusElement) {
            statusElement.className = 'notification-status status-error';
            statusElement.innerHTML = `
                <div class="status-indicator error">
                    <i class="fas fa-exclamation-triangle"></i>
                    Failed to load monitoring status: ${escapeHtml(error.message)}
                </div>
            `;
        }
    }
}

// Load expiring certificates
async function loadExpiringCertificates() {
    try {
        console.log('Loading expiring certificates...');
        const response = await apiRequest('/monitoring/expiring');
        
        const cardElement = document.getElementById('expiring-certs-card');
        const listElement = document.getElementById('expiring-certs-list');
        
        if (!cardElement || !listElement) return;

        if (response.total === 0) {
            cardElement.style.display = 'none';
            return;
        }

        cardElement.style.display = 'block';
        
        let listHtml = `
            <div style="margin-bottom: 1rem;">
                <strong>Found ${response.total} expiring certificate(s):</strong>
                ${response.critical > 0 ? `<span style="color: var(--error-color);">${response.critical} critical</span>` : ''}
                ${response.warning > 0 ? `<span style="color: var(--warning-color);">${response.warning} warning</span>` : ''}
            </div>
        `;

        response.certificates.forEach(cert => {
            const priority = cert.priority;
            const priorityText = priority === 'critical' ? '🚨 CRITICAL' : '⚠️ WARNING';
            const priorityClass = priority;
            
            // SECURITY: cert.path, cert.domains come from the server's parse of
            // the certificate file; a malicious cert can embed HTML in its SANs.
            // Escape everything before HTML interpolation.
            const safePath    = escapeHtml(cert.path);
            const safeDomains = cert.domains ? escapeHtml(cert.domains.join(', ')) : '';
            const safeExpires = escapeHtml(new Date(cert.expiry).toLocaleDateString());
            const days        = Number(cert.daysUntilExpiry);
            listHtml += `
                <div class="expiring-cert-item ${priorityClass}">
                    <div class="expiring-cert-header">
                        <div class="expiring-cert-path">${safePath}</div>
                        <div class="expiring-cert-days ${priorityClass}">
                            ${days} day${days !== 1 ? 's' : ''} remaining
                        </div>
                    </div>
                    <div class="expiring-cert-details">
                        <div><strong>Expires:</strong> ${safeExpires}</div>
                        ${safeDomains ? `<div class="expiring-cert-domains"><strong>Domains:</strong> ${safeDomains}</div>` : ''}
                        <div style="margin-top: 0.3rem; font-size: 0.8rem; color: var(--text-dim);">${priorityText}</div>
                    </div>
                </div>
            `;
        });

        listElement.innerHTML = listHtml;

    } catch (error) {
        console.error('Failed to load expiring certificates:', error);
        const cardElement = document.getElementById('expiring-certs-card');
        if (cardElement) {
            cardElement.style.display = 'none';
        }
    }
}

// Test email configuration
async function testEmailConfiguration() {
    const button = document.getElementById('test-email-btn');
    if (!button) return;
    
    const originalText = button.innerHTML;
    
    try {
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
        button.disabled = true;
        
        const response = await apiRequest('/email/test', { method: 'POST' });
        
        showAlert(`Test email sent successfully! Message ID: ${response.messageId}`, 'success');
        
    } catch (error) {
        console.error('Email test failed:', error);
        showAlert(`Email test failed: ${error.message}`, 'error');
    } finally {
        button.innerHTML = originalText;
        button.disabled = false;
    }
}

// Verify SMTP connection
async function verifySmtpConnection() {
    const button = document.getElementById('verify-smtp-btn');
    if (!button) return;
    
    const originalText = button.innerHTML;
    
    try {
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
        button.disabled = true;
        
        const response = await apiRequest('/email/verify', { method: 'POST' });
        
        showAlert('SMTP connection verified successfully!', 'success');
        
    } catch (error) {
        console.error('SMTP verification failed:', error);
        showAlert(`SMTP verification failed: ${error.message}`, 'error');
    } finally {
        button.innerHTML = originalText;
        button.disabled = false;
    }
}

// Check certificate expiry manually
async function checkCertificateExpiry() {
    const button = document.getElementById('check-expiry-btn');
    if (!button) return;
    
    const originalText = button.innerHTML;
    
    try {
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';
        button.disabled = true;
        
        await apiRequest('/monitoring/check', { method: 'POST' });
        
        showAlert('Certificate expiry check completed successfully!', 'success');
        
        // Reload expiring certificates list
        setTimeout(() => {
            loadExpiringCertificates();
        }, 1000);
        
    } catch (error) {
        console.error('Certificate check failed:', error);
        showAlert(`Certificate check failed: ${error.message}`, 'error');
    } finally {
        button.innerHTML = originalText;
        button.disabled = false;
    }
}

// Start certificate monitoring
async function startCertificateMonitoring() {
    const button = document.getElementById('start-monitoring-btn');
    if (!button) return;
    
    const originalText = button.innerHTML;
    
    try {
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting...';
        button.disabled = true;
        
        await apiRequest('/monitoring/start', { method: 'POST' });
        
        showAlert('Certificate monitoring started successfully!', 'success');
        
        // Reload monitoring status
        setTimeout(() => {
            loadMonitoringStatus();
        }, 1000);
        
    } catch (error) {
        console.error('Failed to start monitoring:', error);
        showAlert(`Failed to start monitoring: ${error.message}`, 'error');
    } finally {
        button.innerHTML = originalText;
        button.disabled = false;
    }
}

// Stop certificate monitoring
async function stopCertificateMonitoring() {
    const button = document.getElementById('stop-monitoring-btn');
    if (!button) return;
    
    const originalText = button.innerHTML;
    
    try {
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Stopping...';
        button.disabled = true;
        
        await apiRequest('/monitoring/stop', { method: 'POST' });
        
        showAlert('Certificate monitoring stopped successfully!', 'success');
        
        // Reload monitoring status
        setTimeout(() => {
            loadMonitoringStatus();
        }, 1000);
        
    } catch (error) {
        console.error('Failed to stop monitoring:', error);
        showAlert(`Failed to stop monitoring: ${error.message}`, 'error');
    } finally {
        button.innerHTML = originalText;
        button.disabled = false;
    }
}
