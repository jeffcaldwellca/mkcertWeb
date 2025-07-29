// mkcert Web UI - Frontend JavaScript
// Fixed version with proper template literal handling

// Configuration
const API_BASE = window.location.origin + '/api';

// Authentication state
let authEnabled = false;
let currentUser = null;

// DOM Elements
let certificatesList, generateForm, domainsInput, formatSelect;
let installCaBtn, showCaBtn, hideModal, caModal;
let statusIndicators = {};

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    checkAuthentication().then(() => {
        initializeElements();
        loadSystemStatus();
        loadCertificates();
        setupEventListeners();
    });
});

// Check authentication status
async function checkAuthentication() {
    try {
        const response = await fetch('/api/auth/status');
        const data = await response.json();
        
        authEnabled = data.authEnabled;
        currentUser = data.username;
        
        if (authEnabled && !data.authenticated) {
            window.location.href = '/login';
            return;
        }
        
        // Show auth controls if authentication is enabled and user is logged in
        if (authEnabled && data.authenticated) {
            const authControls = document.getElementById('auth-controls');
            const usernameDisplay = document.getElementById('username-display');
            
            if (authControls) {
                authControls.style.display = 'block';
                usernameDisplay.textContent = `Welcome, ${currentUser}`;
            }
        }
        
    } catch (error) {
        console.log('Auth check failed:', error);
        // If auth check fails and we're not on login page, assume no auth required
    }
}

// Handle logout
function logout() {
    if (!authEnabled) return;
    
    fetch('/api/auth/logout', { method: 'POST' })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                window.location.href = data.redirectTo || '/login';
            }
        })
        .catch(error => {
            console.error('Logout failed:', error);
            // Force redirect to login anyway
            window.location.href = '/login';
        });
}

// Initialize DOM elements
function initializeElements() {
    certificatesList = document.getElementById('certificates-list');
    generateForm = document.getElementById('generate-form');
    domainsInput = document.getElementById('domains');
    formatSelect = document.getElementById('format');
    installCaBtn = document.getElementById('install-ca-btn');
    showCaBtn = document.getElementById('show-ca-btn');
    hideModal = document.getElementById('hide-modal');
    caModal = document.getElementById('ca-modal');
    
    // Status indicators
    statusIndicators.mkcert = document.getElementById('mkcert-status');
    statusIndicators.ca = document.getElementById('ca-status');
    statusIndicators.openssl = document.getElementById('openssl-status');
}

// API request helper
async function apiRequest(endpoint, options = {}) {
    try {
        const response = await fetch(API_BASE + endpoint, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });
        
        if (!response.ok) {
            const error = await response.json();
            
            // Handle authentication errors
            if (response.status === 401 && error.redirectTo) {
                window.location.href = error.redirectTo;
                return;
            }
            
            // Throw the full error object so UI can access all fields
            throw error;
        }
        return await response.json();
    } catch (error) {
        console.error('API request failed:', error);
        throw error;
    }
}

// Setup event listeners
function setupEventListeners() {
    if (generateForm) {
        generateForm.addEventListener('submit', handleGenerate);
    }
    
    if (installCaBtn) {
        installCaBtn.addEventListener('click', handleInstallCA);
    }
    
    if (showCaBtn) {
        showCaBtn.addEventListener('click', showRootCA);
    }
    
    if (hideModal) {
        hideModal.addEventListener('click', hideModalDialog);
    }
    
    // Add logout button event listener
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
}

// Load system status
async function loadSystemStatus() {
    try {
        const status = await apiRequest('/status');
        
        // Create status indicators HTML
        const statusHtml = 
            '<div class="status-info">' +
            '<div class="status-item">' +
            '<i class="fas fa-' + (status.mkcertInstalled ? 'check-circle' : 'times-circle') + '"></i>' +
            '<span id="mkcert-status" class="status-indicator ' + (status.mkcertInstalled ? 'status-success' : 'status-error') + '">mkcert ' + (status.mkcertInstalled ? 'installed' : 'not installed') + '</span>' +
            '</div>' +
            '<div class="status-item">' +
            '<i class="fas fa-' + (status.caExists ? 'shield-alt' : 'exclamation-triangle') + '"></i>' +
            '<span id="ca-status" class="status-indicator ' + (status.caExists ? 'status-success' : 'status-error') + '">Root CA ' + (status.caExists ? 'exists' : 'missing') + '</span>' +
            '</div>' +
            '<div class="status-item">' +
            '<i class="fas fa-' + (status.opensslAvailable ? 'key' : 'times-circle') + '"></i>' +
            '<span id="openssl-status" class="status-indicator ' + (status.opensslAvailable ? 'status-success' : 'status-error') + '">OpenSSL ' + (status.opensslAvailable ? 'available' : 'not available') + '</span>' +
            '</div>' +
            '</div>';
        
        // Update the status-info div
        const statusInfo = document.getElementById('status-info');
        if (statusInfo) {
            statusInfo.innerHTML = statusHtml;
        }
        
        // Re-initialize status indicators after creating them
        statusIndicators.mkcert = document.getElementById('mkcert-status');
        statusIndicators.ca = document.getElementById('ca-status');
        statusIndicators.openssl = document.getElementById('openssl-status');
        
        // Load Root CA information if CA exists
        if (status.caExists) {
            await loadRootCAInfo();
        }
        
    } catch (error) {
        console.error('Failed to load system status:', error);
        const statusInfo = document.getElementById('status-info');
        if (statusInfo) {
            statusInfo.innerHTML = '<div class="error">Failed to load system status: ' + error.message + '</div>';
        }
    }
}

// Load and display Root CA information
async function loadRootCAInfo() {
    try {
        const response = await apiRequest('/rootca/info');
        const caInfo = response.caInfo; // Extract the nested caInfo object
        
        let expiryInfo, expiryClass = '';
        if (caInfo.daysUntilExpiry < 0) {
            expiryInfo = 'Expired ' + Math.abs(caInfo.daysUntilExpiry) + ' days ago';
            expiryClass = 'expiry-expired';
        } else if (caInfo.daysUntilExpiry <= 30) {
            expiryInfo = 'Expires in ' + caInfo.daysUntilExpiry + ' days';
            expiryClass = 'expiry-warning';
        } else if (caInfo.daysUntilExpiry <= 90) {
            expiryInfo = 'Expires in ' + caInfo.daysUntilExpiry + ' days';
            expiryClass = 'expiry-caution';
        } else {
            expiryInfo = 'Expires in ' + caInfo.daysUntilExpiry + ' days';
            expiryClass = 'expiry-good';
        }
        
        if (caInfo.validTo) {
            expiryInfo += ' (' + caInfo.validTo + ')';
        }
        
        const rootCAHtml = 
            '<div class="rootca-info-grid">' +
            '<div class="rootca-details">' +
            '<div class="ca-info-item">' +
            '<label><strong>Subject:</strong></label>' +
            '<div class="ca-detail">' + (caInfo.subject || 'N/A') + '</div>' +
            '</div>' +
            '<div class="ca-info-item">' +
            '<label><strong>Issuer:</strong></label>' +
            '<div class="ca-detail">' + (caInfo.issuer || 'N/A') + '</div>' +
            '</div>' +
            '<div class="ca-info-item">' +
            '<label><strong>Expiry:</strong></label>' +
            '<div class="ca-detail ' + expiryClass + '">' + expiryInfo + '</div>' +
            '</div>' +
            '<div class="ca-info-item">' +
            '<label><strong>Fingerprint:</strong></label>' +
            '<div class="ca-detail fingerprint">' + (caInfo.fingerprint || caInfo.serial || 'N/A') + '</div>' +
            '</div>' +
            '<div class="ca-info-item">' +
            '<label><strong>Location:</strong></label>' +
            '<div class="ca-detail">' + (caInfo.path || 'N/A') + '</div>' +
            '</div>' +
            '</div>' +
            '<div class="rootca-actions">' +
            '<h3><i class="fas fa-download"></i> CA Management</h3>' +
            '<div class="btn-group">' +
            '<button id="install-ca-btn" class="btn btn-primary">' +
            '<i class="fas fa-shield-alt"></i> Install CA in System' +
            '</button>' +
            '<a href="/api/download/rootca" class="btn btn-success" download>' +
            '<i class="fas fa-download"></i> Download Root CA' +
            '</a>' +
            '</div>' +
            '<div class="ca-usage-info">' +
            '<h4><i class="fas fa-info-circle"></i> Installation Instructions</h4>' +
            '<ul>' +
            '<li><strong>macOS:</strong> Double-click downloaded file, add to Keychain, set trust to "Always Trust"</li>' +
            '<li><strong>Linux:</strong> <code>sudo cp rootCA.pem /usr/local/share/ca-certificates/mkcert-rootCA.crt && sudo update-ca-certificates</code></li>' +
            '<li><strong>Windows:</strong> Double-click file, install to "Trusted Root Certification Authorities"</li>' +
            '</ul>' +
            '</div>' +
            '</div>' +
            '</div>';
        
        // Update the rootca-info div
        const rootCAInfo = document.getElementById('rootca-info');
        if (rootCAInfo) {
            rootCAInfo.innerHTML = rootCAHtml;
        }
        
        // Show the Root CA section
        const rootCASection = document.getElementById('rootca-section');
        if (rootCASection) {
            rootCASection.style.display = 'block';
        }
        
        // Re-attach event listener for install CA button
        const newInstallBtn = document.getElementById('install-ca-btn');
        if (newInstallBtn) {
            newInstallBtn.addEventListener('click', handleInstallCA);
        }
        
    } catch (error) {
        console.error('Failed to load Root CA info:', error);
        const rootCAInfo = document.getElementById('rootca-info');
        if (rootCAInfo) {
            rootCAInfo.innerHTML = '<div class="error">Failed to load Root CA information: ' + error.message + '</div>';
        }
    }
}

// Update status indicator
function updateStatusIndicator(type, status, message) {
    const indicator = statusIndicators[type];
    if (!indicator) return;
    
    indicator.className = 'status-indicator ' + (status ? 'status-success' : 'status-error');
    indicator.textContent = message;
}

// Show Root CA modal
async function showRootCA() {
    try {
        const caInfo = await apiRequest('/rootca/info');
        
        let expiryInfo;
        if (caInfo.daysUntilExpiry < 0) {
            expiryInfo = 'Expired ' + Math.abs(caInfo.daysUntilExpiry) + ' days ago';
        } else if (caInfo.daysUntilExpiry <= 30) {
            expiryInfo = 'Expires in ' + caInfo.daysUntilExpiry + ' days';
        } else if (caInfo.daysUntilExpiry <= 90) {
            expiryInfo = 'Expires in ' + caInfo.daysUntilExpiry + ' days';
        } else {
            expiryInfo = 'Expires in ' + caInfo.daysUntilExpiry + ' days';
        }
        
        if (caInfo.expiry) {
            expiryInfo += ' (' + caInfo.expiry + ')';
        }
        
        document.getElementById('ca-subject').textContent = caInfo.subject || 'N/A';
        document.getElementById('ca-issuer').textContent = caInfo.issuer || 'N/A';
        document.getElementById('ca-expiry').textContent = expiryInfo;
        document.getElementById('ca-fingerprint').textContent = caInfo.fingerprint || 'N/A';
        document.getElementById('ca-path').textContent = caInfo.caRoot || 'N/A';
        
        caModal.style.display = 'block';
    } catch (error) {
        showAlert('Failed to load CA information: ' + error.message, 'error');
    }
}

// Hide modal dialog
function hideModalDialog() {
    caModal.style.display = 'none';
}

// Handle certificate generation
async function handleGenerate(event) {
    event.preventDefault();
    
    const domains = domainsInput.value.trim().split('\n').filter(d => d.trim());
    const format = formatSelect.value;
    
    if (domains.length === 0) {
        showAlert('Please enter at least one domain', 'error');
        return;
    }
    
    try {
        const result = await apiRequest('/generate', {
            method: 'POST',
            body: JSON.stringify({ domains, format })
        });
        
        const formatName = format.toUpperCase();
        showAlert(formatName + ' certificate generated successfully for: ' + domains.join(', '), 'success');
        loadCertificates();
        generateForm.reset();
    } catch (error) {
        showAlert('Failed to generate certificate: ' + error.message, 'error');
    }
}

// Load and display certificates
async function loadCertificates() {
    try {
        const response = await apiRequest('/certificates');
        displayCertificates(response.certificates || []);
    } catch (error) {
        showAlert('Failed to load certificates: ' + error.message, 'error');
        certificatesList.innerHTML = '<p class="error">Failed to load certificates</p>';
    }
}

// Display certificates list
function displayCertificates(certificates) {
    if (!certificates || certificates.length === 0) {
        certificatesList.innerHTML = '<p class="empty-state">No certificates found</p>';
        return;
    }
    
    const html = certificates.map(cert => {
        const domainsDisplay = cert.domains ? cert.domains.join(', ') : 'Unknown';
        const createdDate = new Date(cert.created).toLocaleDateString();
        const createdTime = new Date(cert.created).toLocaleTimeString();
        
        const formatBadge = cert.format ? 
            '<span class="format-badge format-' + cert.format.toLowerCase() + '">' + cert.format.toUpperCase() + '</span>' : '';
        
        let expiryInfo, expiryClass = '';
        if (cert.expiryDate) {
            const expiryDateStr = new Date(cert.expiryDate).toLocaleDateString();
            if (cert.daysUntilExpiry < 0) {
                expiryInfo = 'Expired ' + Math.abs(cert.daysUntilExpiry) + ' days ago';
                expiryClass = 'expiry-expired';
            } else if (cert.daysUntilExpiry <= 30) {
                expiryInfo = 'Expires in ' + cert.daysUntilExpiry + ' days';
                expiryClass = 'expiry-warning';
            } else if (cert.daysUntilExpiry <= 90) {
                expiryInfo = 'Expires in ' + cert.daysUntilExpiry + ' days';
                expiryClass = 'expiry-caution';
            } else {
                expiryInfo = 'Expires in ' + cert.daysUntilExpiry + ' days';
                expiryClass = 'expiry-good';
            }
            expiryInfo += ' (' + expiryDateStr + ')';
        } else {
            expiryInfo = 'Unknown';
        }

        // Format folder display
        const folderDisplay = cert.folder === 'root' ? 'Root folder' : cert.folder;
        const folderParam = cert.folder; // send folder string as-is, with slashes
        const isRootCert = cert.folder === 'root';
        const isArchived = cert.isArchived || false;
        
        return '<div class="certificate-card ' + 
               (cert.isExpired ? 'certificate-expired' : '') + ' ' +
               (isRootCert ? 'root-certificate' : '') + ' ' +
               (isArchived ? 'archived-certificate' : '') + '">' +
               '<div class="certificate-header">' +
               '<div class="certificate-name">' +
               '<i class="fas fa-certificate"></i> ' + cert.name +
               formatBadge +
               (cert.isExpired ? '<span class="expired-badge">EXPIRED</span>' : '') +
               (isRootCert ? '<span class="read-only-badge">READ-ONLY</span>' : '') +
               (isArchived ? '<span class="archived-badge">ARCHIVED</span>' : '') +
               '</div></div>' +
               '<div class="certificate-info">' +
               '<div><strong>Domains:</strong> ' + domainsDisplay + '</div>' +
               '<div><strong>Location:</strong> ' + folderDisplay + '</div>' +
               '<div><strong>Created:</strong> ' + createdDate + ' ' + createdTime + '</div>' +
               '<div class="' + expiryClass + '"><strong>Expiry:</strong> ' + expiryInfo + '</div>' +
               '<div><strong>Cert File:</strong> ' + cert.certFile + '</div>' +
               '<div><strong>Key File:</strong> ' + (cert.keyFile || 'Missing') + '</div>' +
               '<div><strong>Size:</strong> ' + formatFileSize(cert.size) + '</div>' +
               '<div><strong>Status:</strong> ' + (isArchived ? 'Archived' : 'Active') + '</div>' +
               '</div>' +
               '<div class="certificate-actions">' +
               '<a href="' + API_BASE + '/download/cert/' + folderParam + '/' + cert.certFile + '" ' +
               'class="btn btn-success btn-small" download>' +
               '<i class="fas fa-download"></i> Download Cert</a>' +
               (cert.keyFile ? 
                '<a href="' + API_BASE + '/download/key/' + folderParam + '/' + cert.keyFile + '" ' +
                'class="btn btn-success btn-small" download>' +
                '<i class="fas fa-key"></i> Download Key</a>' : '') +
               '<a href="' + API_BASE + '/download/bundle/' + folderParam + '/' + cert.name + '" ' +
               'class="btn btn-primary btn-small" download>' +
               '<i class="fas fa-file-archive"></i> Download Bundle</a>' +
               (!isRootCert && !isArchived ? 
                '<button onclick="archiveCertificate(\'' + folderParam + '\', \'' + cert.name + '\')" ' +
                'class="btn btn-warning btn-small" title="Archive this certificate">' +
                '<i class="fas fa-archive"></i> Archive</button>' : 
                isArchived ? 
                '<button onclick="restoreCertificate(\'' + folderParam + '\', \'' + cert.name + '\')" ' +
                'class="btn btn-info btn-small" title="Restore certificate from archive">' +
                '<i class="fas fa-undo"></i> Restore</button>' +
                '<button onclick="if(confirm(\'This will permanently delete the certificate. Are you sure?\')) deleteCertificate(\'' + folderParam + '\', \'' + cert.name + '\')" ' +
                'class="btn btn-danger btn-small" title="Permanently delete from archive">' +
                '<i class="fas fa-trash"></i> Delete Forever</button>' : 
                '<span class="btn btn-disabled btn-small" title="Root certificates are read-only">' +
                '<i class="fas fa-lock"></i> Protected</span>') +
               '</div></div>';
    }).join('');
    
    certificatesList.innerHTML = html;
}

// Certificate management functions
async function deleteCertificate(folder, certName) {
    // Check if this is a root certificate
    if (folder === 'root') {
        showAlert('Root certificates are read-only and cannot be deleted', 'error');
        return;
    }
    
    try {
        let endpoint;
        if (folder === 'root') {
            endpoint = '/certificates/' + certName;
        } else {
            endpoint = '/certificates/' + folder + '/' + certName;
        }
        
        await apiRequest(endpoint, {
            method: 'DELETE'
        });
        
        showAlert('Certificate "' + certName + '" deleted permanently', 'success');
        loadCertificates();
    } catch (error) {
        if (error.message.includes('read-only')) {
            showAlert('Root certificates are read-only and cannot be deleted', 'error');
        } else {
            showAlert('Failed to delete certificate: ' + error.message, 'error');
        }
    }
}

async function archiveCertificate(folder, certName) {
    // Check if this is a root certificate
    if (folder === 'root') {
        showAlert('Root certificates are read-only and cannot be archived', 'error');
        return;
    }
    if (!confirm('Are you sure you want to archive the certificate "' + certName + '"?')) {
        return;
    }
    try {
        // Encode folder slashes as underscores for backend
        const folderParam = folder.replace(/\//g, '_');
        const endpoint = '/certificates/' + encodeURIComponent(folderParam) + '/' + encodeURIComponent(certName) + '/archive';
        await apiRequest(endpoint, {
            method: 'POST'
        });
        showAlert('Certificate "' + certName + '" archived successfully', 'success');
        loadCertificates();
    } catch (error) {
        let mainMsg = error.message || error.error || 'Unknown error';
        let msg = 'Failed to archive certificate: ' + mainMsg;
        if (error.checkedCertPaths || error.checkedKeyPaths) {
            msg += '<br><b>Checked Cert Paths:</b><br>' + (error.checkedCertPaths ? error.checkedCertPaths.join('<br>') : 'None');
            msg += '<br><b>Checked Key Paths:</b><br>' + (error.checkedKeyPaths ? error.checkedKeyPaths.join('<br>') : 'None');
        }
        // If no message, show full error object for debugging
        if (!error.message && !error.error) {
            msg += '<br><pre>' + JSON.stringify(error, null, 2) + '</pre>';
        }
        showAlert(msg, 'error');
    }
}

async function restoreCertificate(folder, certName) {
    if (!confirm('Are you sure you want to restore the certificate "' + certName + '"?')) {
        return;
    }
    try {
        // Encode folder slashes as underscores for backend
        const folderParam = folder.replace(/\//g, '_');
        const endpoint = '/certificates/' + encodeURIComponent(folderParam) + '/' + encodeURIComponent(certName) + '/restore';
        await apiRequest(endpoint, {
            method: 'POST'
        });
        showAlert('Certificate "' + certName + '" restored successfully', 'success');
        loadCertificates();
    } catch (error) {
        let mainMsg = error.message || error.error || 'Unknown error';
        let msg = 'Failed to restore certificate: ' + mainMsg;
        if (error.checkedCertPaths || error.checkedKeyPaths) {
            msg += '<br><b>Checked Cert Paths:</b><br>' + (error.checkedCertPaths ? error.checkedCertPaths.join('<br>') : 'None');
            msg += '<br><b>Checked Key Paths:</b><br>' + (error.checkedKeyPaths ? error.checkedKeyPaths.join('<br>') : 'None');
        }
        // If no message, show full error object for debugging
        if (!error.message && !error.error) {
            msg += '<br><pre>' + JSON.stringify(error, null, 2) + '</pre>';
        }
        showAlert(msg, 'error');
    }
}

// CA Installation
async function handleInstallCA() {
    installCaBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Installing...';
    installCaBtn.disabled = true;
    
    try {
        await apiRequest('/install-ca', {
            method: 'POST'
        });
        
        showAlert('Root CA installed successfully', 'success');
        hideModalDialog();
        loadSystemStatus();
    } catch (error) {
        showAlert('Failed to install CA: ' + error.message, 'error');
    } finally {
        installCaBtn.innerHTML = '<i class="fas fa-download"></i> Install CA';
        installCaBtn.disabled = false;
    }
}

// Utility functions
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Alert system
function showAlert(message, type = 'info') {
    const alertId = Date.now();
    
    const alertDiv = document.createElement('div');
    alertDiv.className = 'alert alert-' + type;
    alertDiv.id = 'alert-' + alertId;
    alertDiv.innerHTML = message + 
        '<button onclick="hideAlert(' + alertId + ')" class="alert-close">&times;</button>';
    
    const container = document.querySelector('.alerts-container') || document.body;
    container.appendChild(alertDiv);
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        hideAlert(alertId);
    }, 5000);
}

function hideAlert(alertId) {
    const alert = document.getElementById('alert-' + alertId);
    if (alert) {
        alert.remove();
    }
}
