// SCEP (Simple Certificate Enrollment Protocol) utilities module
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const security = require('../security');

/**
 * SCEP Challenge Password Management
 */
const generateChallengePassword = () => {
  return crypto.randomBytes(16).toString('hex');
};

/**
 * Validate SCEP challenge password
 * @param {string} password - The challenge password to validate
 * @param {string} storedPassword - The stored challenge password
 * @returns {boolean} - Whether the password is valid
 */
const validateChallengePassword = (password, storedPassword) => {
  return password && storedPassword && password === storedPassword;
};

/**
 * Generate SCEP CA certificate response
 * This returns the CA certificate that SCEP clients need
 */
const getSCEPCACertificate = async () => {
  try {
    // Get CA root path from mkcert
    const result = await security.executeCommand('mkcert -CAROOT');
    const caRootPath = result.stdout.trim();
    
    // Read the CA certificate
    const caCertPath = path.join(caRootPath, 'rootCA.pem');
    const caCert = await fs.readFile(caCertPath);
    
    return caCert;
  } catch (error) {
    throw new Error(`Failed to get SCEP CA certificate: ${error.message}`);
  }
};

/**
 * Process SCEP certificate request
 * @param {Buffer} pkcs10Request - The PKCS#10 certificate request
 * @param {string} challengePassword - The challenge password
 * @param {string} commonName - Common name for the certificate
 * @returns {Promise<Buffer>} - The signed certificate
 */
const processSCEPCertificateRequest = async (pkcs10Request, challengePassword, commonName) => {
  try {
    // Validate challenge password (in a real implementation, you'd check against stored challenges)
    if (!challengePassword || challengePassword.length < 8) {
      throw new Error('Invalid challenge password');
    }

    // Validate common name
    if (!commonName || !isValidDomainName(commonName)) {
      throw new Error('Invalid common name');
    }

    // Save the PKCS#10 request to a temporary file
    const tempDir = path.join(process.cwd(), 'certificates', 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    
    const requestFile = path.join(tempDir, `${Date.now()}-request.csr`);
    await fs.writeFile(requestFile, pkcs10Request);

    // Generate certificate using mkcert for the requested domain
    const certDir = path.join(process.cwd(), 'certificates', 'scep', commonName);
    await fs.mkdir(certDir, { recursive: true });

    const certFile = path.join(certDir, `${commonName}.pem`);
    const keyFile = path.join(certDir, `${commonName}-key.pem`);

    // Use mkcert to generate the certificate
    const generateCommand = `cd "${certDir}" && mkcert -cert-file "${commonName}.pem" -key-file "${commonName}-key.pem" "${commonName}"`;
    await security.executeCommand(generateCommand);

    // Read the generated certificate
    const certificate = await fs.readFile(certFile);

    // Clean up temporary request file
    await fs.unlink(requestFile).catch(() => {}); // Ignore errors

    return certificate;
  } catch (error) {
    throw new Error(`Failed to process SCEP certificate request: ${error.error || error.message || error}`);
  }
};

/**
 * Validate domain name format
 * @param {string} domain - Domain name to validate
 * @returns {boolean} - Whether the domain is valid
 */
const isValidDomainName = (domain) => {
  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return domainRegex.test(domain) && domain.length <= 253;
};

/**
 * Create SCEP certificate store directory structure
 */
const initializeSCEPStore = async () => {
  const scepDir = path.join(process.cwd(), 'certificates', 'scep');
  const tempDir = path.join(process.cwd(), 'certificates', 'temp');
  
  await fs.mkdir(scepDir, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });
  
  return { scepDir, tempDir };
};

/**
 * List all SCEP-generated certificates
 */
const listSCEPCertificates = async () => {
  try {
    const scepDir = path.join(process.cwd(), 'certificates', 'scep');
    
    try {
      const entries = await fs.readdir(scepDir, { withFileTypes: true });
      const certificates = [];
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const certDir = path.join(scepDir, entry.name);
          const certFile = path.join(certDir, `${entry.name}.pem`);
          
          try {
            const stat = await fs.stat(certFile);
            certificates.push({
              commonName: entry.name,
              path: certDir,
              created: stat.birthtime,
              modified: stat.mtime
            });
          } catch (err) {
            // Certificate file doesn't exist, skip
          }
        }
      }
      
      return certificates;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  } catch (error) {
    throw new Error(`Failed to list SCEP certificates: ${error.message}`);
  }
};

/**
 * Get SCEP certificate details
 * @param {string} commonName - Common name of the certificate
 * @returns {Promise<Object>} - Certificate details
 */
const getSCEPCertificateDetails = async (commonName) => {
  try {
    if (!isValidDomainName(commonName)) {
      throw new Error('Invalid common name');
    }

    const certDir = path.join(process.cwd(), 'certificates', 'scep', commonName);
    const certFile = path.join(certDir, `${commonName}.pem`);
    const keyFile = path.join(certDir, `${commonName}-key.pem`);

    // Check if files exist
    await fs.access(certFile);
    await fs.access(keyFile);

    // Get certificate info using OpenSSL
    const certInfo = await security.executeCommand(
      `openssl x509 -in "${certFile}" -noout -text -dates -subject -issuer`
    );

    return {
      commonName,
      certPath: certFile,
      keyPath: keyFile,
      info: certInfo.stdout
    };
  } catch (error) {
    throw new Error(`Failed to get SCEP certificate details: ${error.message}`);
  }
};

module.exports = {
  generateChallengePassword,
  validateChallengePassword,
  getSCEPCACertificate,
  processSCEPCertificateRequest,
  isValidDomainName,
  initializeSCEPStore,
  listSCEPCertificates,
  getSCEPCertificateDetails
};
