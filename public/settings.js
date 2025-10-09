// Settings page JavaScript
(function() {
    'use strict';

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

    // Authentication handling
    async function initAuth() {
        try {
            const response = await fetch('/auth/status');
            const data = await response.json();
            
            if (data.authenticated) {
                const authControls = document.getElementById('auth-controls');
                const usernameDisplay = document.getElementById('username-display');
                authControls.style.display = 'block';
                
                if (data.user) {
                    usernameDisplay.textContent = data.user.displayName || data.user.username || data.user.email || 'User';
                } else {
                    usernameDisplay.textContent = data.username || 'User';
                }
                
                // Logout button handler
                document.getElementById('logout-btn').addEventListener('click', async () => {
                    const logoutResponse = await fetch('/auth/logout', { method: 'POST' });
                    if (logoutResponse.ok) {
                        window.location.href = '/login.html';
                    }
                });
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
            } else {
                showAlert('Error loading settings: ' + result.message, 'error');
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
            const response = await fetch('/api/settings', {
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
                showAlert('Error saving settings: ' + result.message, 'error');
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
            const response = await fetch('/api/settings', {
                method: 'DELETE'
            });

            const result = await response.json();
            
            if (result.success) {
                showAlert('Settings reset to defaults successfully!', 'success');
                // Extract config data (everything except success and message)
                const { success, message, ...configData } = result;
                populateForm(configData);
            } else {
                showAlert('Error resetting settings: ' + result.message, 'error');
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

    // Show alert message
    function showAlert(message, type = 'info') {
        const alertsContainer = document.getElementById('alerts-container');
        const alertId = 'alert-' + Date.now();
        
        const alertHTML = `
            <div id="${alertId}" class="alert alert-${type}">
                <i class="fas fa-${getAlertIcon(type)}"></i>
                <span>${message}</span>
                <button class="alert-close" onclick="document.getElementById('${alertId}').remove()">
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
                content.textContent = 'Error: ' + result.message;
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
        loadSettings();
    });
})();
