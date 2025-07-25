// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const archiver = require('archiver');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const ENABLE_HTTPS = process.env.ENABLE_HTTPS === 'true' || process.env.ENABLE_HTTPS === '1';
const SSL_DOMAIN = process.env.SSL_DOMAIN || 'localhost';
const FORCE_HTTPS = process.env.FORCE_HTTPS === 'true' || process.env.FORCE_HTTPS === '1';

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Certificate storage directory
const CERT_DIR = path.join(__dirname, 'certificates');

// Ensure certificates directory exists
fs.ensureDirSync(CERT_DIR);

// Helper function to execute shell commands
const executeCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject({ error: error.message, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
};

// Routes

// Get mkcert status and CA info
app.get('/api/status', async (req, res) => {
  try {
    const result = await executeCommand('mkcert -CAROOT');
    const caRoot = result.stdout.trim();
    
    // Check if CA exists
    const caKeyPath = path.join(caRoot, 'rootCA-key.pem');
    const caCertPath = path.join(caRoot, 'rootCA.pem');
    
    const caExists = await fs.pathExists(caKeyPath) && await fs.pathExists(caCertPath);
    
    // Check if OpenSSL is available
    let opensslAvailable = false;
    try {
      await executeCommand('openssl version');
      opensslAvailable = true;
    } catch (opensslError) {
      opensslAvailable = false;
    }
    
    res.json({
      success: true,
      caRoot,
      caExists,
      caCertPath: caExists ? caCertPath : null,
      mkcertInstalled: true,
      opensslAvailable
    });
  } catch (error) {
    res.json({
      success: false,
      mkcertInstalled: false,
      error: 'mkcert not found or not installed'
    });
  }
});

// Install CA (mkcert -install)
app.post('/api/install-ca', async (req, res) => {
  try {
    const result = await executeCommand('mkcert -install');
    res.json({
      success: true,
      message: 'CA installed successfully',
      output: result.stdout
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.error,
      details: error.stderr
    });
  }
});

// Download root CA certificate
app.get('/api/download/rootca', async (req, res) => {
  try {
    const result = await executeCommand('mkcert -CAROOT');
    const caRoot = result.stdout.trim();
    const caCertPath = path.join(caRoot, 'rootCA.pem');
    
    if (!await fs.pathExists(caCertPath)) {
      return res.status(404).json({
        success: false,
        error: 'Root CA certificate not found. Please install CA first.'
      });
    }
    
    // Read CA certificate to get information
    let caInfo = {};
    try {
      const caResult = await executeCommand(`openssl x509 -in "${caCertPath}" -noout -subject -issuer -dates`);
      caInfo.details = caResult.stdout;
      
      // Extract expiry date
      const expiryMatch = caResult.stdout.match(/notAfter=(.+)/);
      if (expiryMatch) {
        caInfo.expiry = new Date(expiryMatch[1]);
      }
    } catch (error) {
      console.error('Error reading CA info:', error);
    }
    
    // Set appropriate headers
    res.setHeader('Content-Type', 'application/x-pem-file');
    res.setHeader('Content-Disposition', 'attachment; filename="mkcert-rootCA.pem"');
    
    // Send the CA certificate file
    res.sendFile(caCertPath);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.error || error.message,
      details: error.stderr
    });
  }
});

// Get root CA information
app.get('/api/rootca/info', async (req, res) => {
  try {
    const result = await executeCommand('mkcert -CAROOT');
    const caRoot = result.stdout.trim();
    const caCertPath = path.join(caRoot, 'rootCA.pem');
    
    if (!await fs.pathExists(caCertPath)) {
      return res.status(404).json({
        success: false,
        error: 'Root CA certificate not found. Please install CA first.'
      });
    }
    
    // Get CA certificate information
    const caResult = await executeCommand(`openssl x509 -in "${caCertPath}" -noout -text`);
    const certInfo = caResult.stdout;
    
    // Extract specific information
    const subjectMatch = certInfo.match(/Subject: (.+)/);
    const issuerMatch = certInfo.match(/Issuer: (.+)/);
    const serialMatch = certInfo.match(/Serial Number:\s*\n\s*([^\n]+)/);
    const validFromMatch = certInfo.match(/Not Before: (.+)/);
    const validToMatch = certInfo.match(/Not After : (.+)/);
    const fingerprintResult = await executeCommand(`openssl x509 -in "${caCertPath}" -noout -fingerprint -sha256`);
    const fingerprintMatch = fingerprintResult.stdout.match(/sha256 Fingerprint=(.+)/i);
    
    // Calculate days until expiry
    let daysUntilExpiry = null;
    let isExpired = false;
    if (validToMatch) {
      const expiry = new Date(validToMatch[1]);
      const now = new Date();
      const timeDiff = expiry.getTime() - now.getTime();
      daysUntilExpiry = Math.ceil(timeDiff / (1000 * 3600 * 24));
      isExpired = daysUntilExpiry < 0;
    }
    
    res.json({
      success: true,
      caInfo: {
        path: caCertPath,
        subject: subjectMatch ? subjectMatch[1].trim() : 'Unknown',
        issuer: issuerMatch ? issuerMatch[1].trim() : 'Unknown',
        serial: serialMatch ? serialMatch[1].trim() : 'Unknown',
        validFrom: validFromMatch ? validFromMatch[1].trim() : 'Unknown',
        validTo: validToMatch ? validToMatch[1].trim() : 'Unknown',
        fingerprint: fingerprintMatch ? fingerprintMatch[1].trim() : 'Unknown',
        daysUntilExpiry,
        isExpired,
        isInstalled: true
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.error || error.message,
      details: error.stderr
    });
  }
});

// Generate certificate
app.post('/api/generate', async (req, res) => {
  try {
    const { domains, format = 'pem' } = req.body;
    
    if (!domains || !Array.isArray(domains) || domains.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Domains array is required'
      });
    }

    // Validate format
    const validFormats = ['pem', 'crt'];
    if (!validFormats.includes(format)) {
      return res.status(400).json({
        success: false,
        error: 'Format must be either "pem" or "crt"'
      });
    }

    // Create organized subfolder with timestamp
    const now = new Date();
    const timestamp = now.toISOString().slice(0, 19).replace(/:/g, '-'); // YYYY-MM-DDTHH-MM-SS
    const dateFolder = now.toISOString().slice(0, 10); // YYYY-MM-DD
    
    // Sanitize domain names for filename
    const sanitizedDomains = domains.map(domain => domain.replace(/[^\w.-]/g, '_'));
    const certName = sanitizedDomains.join('_');
    
    // Create subfolder: certificates/YYYY-MM-DD/YYYY-MM-DDTHH-MM-SS_domainname/
    const subfolderName = `${timestamp}_${certName}`;
    const certSubDir = path.join(CERT_DIR, dateFolder, subfolderName);
    
    // Ensure subfolder exists
    await fs.ensureDir(certSubDir);
    
    // Set file extensions based on format
    const certExt = format === 'crt' ? '.crt' : '.pem';
    const keyExt = format === 'crt' ? '.key' : '-key.pem';
    
    const certPath = path.join(certSubDir, `${certName}${certExt}`);
    const keyPath = path.join(certSubDir, `${certName}${keyExt}`);

    // Build mkcert command
    const domainsArg = domains.join(' ');
    const command = `cd "${certSubDir}" && mkcert -cert-file "${certName}${certExt}" -key-file "${certName}${keyExt}" ${domainsArg}`;
    
    const result = await executeCommand(command);
    
    // Verify files were created
    const certExists = await fs.pathExists(certPath);
    const keyExists = await fs.pathExists(keyPath);
    
    if (certExists && keyExists) {
      res.json({
        success: true,
        message: 'Certificate generated successfully',
        certFile: `${certName}${certExt}`,
        keyFile: `${certName}${keyExt}`,
        folder: `${dateFolder}/${subfolderName}`,
        format,
        domains,
        output: result.stdout
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Certificate files were not created'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.error,
      details: error.stderr
    });
  }
});

// Helper function to get certificate expiry date
const getCertificateExpiry = async (certPath) => {
  try {
    const result = await executeCommand(`openssl x509 -in "${certPath}" -noout -enddate`);
    // Parse output like "notAfter=Jan 25 12:34:56 2026 GMT"
    const match = result.stdout.match(/notAfter=(.+)/);
    if (match) {
      return new Date(match[1]);
    }
    return null;
  } catch (error) {
    console.error('Error getting certificate expiry:', error);
    return null;
  }
};

// Helper function to get certificate domains
const getCertificateDomains = async (certPath) => {
  try {
    const result = await executeCommand(`openssl x509 -in "${certPath}" -noout -text`);
    const domains = [];
    
    // Extract Common Name
    const cnMatch = result.stdout.match(/Subject:.*CN\s*=\s*([^,\n]+)/);
    if (cnMatch) {
      domains.push(cnMatch[1].trim());
    }
    
    // Extract Subject Alternative Names
    const sanMatch = result.stdout.match(/X509v3 Subject Alternative Name:\s*\n\s*([^\n]+)/);
    if (sanMatch) {
      const sanDomains = sanMatch[1].split(',').map(san => {
        const match = san.trim().match(/DNS:(.+)/);
        return match ? match[1] : null;
      }).filter(Boolean);
      domains.push(...sanDomains);
    }
    
    // Remove duplicates and return
    return [...new Set(domains)];
  } catch (error) {
    console.error('Error getting certificate domains:', error);
    return [];
  }
};

// Helper function to recursively find all certificate files
const findAllCertificateFiles = async (dir, relativePath = '') => {
  const files = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativeFilePath = path.join(relativePath, entry.name);
    
    if (entry.isDirectory()) {
      // Recursively scan subdirectories
      const subFiles = await findAllCertificateFiles(fullPath, relativeFilePath);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      // Check if it's a certificate file
      if ((entry.name.endsWith('.pem') && !entry.name.endsWith('-key.pem')) || 
          entry.name.endsWith('.crt')) {
        files.push({
          name: entry.name,
          fullPath,
          relativePath: relativeFilePath,
          directory: relativePath
        });
      }
    }
  }
  
  return files;
};

// List certificates
app.get('/api/certificates', async (req, res) => {
  try {
    // Find all certificate files recursively
    const certFiles = await findAllCertificateFiles(CERT_DIR);
    const certificates = [];
    
    for (const certFileInfo of certFiles) {
      let keyFile;
      let certName;
      
      // Determine key file based on cert file format
      if (certFileInfo.name.endsWith('.crt')) {
        certName = certFileInfo.name.replace('.crt', '');
        keyFile = `${certName}.key`;
      } else {
        certName = certFileInfo.name.replace('.pem', '');
        keyFile = `${certName}-key.pem`;
      }
      
      const certPath = certFileInfo.fullPath;
      const keyPath = path.join(path.dirname(certFileInfo.fullPath), keyFile);
      
      const certStat = await fs.stat(certPath);
      const keyExists = await fs.pathExists(keyPath);
      
      // Get certificate expiry and domains
      const expiry = await getCertificateExpiry(certPath);
      const domains = await getCertificateDomains(certPath);
      
      // Calculate days until expiry
      let daysUntilExpiry = null;
      let isExpired = false;
      if (expiry) {
        const now = new Date();
        const timeDiff = expiry.getTime() - now.getTime();
        daysUntilExpiry = Math.ceil(timeDiff / (1000 * 3600 * 24));
        isExpired = daysUntilExpiry < 0;
      }
      
      // Determine format based on file extension
      const format = certFileInfo.name.endsWith('.crt') ? 'crt' : 'pem';
      
      // Check if certificate is archived
      const isArchived = certFileInfo.directory.includes('archive');
      
      // Create unique identifier that includes folder structure
      const uniqueName = certFileInfo.directory ? 
        `${certFileInfo.directory.replace(/[/\\]/g, '_')}_${certName}` : 
        certName;
      
      certificates.push({
        name: certName,
        uniqueName,
        certFile: certFileInfo.name,
        keyFile: keyExists ? keyFile : null,
        folder: certFileInfo.directory || 'root',
        relativePath: certFileInfo.relativePath,
        created: certStat.birthtime,
        size: certStat.size,
        expiry,
        daysUntilExpiry,
        isExpired,
        domains,
        format,
        isArchived
      });
    }
    
    res.json({
      success: true,
      certificates
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Download certificate file
app.get('/api/download/cert/:folder/:filename', (req, res) => {
  const folder = req.params.folder === 'root' ? '' : req.params.folder.replace(/_/g, '/');
  const filename = req.params.filename;
  const filePath = path.join(CERT_DIR, folder, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      error: 'Certificate file not found'
    });
  }
  
  res.download(filePath, filename);
});

// Download key file
app.get('/api/download/key/:folder/:filename', (req, res) => {
  const folder = req.params.folder === 'root' ? '' : req.params.folder.replace(/_/g, '/');
  const filename = req.params.filename;
  const filePath = path.join(CERT_DIR, folder, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      error: 'Key file not found'
    });
  }
  
  res.download(filePath, filename);
});

// Download both cert and key as zip
app.get('/api/download/bundle/:folder/:certname', (req, res) => {
  const folder = req.params.folder === 'root' ? '' : req.params.folder.replace(/_/g, '/');
  const certName = req.params.certname;
  
  // Try both formats
  const possibleCertFiles = [`${certName}.pem`, `${certName}.crt`];
  const possibleKeyFiles = [`${certName}-key.pem`, `${certName}.key`];
  
  let certFile, keyFile, certPath, keyPath;
  
  // Find existing files
  for (const cert of possibleCertFiles) {
    const testPath = path.join(CERT_DIR, folder, cert);
    if (fs.existsSync(testPath)) {
      certFile = cert;
      certPath = testPath;
      break;
    }
  }
  
  for (const key of possibleKeyFiles) {
    const testPath = path.join(CERT_DIR, folder, key);
    if (fs.existsSync(testPath)) {
      keyFile = key;
      keyPath = testPath;
      break;
    }
  }
  
  if (!certPath || !keyPath) {
    return res.status(404).json({
      success: false,
      error: 'Certificate or key file not found'
    });
  }
  
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${certName}.zip"`);
  
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(res);
  
  archive.file(certPath, { name: certFile });
  archive.file(keyPath, { name: keyFile });
  
  archive.finalize();
});

// Legacy download endpoints for backward compatibility
app.get('/api/download/cert/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(CERT_DIR, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      error: 'Certificate file not found'
    });
  }
  
  res.download(filePath, filename);
});

app.get('/api/download/key/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(CERT_DIR, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      error: 'Key file not found'
    });
  }
  
  res.download(filePath, filename);
});

app.get('/api/download/bundle/:certname', (req, res) => {
  const certName = req.params.certname;
  
  // Try both formats in root directory
  const possibleCertFiles = [`${certName}.pem`, `${certName}.crt`];
  const possibleKeyFiles = [`${certName}-key.pem`, `${certName}.key`];
  
  let certFile, keyFile, certPath, keyPath;
  
  for (const cert of possibleCertFiles) {
    const testPath = path.join(CERT_DIR, cert);
    if (fs.existsSync(testPath)) {
      certFile = cert;
      certPath = testPath;
      break;
    }
  }
  
  for (const key of possibleKeyFiles) {
    const testPath = path.join(CERT_DIR, key);
    if (fs.existsSync(testPath)) {
      keyFile = key;
      keyPath = testPath;
      break;
    }
  }
  
  if (!certPath || !keyPath) {
    return res.status(404).json({
      success: false,
      error: 'Certificate or key file not found'
    });
  }
  
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${certName}.zip"`);
  
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(res);
  
  archive.file(certPath, { name: certFile });
  archive.file(keyPath, { name: keyFile });
  
  archive.finalize();
});

// Archive certificate (instead of deleting)
app.post('/api/certificates/:folder/:certname/archive', async (req, res) => {
  try {
    const folder = req.params.folder === 'root' ? '' : req.params.folder.replace(/_/g, '/');
    const certName = req.params.certname;
    
    // Protect root directory certificates from archiving
    if (req.params.folder === 'root' || folder === '') {
      return res.status(403).json({
        success: false,
        error: 'Certificates in the root directory are read-only and cannot be archived'
      });
    }
    
    // Source folder path
    const sourceFolderPath = path.join(CERT_DIR, folder);
    
    // Create archive folder within the same directory
    const archiveFolderPath = path.join(sourceFolderPath, 'archive');
    await fs.ensureDir(archiveFolderPath);
    
    // Check for both .pem and .crt formats
    const possibleCertFiles = [`${certName}.pem`, `${certName}.crt`];
    const possibleKeyFiles = [`${certName}-key.pem`, `${certName}.key`];
    
    let archived = [];
    
    // Archive certificate files
    for (const certFile of possibleCertFiles) {
      const sourcePath = path.join(sourceFolderPath, certFile);
      const destPath = path.join(archiveFolderPath, certFile);
      
      if (await fs.pathExists(sourcePath)) {
        await fs.move(sourcePath, destPath);
        archived.push(certFile);
      }
    }
    
    // Archive key files
    for (const keyFile of possibleKeyFiles) {
      const sourcePath = path.join(sourceFolderPath, keyFile);
      const destPath = path.join(archiveFolderPath, keyFile);
      
      if (await fs.pathExists(sourcePath)) {
        await fs.move(sourcePath, destPath);
        archived.push(keyFile);
      }
    }
    
    if (archived.length === 0) {
      // Show all file paths checked for debugging
      const checkedCertPaths = possibleCertFiles.map(f => path.join(sourceFolderPath, f));
      const checkedKeyPaths = possibleKeyFiles.map(f => path.join(sourceFolderPath, f));
      return res.status(404).json({
        success: false,
        error: 'Certificate files not found',
        checkedCertPaths,
        checkedKeyPaths
      });
    }
    
    res.json({
      success: true,
      message: 'Certificate archived successfully',
      archived,
      archivePath: path.join(folder, 'archive')
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Restore certificate from archive
app.post('/api/certificates/:folder/:certname/restore', async (req, res) => {
  try {
    const folder = req.params.folder === 'root' ? '' : req.params.folder.replace(/_/g, '/');
    const certName = req.params.certname;
    
    // Source folder paths
    const folderPath = path.join(CERT_DIR, folder);
    const archiveFolderPath = path.join(folderPath, 'archive');
    
    // Check for both .pem and .crt formats
    const possibleCertFiles = [`${certName}.pem`, `${certName}.crt`];
    const possibleKeyFiles = [`${certName}-key.pem`, `${certName}.key`];
    
    let restored = [];
    
    // Restore certificate files
    for (const certFile of possibleCertFiles) {
      const sourcePath = path.join(archiveFolderPath, certFile);
      const destPath = path.join(folderPath, certFile);
      
      if (await fs.pathExists(sourcePath)) {
        // Check if destination file already exists
        if (await fs.pathExists(destPath)) {
          return res.status(409).json({
            success: false,
            error: `Certificate file ${certFile} already exists in the active directory`
          });
        }
        await fs.move(sourcePath, destPath);
        restored.push(certFile);
      }
    }
    
    // Restore key files
    for (const keyFile of possibleKeyFiles) {
      const sourcePath = path.join(archiveFolderPath, keyFile);
      const destPath = path.join(folderPath, keyFile);
      
      if (await fs.pathExists(sourcePath)) {
        // Check if destination file already exists
        if (await fs.pathExists(destPath)) {
          return res.status(409).json({
            success: false,
            error: `Key file ${keyFile} already exists in the active directory`
          });
        }
        await fs.move(sourcePath, destPath);
        restored.push(keyFile);
      }
    }
    
    if (restored.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Archived certificate files not found'
      });
    }
    
    // Check if archive folder is empty and remove it if so
    try {
      const remainingFiles = await fs.readdir(archiveFolderPath);
      if (remainingFiles.length === 0) {
        await fs.remove(archiveFolderPath);
      }
    } catch (error) {
      // Archive folder might already be removed or not exist
    }
    
    res.json({
      success: true,
      message: 'Certificate restored successfully',
      restored
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Delete certificate permanently from archive
app.delete('/api/certificates/:folder/:certname', async (req, res) => {
  try {
    const folder = req.params.folder === 'root' ? '' : req.params.folder.replace(/_/g, '/');
    const certName = req.params.certname;
    
    // Only allow deletion from archive folders
    if (!folder.includes('archive')) {
      return res.status(403).json({
        success: false,
        error: 'Certificates can only be permanently deleted from archive folders. Use archive endpoint instead.'
      });
    }
    
    // Check for both .pem and .crt formats
    const possibleCertFiles = [`${certName}.pem`, `${certName}.crt`];
    const possibleKeyFiles = [`${certName}-key.pem`, `${certName}.key`];
    
    let deleted = [];
    
    // Delete certificate files
    for (const certFile of possibleCertFiles) {
      const certPath = path.join(CERT_DIR, folder, certFile);
      if (await fs.pathExists(certPath)) {
        await fs.remove(certPath);
        deleted.push(certFile);
      }
    }
    
    // Delete key files
    for (const keyFile of possibleKeyFiles) {
      const keyPath = path.join(CERT_DIR, folder, keyFile);
      if (await fs.pathExists(keyPath)) {
        await fs.remove(keyPath);
        deleted.push(keyFile);
      }
    }
    
    if (deleted.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Certificate files not found in archive'
      });
    }
    
    // Check if archive folder is empty and remove it if so
    const archiveFolderPath = path.join(CERT_DIR, folder);
    try {
      const remainingFiles = await fs.readdir(archiveFolderPath);
      if (remainingFiles.length === 0) {
        await fs.remove(archiveFolderPath);
        deleted.push(`archive folder: ${folder}`);
      }
    } catch (error) {
      // Folder might already be removed or not exist
    }
    
    res.json({
      success: true,
      message: 'Certificate permanently deleted from archive',
      deleted
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Legacy delete endpoint for backward compatibility
app.delete('/api/certificates/:certname', async (req, res) => {
  try {
    const certName = req.params.certname;
    
    // Protect root directory certificates from deletion
    return res.status(403).json({
      success: false,
      error: 'Certificates in the root directory are read-only and cannot be deleted'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Auto-generate SSL certificates for HTTPS
async function generateSSLCertificate() {
  const sslDir = path.join(__dirname, 'ssl');
  const certPath = path.join(sslDir, `${SSL_DOMAIN}.pem`);
  const keyPath = path.join(sslDir, `${SSL_DOMAIN}-key.pem`);
  
  try {
    // Ensure SSL directory exists
    await fs.ensureDir(sslDir);
    
    // Check if certificates already exist and are valid
    if (await fs.pathExists(certPath) && await fs.pathExists(keyPath)) {
      console.log(`✓ SSL certificates already exist for domain: ${SSL_DOMAIN}`);
      return { certPath, keyPath };
    }
    
    console.log(`🔐 Generating SSL certificate for domain: ${SSL_DOMAIN}...`);
    
    // Generate certificate using mkcert
    const command = `mkcert -cert-file "${certPath}" -key-file "${keyPath}" "${SSL_DOMAIN}" "127.0.0.1" "::1"`;
    await executeCommand(command);
    
    console.log(`✓ SSL certificate generated successfully`);
    console.log(`   Certificate: ${certPath}`);
    console.log(`   Private Key: ${keyPath}`);
    
    return { certPath, keyPath };
  } catch (error) {
    console.error(`❌ Failed to generate SSL certificate:`, error);
    throw error;
  }
}

// HTTPS redirect middleware
function redirectToHTTPS(req, res, next) {
  if (FORCE_HTTPS && !req.secure && req.get('x-forwarded-proto') !== 'https') {
    return res.redirect(301, `https://${req.get('host').replace(PORT, HTTPS_PORT)}${req.url}`);
  }
  next();
}

// Start server(s)
async function startServer() {
  try {
    // Always start HTTP server (for API and optionally for redirects)
    if (ENABLE_HTTPS && FORCE_HTTPS) {
      // Add HTTPS redirect middleware to HTTP server
      app.use(redirectToHTTPS);
    }
    
    const httpServer = http.createServer(app);
    httpServer.listen(PORT, () => {
      if (ENABLE_HTTPS && FORCE_HTTPS) {
        console.log(`🔄 HTTP server running on http://localhost:${PORT} (redirects to HTTPS)`);
      } else {
        console.log(`🌐 HTTP server running on http://localhost:${PORT}`);
      }
    });
    
    // Start HTTPS server if enabled
    if (ENABLE_HTTPS) {
      try {
        const { certPath, keyPath } = await generateSSLCertificate();
        
        const options = {
          key: await fs.readFile(keyPath),
          cert: await fs.readFile(certPath)
        };
        
        const httpsServer = https.createServer(options, app);
        httpsServer.listen(HTTPS_PORT, () => {
          console.log(`🔐 HTTPS server running on https://localhost:${HTTPS_PORT}`);
          console.log(`🔑 SSL Domain: ${SSL_DOMAIN}`);
          console.log(`📁 Certificate storage: ${CERT_DIR}`);
          
          if (FORCE_HTTPS) {
            console.log(`\n🌟 Access the application at: https://localhost:${HTTPS_PORT}`);
            console.log(`   (HTTP requests will be redirected to HTTPS)`);
          } else {
            console.log(`\n🌟 Application available at:`);
            console.log(`   HTTP:  http://localhost:${PORT}`);
            console.log(`   HTTPS: https://localhost:${HTTPS_PORT}`);
          }
        });
        
        httpsServer.on('error', (error) => {
          console.error(`❌ HTTPS server error:`, error);
          process.exit(1);
        });
        
      } catch (sslError) {
        console.error(`❌ Failed to start HTTPS server:`, sslError);
        console.log(`🔄 Falling back to HTTP only...`);
        console.log(`📁 Certificate storage: ${CERT_DIR}`);
      }
    } else {
      console.log(`📁 Certificate storage: ${CERT_DIR}`);
      console.log(`\n🌟 Access the application at: http://localhost:${PORT}`);
      console.log(`   (To enable HTTPS, set ENABLE_HTTPS=true)`);
    }
    
  } catch (error) {
    console.error(`❌ Failed to start server:`, error);
    process.exit(1);
  }
}

startServer();

module.exports = app;
