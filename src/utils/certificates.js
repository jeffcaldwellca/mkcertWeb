// Certificate helper functions module
const fs = require('fs-extra');
const path = require('path');
const { executeCommand } = require('../security');

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

// Helper function to get certificate fingerprint
const getCertificateFingerprint = async (certPath) => {
  try {
    const result = await executeCommand(`openssl x509 -in "${certPath}" -noout -fingerprint -sha256`);
    // Parse output like "SHA256 Fingerprint=12:34:56:78:90:AB:CD:EF..."
    const match = result.stdout.match(/SHA256 Fingerprint=(.+)/);
    if (match) {
      return match[1].trim();
    }
    return null;
  } catch (error) {
    console.error('Error getting certificate fingerprint:', error);
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
      // Check if it's a certificate file (including key files)
      if (entry.name.endsWith('.pem') || entry.name.endsWith('.crt')) {
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

module.exports = {
  getCertificateExpiry,
  getCertificateDomains,
  getCertificateFingerprint,
  findAllCertificateFiles
};
