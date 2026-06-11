// Settings page JavaScript
(function() {
    'use strict';

    // XSS-safe text escaper for HTML element bodies and attribute values.
    function escapeHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
    }

    // CSRF token cache + helper. Mirrors what script.js does for the main
    // page; needed here because settings.html doesn't load script.js.
    // Every mutating request to the server must carry X-CSRF-Token.
    let csrfToken = null;
    async function fetchCSRFToken() {
        try {
            const r = await fetch('/api/csrf-token');
            const j = await r.json();
            if (j && j.csrfToken) csrfToken = j.csrfToken;
        } catch (e) {
            console.error('Failed to fetch CSRF token:', e);
        }
    }
    async function authedFetch(url, options = {}) {
        const method = (options.method || 'GET').toUpperCase();
        const mutating = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
        const headers = { ...(options.headers || {}) };
        if (mutating) {
            if (!csrfToken) await fetchCSRFToken();
            if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
        }
        let res = await fetch(url, { ...options, headers });
        if (mutating && res.status === 403) {
            // Token may have been invalidated (e.g. server restart, session
            // regeneration). Refresh and retry once.
            try {
                const body = await res.clone().json();
                if (body && body.code === 'CSRF_INVALID') {
                    await fetchCSRFToken();
                    if (csrfToken) {
                        headers['X-CSRF-Token'] = csrfToken;
                        res = await fetch(url, { ...options, headers });
                    }
                }
            } catch (_) { /* not JSON, fall through */ }
        }
        return res;
    }

    // Theme handling
    function initTheme() {
        const themeToggle = document.getElementById('theme-toggle');
        const currentTheme = localStorage.getItem('theme') || 'dark';
        document.documentElement.setAttribute('data-theme', currentTheme);
        updateThemeToggle(themeToggle, currentTheme);

        themeToggle.addEventListener('click', () => {
            const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            updateThemeToggle(themeToggle, newTheme);
        });
    }

    function updateThemeToggle(button, theme) {
        if (theme === 'dark') {
            button.innerHTML = '<i class="fas fa-sun"></i> Light Mode';
        } else {
            button.innerHTML = '<i class="fas fa-moon"></i> Dark Mode';
        }
    }

    // Authentication handling. The /api/auth/status endpoint returns
    // { authenticated, username, authEnabled } — no nested `user` object.
    async function initAuth() {
        try {
            const response = await fetch('/api/auth/status');
            const data = await response.json();

            if (data.authenticated) {
                const authControls = document.getElementById('auth-controls');
                const usernameDisplay = document.getElementById('username-display');
                if (authControls) authControls.style.display = 'block';
                if (usernameDisplay) usernameDisplay.textContent = data.username || 'User';

                // Logout button handler
                const logoutBtn = document.getElementById('logout-btn');
                if (logoutBtn) {
                    logoutBtn.addEventListener('click', async () => {
                        // Logout is in the CSRF exempt list on the server, but
                        // we still go through authedFetch for consistency.
                        const logoutResponse = await authedFetch('/api/auth/logout', { method: 'POST' });
                        if (logoutResponse.ok) {
                            window.location.href = '/login';
                        }
                    });
                }
            }
        } catch (error) {
            console.error('Error checking auth status:', error);
        }
    }

    // Tab switching
    function initTabs() {
        const tabs = document.querySelectorAll('.settings-tab');
        const panels = document.querySelectorAll('.settings-panel');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const panelId = tab.dataset.panel;
                
                // Update active tab
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                // Update active panel
                panels.forEach(p => p.classList.remove('active'));
                document.getElementById(`panel-${panelId}`).classList.add('active');
            });
        });
    }

    // Load settings from server
    async function loadSettings() {
        try {
            const response = await fetch('/api/settings');
            const result = await response.json();

            if (result.success) {
                // Extract config data (everything except success and message)
                const { success, message, ...configData } = result;
                populateForm(configData);
            } else if (response.status === 403) {
                // Server refused — either auth is disabled (settings API requires
                // it) or this session isn't authenticated. Surface the server's
                // own explanation so the user knows why.
                showAlert(result.error || 'Settings API unavailable', 'error');
            } else if (response.status === 401) {
                showAlert('You need to log in to access settings.', 'error');
                setTimeout(() => { window.location.href = '/login'; }, 1500);
            } else {
                showAlert('Error loading settings: ' + (result.error || result.message || 'unknown'), 'error');
            }
        } catch (error) {
            console.error('Error loading settings:', error);
            showAlert('Failed to load settings', 'error');
        }
    }

    // Populate form with settings data
    function populateForm(settings) {
        // Helper function to set nested values
        function setValue(path, value) {
            const input = document.querySelector(`[name="${path}"]`);
            if (!input) return;
            
            if (input.type === 'checkbox') {
                input.checked = Boolean(value);
            } else if (input.type === 'number') {
                input.value = Number(value) || '';
            } else {
                input.value = value || '';
            }
        }

        // Recursively populate form fields
        function populateObject(obj, prefix = '') {
            for (const key in obj) {
                const value = obj[key];
                const path = prefix ? `${prefix}.${key}` : key;
                
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    populateObject(value, path);
                } else {
                    setValue(path, value);
                }
            }
        }

        populateObject(settings);
    }

    // Extract form data as nested object
    function getFormData() {
        const form = document.getElementById('settings-form');
        const formData = new FormData(form);
        const settings = {};

        for (const [name, value] of formData.entries()) {
            const parts = name.split('.');
            let current = settings;
            
            for (let i = 0; i < parts.length - 1; i++) {
                if (!current[parts[i]]) {
                    current[parts[i]] = {};
                }
                current = current[parts[i]];
            }
            
            const lastPart = parts[parts.length - 1];
            const input = form.querySelector(`[name="${name}"]`);
            
            if (input.type === 'checkbox') {
                current[lastPart] = input.checked;
            } else if (input.type === 'number') {
                current[lastPart] = input.value ? Number(input.value) : undefined;
            } else {
                current[lastPart] = value || undefined;
            }
        }

        // Add unchecked checkboxes as false
        const checkboxes = form.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            if (!formData.has(checkbox.name)) {
                const parts = checkbox.name.split('.');
                let current = settings;
                
                for (let i = 0; i < parts.length - 1; i++) {
                    if (!current[parts[i]]) {
                        current[parts[i]] = {};
                    }
                    current = current[parts[i]];
                }
                
                current[parts[parts.length - 1]] = false;
            }
        });

        return settings;
    }

    // Save settings to server
    async function saveSettings(settings) {
        try {
            const response = await authedFetch('/api/settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(settings)
            });

            const result = await response.json();
            
            if (result.success) {
                showSuccessBanner();
                showAlert(result.message || 'Settings saved successfully!', 'success');
                // Reload settings to show sanitized values
                setTimeout(() => loadSettings(), 500);
            } else {
                showAlert('Error saving settings: ' + (result.error || result.message), 'error');
            }
        } catch (error) {
            console.error('Error saving settings:', error);
            showAlert('Failed to save settings', 'error');
        }
    }

    // Reset settings to defaults
    async function resetSettings() {
        if (!confirm('Are you sure you want to reset all settings to defaults? This will delete your custom configuration.')) {
            return;
        }

        try {
            const response = await authedFetch('/api/settings', {
                method: 'DELETE'
            });

            const result = await response.json();
            
            if (result.success) {
                showAlert('Settings reset to defaults successfully!', 'success');
                // Extract config data (everything except success and message)
                const { success, message, ...configData } = result;
                populateForm(configData);
            } else {
                showAlert('Error resetting settings: ' + (result.error || result.message), 'error');
            }
        } catch (error) {
            console.error('Error resetting settings:', error);
            showAlert('Failed to reset settings', 'error');
        }
    }

    // Show success banner
    function showSuccessBanner() {
        const banner = document.getElementById('success-banner');
        banner.classList.add('show');
        
        setTimeout(() => {
            banner.classList.remove('show');
        }, 3000);
    }

    // Show alert message — message is treated as plain text (escaped before
    // rendering) because callers pass through server error strings.
    function showAlert(message, type = 'info') {
        const alertsContainer = document.getElementById('alerts-container');
        const alertId = 'alert-' + Date.now();

        const alertHTML = `
            <div id="${escapeHtml(alertId)}" class="alert alert-${escapeHtml(type)}">
                <i class="fas fa-${escapeHtml(getAlertIcon(type))}"></i>
                <span>${escapeHtml(message)}</span>
                <button class="alert-close" onclick="document.getElementById('${escapeHtml(alertId)}').remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;

        alertsContainer.insertAdjacentHTML('beforeend', alertHTML);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            const alert = document.getElementById(alertId);
            if (alert) alert.remove();
        }, 5000);
    }

    function getAlertIcon(type) {
        const icons = {
            'success': 'check-circle',
            'error': 'exclamation-circle',
            'warning': 'exclamation-triangle',
            'info': 'info-circle'
        };
        return icons[type] || 'info-circle';
    }

    // Initialize form handlers
    function initForm() {
        const form = document.getElementById('settings-form');
        
        // Form submit handler
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const settings = getFormData();
            await saveSettings(settings);
        });

        // Reset button handler
        document.getElementById('reset-btn').addEventListener('click', async () => {
            await resetSettings();
        });

        // Reload button handler
        document.getElementById('reload-btn').addEventListener('click', async () => {
            await loadSettings();
            showAlert('Settings reloaded from server', 'info');
        });

        // View config button handler
        document.getElementById('view-config-btn').addEventListener('click', async () => {
            await showRunningConfig();
        });
    }

    // Show running configuration modal
    async function showRunningConfig() {
        const modal = document.getElementById('config-modal');
        const content = document.getElementById('config-content');
        
        // Show modal with loading state
        modal.classList.add('show');
        content.textContent = 'Loading running configuration...';
        
        try {
            const response = await fetch('/api/settings/running');
            const result = await response.json();
            
            if (result.success) {
                // Extract config data (everything except success and message)
                const { success, message, ...configData } = result;
                
                // Pretty print the configuration
                content.textContent = JSON.stringify(configData, null, 2);
            } else {
                content.textContent = 'Error: ' + (result.error || result.message);
                showAlert('Failed to load running configuration', 'error');
            }
        } catch (error) {
            console.error('Error loading running config:', error);
            content.textContent = 'Error: Failed to fetch running configuration';
            showAlert('Failed to load running configuration', 'error');
        }
    }

    // Initialize modal handlers
    function initModal() {
        const modal = document.getElementById('config-modal');
        const closeBtn = document.getElementById('config-modal-close');
        const copyBtn = document.getElementById('copy-config-btn');
        const downloadBtn = document.getElementById('download-config-btn');
        
        // Close modal
        closeBtn.addEventListener('click', () => {
            modal.classList.remove('show');
        });
        
        // Close on background click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('show');
            }
        });
        
        // Copy to clipboard
        copyBtn.addEventListener('click', () => {
            const content = document.getElementById('config-content').textContent;
            navigator.clipboard.writeText(content).then(() => {
                showAlert('Configuration copied to clipboard', 'success');
            }).catch(err => {
                console.error('Failed to copy:', err);
                showAlert('Failed to copy to clipboard', 'error');
            });
        });
        
        // Download as JSON
        downloadBtn.addEventListener('click', () => {
            const content = document.getElementById('config-content').textContent;
            const blob = new Blob([content], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `mkcert-running-config-${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showAlert('Configuration downloaded', 'success');
        });
    }

    // Initialize on page load
    document.addEventListener('DOMContentLoaded', () => {
        initTheme();
        initAuth();
        initTabs();
        initForm();
        initModal();
        initNotificationTests();
        loadSettings();
    });

    // Notification test handlers (NTFY and Webhook)
    function initNotificationTests() {
        const ntfyBtn = document.getElementById('test-ntfy-btn');
        const webhookBtn = document.getElementById('test-webhook-btn');

        if (ntfyBtn) {
            ntfyBtn.addEventListener('click', () => runNotificationTest('ntfy'));
        }
        if (webhookBtn) {
            webhookBtn.addEventListener('click', () => runNotificationTest('webhook'));
        }
    }

    async function runNotificationTest(channel) {
        const resultEl = document.getElementById(`${channel}-test-result`);
        const btn = document.getElementById(`test-${channel}-btn`);

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
        resultEl.style.display = 'none';

        try {
            const response = await authedFetch(`/api/${channel}/test`, { method: 'POST' });
            const data = await response.json();

            // SECURITY: data.message and data.error come from the server and may
            // include user-supplied content (URLs, error strings). Build the
            // result with DOM nodes + textContent so any embedded HTML stays literal.
            resultEl.style.display = 'block';
            while (resultEl.firstChild) resultEl.removeChild(resultEl.firstChild);
            const span = document.createElement('span');
            const icon = document.createElement('i');
            const text = document.createElement('span');
            if (data.success) {
                span.style.color = 'var(--success-color, #28a745)';
                icon.className = 'fas fa-check-circle';
                text.textContent = ' ' + (data.message || 'Test sent successfully');
            } else {
                span.style.color = 'var(--danger-color, #dc3545)';
                icon.className = 'fas fa-times-circle';
                text.textContent = ' ' + (data.error || data.message || 'Test failed');
            }
            span.appendChild(icon);
            span.appendChild(text);
            resultEl.appendChild(span);
        } catch (error) {
            resultEl.style.display = 'block';
            while (resultEl.firstChild) resultEl.removeChild(resultEl.firstChild);
            const span = document.createElement('span');
            span.style.color = 'var(--danger-color, #dc3545)';
            const icon = document.createElement('i');
            icon.className = 'fas fa-times-circle';
            const text = document.createElement('span');
            text.textContent = ' Request failed: ' + error.message;
            span.append(icon, text);
            resultEl.appendChild(span);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Test ' + (channel === 'ntfy' ? 'Notification' : 'Payload');
        }
    }
})();
