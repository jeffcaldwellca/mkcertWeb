// SCEP (Simple Certificate Enrollment Protocol) utilities module
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const security = require('../security');
const enterpriseCA = require('./enterpriseCA');

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
 * Process SCEP certificate request with enterprise CA integration
 * @param {Object} requestData - SCEP request data
 * @param {string} requestData.commonName - Certificate common name
 * @param {string} requestData.challengePassword - Challenge password (optional)
 * @param {string} requestData.template - Certificate template to use
 * @param {string} requestData.upn - User Principal Name for M365 integration
 * @param {Array} requestData.subjectAltNames - Additional subject alternative names
 * @returns {Object} Certificate generation result
 */
const processSCEPCertificateRequest = async (requestData) => {
  try {
    const { commonName, challengePassword, template = 'User', upn, subjectAltNames = [] } = requestData;
    
    console.log('🔄 Processing SCEP certificate request');
    console.log(`📋 Common Name: ${commonName}`);
    console.log(`📋 Template: ${template}`);
    if (upn) console.log(`📋 UPN: ${upn}`);
    
    // Validate UPN if provided (important for M365 integration)
    if (upn && !enterpriseCA.validateUPN(upn)) {
      throw new Error(`Invalid UPN format: ${upn}`);
    }
    
    // Validate certificate template
    const availableTemplates = Object.keys(enterpriseCA.certificateTemplates);
    if (!availableTemplates.includes(template)) {
      console.log(`⚠️ Unknown template '${template}', using 'User' template`);
    }
    
    // Create certificate directory
    const scepCertDir = path.join(process.cwd(), 'certificates', 'scep');
    const certDir = path.join(scepCertDir, commonName);
    
    // Ensure directory exists
    try {
      await fs.mkdir(certDir, { recursive: true });
    } catch (error) {
      // Directory might already exist, continue
    }
    
    // Generate certificate using enterprise CA or mkcert fallback
    const result = await enterpriseCA.generateEnterpriseOrMkcertCertificate(
      commonName,
      template,
      upn,
      subjectAltNames,
      certDir
    );
    
    console.log(`✅ SCEP certificate generated using ${result.method}`);
    
    // Read the generated certificate for SCEP response
    const certificate = await fs.readFile(result.certificatePath);
    
    // Return enhanced result with SCEP-specific information
    return {
      ...result,
      certificate,
      scepPath: certDir,
      generated: new Date().toISOString(),
      protocol: 'SCEP',
      enterpriseMode: result.method === 'enterprise-ca'
    };
    
  } catch (error) {
    console.error('❌ SCEP certificate request processing failed:', error);
    throw new Error(`Failed to process SCEP certificate request: ${error.message}`);
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
