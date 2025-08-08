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
let themeToggle;
let statusIndicators = {};
let uploadDropzone, fileInput, uploadProgress, uploadResults, fileList;

// Theme management
// Theme management
let currentTheme = localStorage.getItem('theme'); // Don't set default here, let server decide

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', async function() {
    await checkAuthentication();
    initializeElements();
    await initializeTheme();
    loadSystemStatus();
    loadCertificates();
    setupEventListeners();
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
    themeToggle = document.getElementById('theme-toggle');
    
    // Upload elements
    uploadDropzone = document.getElementById('upload-dropzone');
    fileInput = document.getElementById('file-input');
    uploadProgress = document.getElementById('upload-progress');
    uploadResults = document.getElementById('upload-results');
    fileList = document.getElementById('file-list');
    
    // Debug: Check if upload elements are found
    console.log('Upload elements found:', {
        uploadDropzone: !!uploadDropzone,
        fileInput: !!fileInput,
        uploadProgress: !!uploadProgress,
        uploadResults: !!uploadResults,
        fileList: !!fileList
    });
    
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
    
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
    
    // Upload event listeners
    setupUploadEventListeners();
    
    // Add logout button event listener
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
}

// Load system status
async function loadSystemStatus() {
    try {
        console.log('Loading system status...');
        const status = await apiRequest('/status');
        console.log('System status received:', { caExists: status.caExists, autoGenerated: status.autoGenerated });
        
        // Show notification if CA was auto-generated
        if (status.autoGenerated) {
            showAlert(
                '<strong>Root CA Auto-Generated!</strong><br>' +
                'A new Root Certificate Authority was automatically created and installed.<br>' +
                '<em>Location:</em> ' + (status.caRoot || 'Default location'),
                'success'
            );
        }
        
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
            (status.autoGenerated ? '<span class="auto-generated-badge"><i class="fas fa-magic"></i> Auto-generated</span>' : '') +
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
            console.log('CA exists, loading Root CA info...');
            await loadRootCAInfo();
        } else {
            console.log('CA does not exist, showing manual generation option...');
            // Show manual generation option if auto-generation failed
            showManualCAGeneration();
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
            '<button onclick="downloadRootCA()" class="btn btn-success">' +
            '<i class="fas fa-download"></i> Download Root CA' +
            '</button>' +
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
            // Add highlight effect to show the section was updated
            rootCAInfo.classList.add('ca-updated');
            setTimeout(() => {
                rootCAInfo.classList.remove('ca-updated');
            }, 3000);
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
        // Truncate domains list if too long
        let domainsDisplay = cert.domains ? cert.domains.join(', ') : 'Unknown';
        if (domainsDisplay.length > 100) {
            const truncated = domainsDisplay.substring(0, 97) + '...';
            domainsDisplay = `<span title="${domainsDisplay}">${truncated}</span>`;
        }
        
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
        const folderParam = cert.folder === 'root' ? 'root' : encodeURIComponent(cert.folder); // URL encode the folder path
        const isRootCert = cert.folder === 'root';
        const isArchived = cert.isArchived || false;
        const isRootCA = cert.name === 'mkcert-rootCA' || cert.certFile === 'mkcert-rootCA.pem';
        
        return '<div class="certificate-card ' + 
               (cert.isExpired ? 'certificate-expired' : '') + ' ' +
               (isRootCert ? 'root-certificate' : '') + ' ' +
               (isRootCA ? 'root-ca-certificate' : '') + ' ' +
               (isArchived ? 'archived-certificate' : '') + '">' +
               '<div class="certificate-header">' +
               '<div class="certificate-name">' +
               '<i class="fas fa-' + (isRootCA ? 'shield-alt' : 'certificate') + '"></i> ' + cert.name +
               (isRootCA ? ' <span class="root-ca-title">(Root Certificate Authority)</span>' : '') +
               '</div>' +
               '<div class="certificate-badges">' +
               formatBadge +
               (cert.isExpired ? '<span class="expired-badge">EXPIRED</span>' : '') +
               (isRootCA ? '<span class="root-ca-badge">ROOT CA</span>' : '') +
               (isRootCert && !isRootCA ? '<span class="read-only-badge">READ-ONLY</span>' : '') +
               (isArchived ? '<span class="archived-badge">ARCHIVED</span>' : '') +
               '</div>' +
               '</div>' +
               '<div class="certificate-info">' +
               '<div><strong>Domains:</strong><br>' + domainsDisplay + '</div>' +
               '<div><strong>Location:</strong><br>' + folderDisplay + '</div>' +
               '<div><strong>Created:</strong><br>' + createdDate + ' ' + createdTime + '</div>' +
               '<div class="' + expiryClass + '"><strong>Expiry:</strong><br>' + expiryInfo + '</div>' +
               '<div><strong>Certificate File:</strong><div class="file-name">' + cert.certFile + '</div></div>' +
               '<div><strong>Private Key File:</strong><div class="file-name">' + (cert.keyFile || '<em>Missing</em>') + '</div></div>' +
               '<div><strong>File Size:</strong><br>' + formatFileSize(cert.size) + '</div>' +
               '<div><strong>Status:</strong><br>' + (isArchived ? 'Archived' : 'Active') + '</div>' +
               '</div>' +
               (isRootCA ? 
                '<div class="root-ca-description">' +
                '<h4><i class="fas fa-info-circle"></i> Root Certificate Authority</h4>' +
                '<p>This is your mkcert Root CA certificate. Install this certificate in your system\'s trust store to enable local HTTPS development with automatically trusted certificates.</p>' +
                '<p><strong>Installation:</strong> Download and install this certificate to trust all mkcert-generated certificates on this system.</p>' +
                '</div>' : '') +
               '<div class="certificate-actions">' +
               '<button onclick="downloadCert(\'' + folderParam + '\', \'' + cert.certFile + '\')" ' +
               'class="btn btn-success btn-small">' +
               '<i class="fas fa-download"></i> Download Cert</button>' +
               (cert.keyFile ? 
                '<button onclick="downloadKey(\'' + folderParam + '\', \'' + cert.keyFile + '\')" ' +
                'class="btn btn-success btn-small">' +
                '<i class="fas fa-key"></i> Download Key</button>' : '') +
               '<button onclick="downloadBundle(\'' + folderParam + '\', \'' + cert.name + '\')" ' +
               'class="btn btn-primary btn-small">' +
               '<i class="fas fa-file-archive"></i> Download Bundle</button>' +
               (cert.keyFile && !isRootCert ? 
                '<button onclick="testPFX(\'' + folderParam + '\', \'' + cert.name + '\')" ' +
                'class="btn btn-windows btn-small" title="Generate password-protected PFX file">' +
                '<i class="fas fa-shield-alt"></i> Generate PFX</button>' : '') +
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
        // Encode folder for URL path
        const folderParam = encodeURIComponent(folder);
        const endpoint = '/certificates/' + folderParam + '/' + encodeURIComponent(certName) + '/archive';
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
        // Encode folder for URL path
        const folderParam = encodeURIComponent(folder);
        const endpoint = '/certificates/' + folderParam + '/' + encodeURIComponent(certName) + '/restore';
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

// Show manual CA generation option
function showManualCAGeneration() {
    const rootCASection = document.getElementById('rootca-section');
    if (rootCASection) {
        rootCASection.style.display = 'block';
        
        const rootCAInfo = document.getElementById('rootca-info');
        if (rootCAInfo) {
            rootCAInfo.innerHTML = 
                '<div class="ca-missing-info">' +
                '<div class="warning-message">' +
                '<i class="fas fa-exclamation-triangle"></i>' +
                '<h3>Root CA Not Found</h3>' +
                '<p>A Root Certificate Authority (CA) is required to generate SSL certificates. You can generate one now.</p>' +
                '</div>' +
                '<div class="ca-generation-actions">' +
                '<button id="generate-ca-btn" class="btn btn-primary">' +
                '<i class="fas fa-magic"></i> Generate Root CA' +
                '</button>' +
                '<div class="ca-info-text">' +
                '<p><strong>What this does:</strong></p>' +
                '<ul>' +
                '<li>Creates a new Root Certificate Authority</li>' +
                '<li>Installs it in your system trust store</li>' +
                '<li>Enables certificate generation for local development</li>' +
                '</ul>' +
                '</div>' +
                '</div>' +
                '</div>';
            
            // Attach event listener for generate CA button
            const generateBtn = document.getElementById('generate-ca-btn');
            if (generateBtn) {
                generateBtn.addEventListener('click', handleGenerateCA);
            }
        }
    }
}

// Handle manual CA generation
async function handleGenerateCA() {
    const generateBtn = document.getElementById('generate-ca-btn');
    const rootCAInfo = document.getElementById('rootca-info');
    
    if (generateBtn) {
        generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating Root CA...';
        generateBtn.disabled = true;
    }
    
    // Show progress indicator in the Root CA section
    if (rootCAInfo) {
        rootCAInfo.innerHTML = 
            '<div class="ca-generation-progress">' +
            '<div class="progress-indicator">' +
            '<i class="fas fa-spinner fa-spin fa-2x"></i>' +
            '<h3>Generating Root Certificate Authority...</h3>' +
            '<p>Please wait while we create your new Root CA. This may take a few moments.</p>' +
            '<div class="progress-steps">' +
            '<div class="step active">Creating CA certificate</div>' +
            '<div class="step">Installing in system trust store</div>' +
            '<div class="step">Configuring for certificate generation</div>' +
            '</div>' +
            '</div>' +
            '</div>';
    }
    
    try {
        const result = await apiRequest('/generate-ca', {
            method: 'POST'
        });
        
        if (result.success) {
            // Show immediate success notification
            showAlert(result.message, 'success');
            
            // Update progress indicator to show completion
            if (rootCAInfo) {
                rootCAInfo.innerHTML = 
                    '<div class="ca-generation-progress">' +
                    '<div class="progress-indicator success">' +
                    '<i class="fas fa-check-circle fa-2x"></i>' +
                    '<h3>Root CA Generated Successfully!</h3>' +
                    '<p>Loading certificate details...</p>' +
                    '</div>' +
                    '</div>';
            }
            
            // Force reload the system status to check if CA was created
            console.log('CA generation completed, refreshing system status...');
            await loadSystemStatus();
            
            // Double-check by making another status call after a brief delay
            setTimeout(async () => {
                console.log('Secondary status refresh after CA generation...');
                await loadSystemStatus();
                
                // Show detailed success message
                let successMessage = 
                    '<strong>Root CA Generated Successfully!</strong><br>' +
                    'Your new Root Certificate Authority is now ready to generate SSL certificates.<br>' +
                    '<em>CA Root Path:</em> ' + (result.caRoot || 'Default location');
                
                if (result.caCopiedToPublic) {
                    successMessage += '<br><strong>✓ CA Certificate copied to public download area</strong><br>' +
                        '<em>Available for download in the certificates list</em>';
                }
                
                if (result.caInfo && result.caInfo.expiry) {
                    successMessage += '<br><em>Valid Until:</em> ' + new Date(result.caInfo.expiry).toLocaleDateString();
                }
                
                showAlert(successMessage, 'success');
                
                // Scroll to the Root CA section to show the new information
                const rootCASection = document.getElementById('rootca-section');
                if (rootCASection) {
                    rootCASection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
                
                // Also refresh the certificates list to show the public CA copy
                await loadCertificates();
                
            }, 2000); // Increased delay to 2 seconds to ensure backend processing is complete
            
        } else {
            // Show error in the Root CA section
            if (rootCAInfo) {
                rootCAInfo.innerHTML = 
                    '<div class="ca-generation-error">' +
                    '<div class="error-indicator">' +
                    '<i class="fas fa-times-circle fa-2x"></i>' +
                    '<h3>Root CA Generation Failed</h3>' +
                    '<p>Error: ' + result.error + '</p>' +
                    '<button id="retry-generate-ca-btn" class="btn btn-primary">' +
                    '<i class="fas fa-redo"></i> Try Again' +
                    '</button>' +
                    '</div>' +
                    '</div>';
                
                // Attach retry event listener
                const retryBtn = document.getElementById('retry-generate-ca-btn');
                if (retryBtn) {
                    retryBtn.addEventListener('click', handleGenerateCA);
                }
            }
            showAlert('Failed to generate CA: ' + result.error, 'error');
        }
    } catch (error) {
        // Show error in the Root CA section
        if (rootCAInfo) {
            rootCAInfo.innerHTML = 
                '<div class="ca-generation-error">' +
                '<div class="error-indicator">' +
                '<i class="fas fa-times-circle fa-2x"></i>' +
                '<h3>Root CA Generation Failed</h3>' +
                '<p>Error: ' + error.message + '</p>' +
                '<button id="retry-generate-ca-btn" class="btn btn-primary">' +
                '<i class="fas fa-redo"></i> Try Again' +
                '</button>' +
                '</div>' +
                '</div>';
            
            // Attach retry event listener
            const retryBtn = document.getElementById('retry-generate-ca-btn');
            if (retryBtn) {
                retryBtn.addEventListener('click', handleGenerateCA);
            }
        }
        showAlert('Failed to generate CA: ' + error.message, 'error');
    } finally {
        if (generateBtn) {
            generateBtn.innerHTML = '<i class="fas fa-magic"></i> Generate Root CA';
            generateBtn.disabled = false;
        }
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
        
        // Add a small delay and retry mechanism to ensure CA installation is reflected
        await waitForCAInstallation();
    } catch (error) {
        showAlert('Failed to install CA: ' + error.message, 'error');
    } finally {
        installCaBtn.innerHTML = '<i class="fas fa-download"></i> Install CA';
        installCaBtn.disabled = false;
    }
}

// Helper function to wait for CA installation to be reflected in status
async function waitForCAInstallation(maxRetries = 5, delay = 500) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            // Wait a bit before checking
            await new Promise(resolve => setTimeout(resolve, delay));
            
            // Check if CA now exists
            const status = await apiRequest('/status');
            if (status.caExists) {
                // CA is now available, reload the status
                await loadSystemStatus();
                return;
            }
            
            // Double the delay for next attempt (exponential backoff)
            delay *= 1.5;
        } catch (error) {
            console.warn(`Attempt ${i + 1} to check CA status failed:`, error);
        }
    }
    
    // If we get here, fallback to loading status anyway
    console.warn('CA status check retries exhausted, loading status anyway');
    await loadSystemStatus();
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

// Certificate Upload Functionality
function setupUploadEventListeners() {
    console.log('Setting up upload event listeners...', { uploadDropzone: !!uploadDropzone, fileInput: !!fileInput });
    
    if (!uploadDropzone || !fileInput) {
        console.warn('Upload elements not found, skipping setup');
        return;
    }
    
    console.log('Upload elements found, setting up listeners...');
    
    // Click to select files
    uploadDropzone.addEventListener('click', () => {
        fileInput.click();
    });
    
    // File input change
    fileInput.addEventListener('change', handleFileSelect);
    
    // Drag and drop events
    uploadDropzone.addEventListener('dragover', handleDragOver);
    uploadDropzone.addEventListener('dragenter', handleDragEnter);
    uploadDropzone.addEventListener('dragleave', handleDragLeave);
    uploadDropzone.addEventListener('drop', handleDrop);
    
    // Prevent default drag behaviors on the document
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());
}

function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    uploadDropzone.classList.add('dragover');
}

function handleDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
    uploadDropzone.classList.add('dragover');
}

function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    
    // Only remove dragover if we're leaving the dropzone entirely
    if (!uploadDropzone.contains(e.relatedTarget)) {
        uploadDropzone.classList.remove('dragover');
    }
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    uploadDropzone.classList.remove('dragover');
    
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
}

function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    handleFiles(files);
}

function handleFiles(files) {
    if (files.length === 0) return;
    
    // Filter valid files
    const validExtensions = ['.pem', '.crt', '.key', '.cer', '.p7b', '.p7c', '.pfx', '.p12'];
    const validFiles = files.filter(file => {
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        return validExtensions.includes(ext);
    });
    
    const invalidFiles = files.filter(file => {
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        return !validExtensions.includes(ext);
    });
    
    if (invalidFiles.length > 0) {
        showAlert(
            `Skipped ${invalidFiles.length} invalid file(s). Only certificate and key files are allowed.`,
            'warning'
        );
    }
    
    if (validFiles.length === 0) {
        showAlert('No valid certificate files selected.', 'error');
        return;
    }
    
    // Show file list
    displayFileList(validFiles);
    
    // Upload files
    uploadFiles(validFiles);
}

function displayFileList(files) {
    if (!fileList) return;
    
    fileList.innerHTML = '';
    files.forEach(file => {
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        const isKey = file.name.includes('-key') || file.name.includes('.key') || ext === '.key';
        const isCert = ['.pem', '.crt', '.cer'].includes(ext) && !isKey;
        
        let icon, type;
        if (isCert) {
            icon = 'certificate';
            type = 'Certificate';
        } else if (isKey) {
            icon = 'key';
            type = 'Private Key';
        } else {
            icon = 'file-alt';
            type = 'Certificate File';
        }
        
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.innerHTML = `
            <div class="file-info">
                <i class="fas fa-${icon} file-icon"></i>
                <span class="file-name">${file.name}</span>
                <span class="file-size">(${formatFileSize(file.size)})</span>
            </div>
            <div class="file-status" data-file="${file.name}">
                <i class="fas fa-clock"></i>
                <span>Pending</span>
            </div>
        `;
        fileList.appendChild(fileItem);
    });
}

async function uploadFiles(files) {
    if (!files || files.length === 0) return;
    
    // Show progress
    if (uploadProgress) {
        uploadProgress.classList.add('visible');
        updateProgress(0, 'Preparing upload...');
    }
    
    // Clear previous results
    if (uploadResults) {
        uploadResults.classList.remove('visible');
        uploadResults.innerHTML = '';
    }
    
    try {
        const formData = new FormData();
        files.forEach(file => {
            formData.append('certificates', file);
        });
        
        // Update progress
        updateProgress(25, 'Uploading files...');
        
        const response = await fetch('/api/certificates/upload', {
            method: 'POST',
            body: formData,
            credentials: 'same-origin'
        });
        
        updateProgress(75, 'Processing files...');
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Upload failed: ${response.status} ${response.statusText}`);
        }
        
        const result = await response.json();
        updateProgress(100, 'Upload complete!');
        
        // Hide progress after a moment
        setTimeout(() => {
            if (uploadProgress) {
                uploadProgress.classList.remove('visible');
            }
        }, 1500);
        
        // Update file statuses
        updateFileStatuses(result);
        
        // Show results
        displayUploadResults(result);
        
        // Refresh certificates list
        if (result.success && result.completePairs > 0) {
            setTimeout(() => {
                loadCertificates();
            }, 1000);
        }
        
        // Clear file input
        if (fileInput) {
            fileInput.value = '';
        }
        
    } catch (error) {
        console.error('Upload error:', error);
        
        // Hide progress
        if (uploadProgress) {
            uploadProgress.classList.remove('visible');
        }
        
        // Update all file statuses to error
        const fileStatuses = document.querySelectorAll('.file-status');
        fileStatuses.forEach(status => {
            status.className = 'file-status error';
            status.innerHTML = '<i class="fas fa-times"></i><span>Failed</span>';
        });
        
        showAlert('Upload failed: ' + error.message, 'error');
    }
}

function updateProgress(percent, text) {
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    
    if (progressFill) {
        progressFill.style.width = `${percent}%`;
    }
    
    if (progressText) {
        progressText.textContent = text;
    }
}

function updateFileStatuses(result) {
    const fileStatuses = document.querySelectorAll('.file-status');
    
    // Mark all as success initially
    fileStatuses.forEach(status => {
        status.className = 'file-status success';
        status.innerHTML = '<i class="fas fa-check"></i><span>Uploaded</span>';
    });
    
    // Update specific files with errors if any
    if (result.errors && result.errors.length > 0) {
        result.errors.forEach(error => {
            // Try to match error to specific files (basic matching)
            fileStatuses.forEach(status => {
                const fileName = status.getAttribute('data-file');
                if (error.includes(fileName)) {
                    status.className = 'file-status error';
                    status.innerHTML = '<i class="fas fa-times"></i><span>Error</span>';
                }
            });
        });
    }
    
    // Mark incomplete pairs as warnings
    if (result.incompletePairs && result.incompletePairs.length > 0) {
        result.incompletePairs.forEach(incomplete => {
            fileStatuses.forEach(status => {
                const fileName = status.getAttribute('data-file');
                if (fileName.includes(incomplete.certName)) {
                    status.className = 'file-status warning';
                    status.innerHTML = `<i class="fas fa-exclamation-triangle"></i><span>Missing ${incomplete.missing}</span>`;
                }
            });
        });
    }
}

function displayUploadResults(result) {
    if (!uploadResults) return;
    
    let html = '';
    
    if (result.success && result.completePairs > 0) {
        html += `
            <div class="upload-success">
                <i class="fas fa-check-circle"></i>
                <strong>Success!</strong> Uploaded ${result.completePairs} certificate pair(s) to the "uploaded" folder.
            </div>
        `;
    }
    
    if (result.incompletePairs && result.incompletePairs.length > 0) {
        html += `
            <div class="upload-warning">
                <i class="fas fa-exclamation-triangle"></i>
                <strong>Incomplete Pairs:</strong> ${result.incompletePairs.length} file(s) are missing their certificate or key pair.
                <ul style="margin-top: 0.5rem; margin-left: 1rem;">
                    ${result.incompletePairs.map(pair => 
                        `<li>${pair.certName}: Missing ${pair.missing} (has: ${pair.hasFile})</li>`
                    ).join('')}
                </ul>
            </div>
        `;
    }
    
    if (result.errors && result.errors.length > 0) {
        html += `
            <div class="upload-error">
                <i class="fas fa-times-circle"></i>
                <strong>Errors:</strong>
                <ul style="margin-top: 0.5rem; margin-left: 1rem;">
                    ${result.errors.map(error => `<li>${error}</li>`).join('')}
                </ul>
            </div>
        `;
    }
    
    if (!result.success && (!result.errors || result.errors.length === 0)) {
        html += `
            <div class="upload-error">
                <i class="fas fa-times-circle"></i>
                <strong>Upload failed:</strong> No files were successfully processed.
            </div>
        `;
    }
    
    uploadResults.innerHTML = html;
    uploadResults.classList.add('visible');
    
    // Auto-hide results after 10 seconds
    setTimeout(() => {
        if (uploadResults) {
            uploadResults.classList.remove('visible');
        }
    }, 10000);
}

// Theme management functions
async function initializeTheme() {
    // If no stored preference, get default from server
    if (!localStorage.getItem('theme')) {
        try {
            const config = await apiRequest('/config/theme');
            currentTheme = config.defaultTheme || 'dark';
        } catch (error) {
            console.warn('Failed to fetch default theme config, using dark mode:', error);
            currentTheme = 'dark';
        }
    }
    
    // Set theme based on stored preference or server default
    document.documentElement.setAttribute('data-theme', currentTheme);
    updateThemeToggleButton();
}

function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);
    localStorage.setItem('theme', currentTheme);
    updateThemeToggleButton();
}

function updateThemeToggleButton() {
    if (themeToggle) {
        const icon = themeToggle.querySelector('i');
        const text = themeToggle.childNodes[themeToggle.childNodes.length - 1];
        
        if (currentTheme === 'dark') {
            icon.className = 'fas fa-sun';
            text.textContent = ' Light Mode';
        } else {
            icon.className = 'fas fa-moon';
            text.textContent = ' Dark Mode';
        }
    }
}

// Download functions for authenticated file downloads
async function downloadFile(url, filename) {
    try {
        const response = await fetch(url, {
            method: 'GET',
            credentials: 'same-origin' // Include session cookies
        });
        
        if (!response.ok) {
            throw new Error(`Download failed: ${response.status} ${response.statusText}`);
        }
        
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
        console.error('Download error:', error);
        showAlert('Download failed: ' + error.message, 'error');
    }
}

function downloadCert(folderParam, filename) {
    const url = API_BASE + '/download/cert/' + folderParam + '/' + filename;
    downloadFile(url, filename);
}

function downloadKey(folderParam, filename) {
    const url = API_BASE + '/download/key/' + folderParam + '/' + filename;
    downloadFile(url, filename);
}

function downloadBundle(folderParam, certname) {
    const url = API_BASE + '/download/bundle/' + folderParam + '/' + certname;
    downloadFile(url, certname + '.zip');
}

function downloadRootCA() {
    const url = API_BASE + '/download/rootca';
    downloadFile(url, 'mkcert-rootCA.pem');
}

function testPFX(folderParam, certname) {
    generatePFX(folderParam, certname);
}

async function generatePFX(folderParam, certname) {
    console.log('generatePFX called with:', folderParam, certname);
    
    // Create a modal for password input
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'block'; // Show the modal
    modal.innerHTML = `
        <div class="modal-content">
            <h3><i class="fas fa-shield-alt"></i> Generate PFX File</h3>
            <p>Enter a password to protect the PFX file. This file will contain both the certificate and private key.</p>
            <div class="form-group">
                <label for="pfx-password">Password (optional):</label>
                <input type="password" id="pfx-password" placeholder="Leave empty for no password protection" />
                <small class="help-text">Strong passwords are recommended for security.</small>
            </div>
            <div class="modal-actions">
                <button id="generate-pfx-btn" class="btn btn-primary">
                    <i class="fas fa-cog"></i> Generate PFX
                </button>
                <button id="cancel-pfx-btn" class="btn btn-secondary">Cancel</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    console.log('Modal created and added to DOM');
    
    // Focus on password input
    const passwordInput = document.getElementById('pfx-password');
    passwordInput.focus();
    
    return new Promise((resolve, reject) => {
        const generateBtn = document.getElementById('generate-pfx-btn');
        const cancelBtn = document.getElementById('cancel-pfx-btn');
        
        const cleanup = () => {
            document.body.removeChild(modal);
        };
        
        const handleGenerate = async () => {
            console.log('Generate button clicked!');
            const password = passwordInput.value;
            console.log('Password entered:', password ? 'Yes' : 'No');
            generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
            generateBtn.disabled = true;
            
            try {
                console.log('Making API request...');
                const apiUrl = API_BASE + '/generate/pfx/' + folderParam + '/' + encodeURIComponent(certname);
                console.log('API URL:', apiUrl);
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    credentials: 'same-origin',
                    body: JSON.stringify({ password: password || '' })
                });
                
                console.log('Response status:', response.status);
                if (!response.ok) {
                    const errorData = await response.json();
                    console.error('Server error:', errorData);
                    throw new Error(errorData.error || `PFX generation failed: ${response.status} ${response.statusText}`);
                }
                
                console.log('Downloading blob...');
                const blob = await response.blob();
                console.log('Blob size:', blob.size);
                const downloadUrl = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download = certname + '.pfx';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(downloadUrl);
                
                showAlert('PFX file generated and downloaded successfully', 'success');
                cleanup();
                resolve();
            } catch (error) {
                console.error('PFX generation error:', error);
                showAlert('PFX generation failed: ' + error.message, 'error');
                generateBtn.innerHTML = '<i class="fas fa-cog"></i> Generate PFX';
                generateBtn.disabled = false;
                reject(error);
            }
        };
        
        const handleCancel = () => {
            cleanup();
            resolve();
        };
        
        generateBtn.addEventListener('click', handleGenerate);
        cancelBtn.addEventListener('click', handleCancel);
        
        console.log('Event listeners attached to buttons');
        
        // Allow Enter to trigger generation
        passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleGenerate();
            }
        });
        
        // Allow Escape to cancel
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                handleCancel();
            }
        });
    });
}
