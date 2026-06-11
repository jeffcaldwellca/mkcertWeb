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
    // Parse output like "sha256 Fingerprint=12:34:56:78:90:AB:CD:EF..." (may span multiple lines)
    const match = result.stdout.match(/sha256 Fingerprint=(.+)/is);
    if (match) {
      return match[1].replace(/\s+/g, '').trim();
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
      // Check if it's a certificate file (including key files and P12/PFX)
      if (entry.name.endsWith('.pem') || entry.name.endsWith('.crt') || entry.name.endsWith('.key') || 
          entry.name.endsWith('.p12') || entry.name.endsWith('.pfx')) {
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

// Strip a known certificate/key extension to get the logical base name.
// Order matters: -key.pem must be tested before .pem.
const stripCertExtension = (filename) =>
  filename.replace(/(-key\.pem|\.pem|\.crt|\.key|\.p12|\.pfx)$/, '');

/**
 * Group flat certificate-file entries into logical certificates.
 *
 * The group key is (containing folder + base name), NOT base name alone:
 * two certs that happen to share a name in different date folders (or in the
 * archive) are distinct certificates and must not collapse into one entry with
 * mismatched cert/key/expiry and download links pointing at the wrong folder.
 *
 * @param {Array} certificates - per-file entries as built by GET /api/certificates
 * @returns {Array} grouped certificate objects
 */
const groupCertificates = (certificates) => {
  const grouped = {};

  for (const cert of certificates) {
    if (cert.error) continue;

    const baseName = stripCertExtension(cert.filename);
    // Folder context: the directory the file lives in, relative to the certs
    // root. cert and key for one certificate share this directory.
    const dir = cert.relativePath ? path.dirname(cert.relativePath) : '.';
    const groupKey = `${dir}\0${baseName}`;

    if (!grouped[groupKey]) {
      grouped[groupKey] = {
        name: baseName,
        cert: null,
        key: null,
        domains: [],
        expiry: null,
        fingerprint: null,
        format: cert.format || 'pem',
        folder: cert.folder || null,
        folderDate: cert.folderDate || null,
        isArchived: cert.isArchived || false,
        isInterfaceSSL: cert.isInterfaceSSL || false,
        canEdit: cert.canEdit !== false
      };
    }

    const group = grouped[groupKey];
    if (cert.type === 'p12') {
      // P12 files are standalone bundles containing both cert and key.
      group.cert = cert;
      group.key = { filename: cert.filename, type: 'p12-bundle' };
      group.domains = cert.domains || [];
      group.expiry = cert.expiry;
      group.fingerprint = cert.fingerprint;
      group.format = cert.format;
    } else if (cert.type === 'cert') {
      group.cert = cert;
      group.domains = cert.domains || [];
      group.expiry = cert.expiry;
      group.fingerprint = cert.fingerprint;
      group.format = cert.format;
    } else {
      group.key = cert;
    }
  }

  return Object.values(grouped);
};

module.exports = {
  getCertificateExpiry,
  getCertificateDomains,
  getCertificateFingerprint,
  findAllCertificateFiles,
  stripCertExtension,
  groupCertificates
};
