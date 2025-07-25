// mkcert Web UI - Frontend JavaScript
// Fixed version with proper template literal handling

// Configuration
const API_BASE = window.location.origin + '/api';

// DOM Elements
let certificatesList, generateForm, domainsInput, formatSelect;
let installCaBtn, showCaBtn, hideModal, caModal;
let statusIndicators = {};

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    initializeElements();
    loadSystemStatus();
    loadCertificates();
    setupEventListeners();
});

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
            throw new Error(error.error || 'Request failed');
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
}

// Load system status
async function loadSystemStatus() {
    try {
        const status = await apiRequest('/status');
        
        updateStatusIndicator('mkcert', status.mkcertInstalled, 'mkcert installed');
        updateStatusIndicator('ca', status.caExists, 'Root CA exists');
        updateStatusIndicator('openssl', status.opensslAvailable, 'OpenSSL available');
        
    } catch (error) {
        console.error('Failed to load system status:', error);
        updateStatusIndicator('mkcert', false, 'Failed to check mkcert');
        updateStatusIndicator('ca', false, 'Failed to check CA');
        updateStatusIndicator('openssl', false, 'Failed to check OpenSSL');
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
        const certificates = await apiRequest('/certificates');
        displayCertificates(certificates);
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
        if (cert.expiry) {
            const expiryDateStr = new Date(cert.expiry).toLocaleDateString();
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
        const folderParam = cert.folder.replace(/[/\\]/g, '_');
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
        const endpoint = '/archive/' + folder + '/' + certName;
        await apiRequest(endpoint, {
            method: 'POST'
        });
        
        showAlert('Certificate "' + certName + '" archived successfully', 'success');
        loadCertificates();
    } catch (error) {
        showAlert('Failed to archive certificate: ' + error.message, 'error');
    }
}

async function restoreCertificate(folder, certName) {
    if (!confirm('Are you sure you want to restore the certificate "' + certName + '"?')) {
        return;
    }
    
    try {
        const endpoint = '/restore/' + folder + '/' + certName;
        await apiRequest(endpoint, {
            method: 'POST'
        });
        
        showAlert('Certificate "' + certName + '" restored successfully', 'success');
        loadCertificates();
    } catch (error) {
        showAlert('Failed to restore certificate: ' + error.message, 'error');
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
