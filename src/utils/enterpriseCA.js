// Enhanced certificate generation utilities for enterprise CA integration
const fs = require('fs');
const path = require('path');
const security = require('../security');

/**
 * Enterprise CA configuration from environment variables
 */
const enterpriseCAConfig = {
  enabled: process.env.ENTERPRISE_CA_ENABLED === 'true',
  caKeyPath: process.env.ENTERPRISE_CA_KEY_PATH,
  caCertPath: process.env.ENTERPRISE_CA_CERT_PATH,
  caChainPath: process.env.ENTERPRISE_CA_CHAIN_PATH,
  defaultTemplate: process.env.ENTERPRISE_CA_DEFAULT_TEMPLATE || 'User',
  m365Template: process.env.ENTERPRISE_CA_M365_TEMPLATE || 'M365User',
  validityDays: parseInt(process.env.ENTERPRISE_CA_VALIDITY_DAYS) || 365,
  keySize: parseInt(process.env.ENTERPRISE_CA_KEY_SIZE) || 2048,
  hashAlgorithm: process.env.ENTERPRISE_CA_HASH_ALGORITHM || 'sha256'
};

/**
 * Certificate templates for different use cases
 */
const certificateTemplates = {
  'User': {
    keyUsage: ['digitalSignature', 'keyEncipherment'],
    extendedKeyUsage: ['clientAuth'],
    subjectAltNameTypes: ['email']
  },
  'M365User': {
    keyUsage: ['digitalSignature', 'keyEncipherment'],
    extendedKeyUsage: ['clientAuth', 'emailProtection'],
    subjectAltNameTypes: ['email', 'upn'],
    customOIDs: {
      // Microsoft UPN OID
      '1.3.6.1.4.1.311.20.2.3': 'upn'
    }
  },
  'Computer': {
    keyUsage: ['digitalSignature', 'keyEncipherment'],
    extendedKeyUsage: ['clientAuth', 'serverAuth'],
    subjectAltNameTypes: ['dns']
  },
  'WiFi': {
    keyUsage: ['digitalSignature', 'keyEncipherment'],
    extendedKeyUsage: ['clientAuth'],
    subjectAltNameTypes: ['email']
  }
};

/**
 * Generate certificate using enterprise CA or fallback to mkcert
 * @param {Object} options - Certificate generation options
 * @param {string} options.commonName - Certificate common name
 * @param {string} options.template - Certificate template to use
 * @param {string} options.upn - User Principal Name for M365 integration
 * @param {Array} options.subjectAltNames - Additional SAN entries
 * @param {string} options.outputPath - Output directory for certificate files
 * @returns {Object} Certificate generation result
 */
async function generateEnterpriseOrMkcertCertificate(options) {
  const { commonName, template = 'User', upn, subjectAltNames = [], outputPath } = options;

  // Validate inputs
  if (!commonName) {
    throw new Error('Common name is required');
  }

  // Check if enterprise CA is configured and available
  if (enterpriseCAConfig.enabled && await isEnterpriseCaAvailable()) {
    console.log(`🏢 Using enterprise CA for certificate generation (template: ${template})`);
    return await generateEnterpriseCA(options);
  } else {
    console.log('🔧 Using mkcert for certificate generation (development mode)');
    return await generateMkcert(options);
  }
}

/**
 * Check if enterprise CA is properly configured and accessible
 * @returns {boolean} Whether enterprise CA is available
 */
async function isEnterpriseCaAvailable() {
  try {
    // Check if required CA files exist
    if (!enterpriseCAConfig.caKeyPath || !enterpriseCAConfig.caCertPath) {
      console.log('⚠️ Enterprise CA paths not configured');
      return false;
    }

    // Verify CA key file exists and is readable
    if (!fs.existsSync(enterpriseCAConfig.caKeyPath)) {
      console.log('⚠️ Enterprise CA key file not found:', enterpriseCAConfig.caKeyPath);
      return false;
    }

    // Verify CA certificate file exists and is readable
    if (!fs.existsSync(enterpriseCAConfig.caCertPath)) {
      console.log('⚠️ Enterprise CA certificate file not found:', enterpriseCAConfig.caCertPath);
      return false;
    }

    // Optional: Check CA chain file if specified
    if (enterpriseCAConfig.caChainPath && !fs.existsSync(enterpriseCAConfig.caChainPath)) {
      console.log('⚠️ Enterprise CA chain file specified but not found:', enterpriseCAConfig.caChainPath);
      return false;
    }

    console.log('✅ Enterprise CA configuration verified');
    return true;

  } catch (error) {
    console.error('❌ Error checking enterprise CA availability:', error.message);
    return false;
  }
}

/**
 * Generate certificate using enterprise CA with OpenSSL
 * @param {Object} options - Certificate generation options
 * @returns {Object} Certificate generation result
 */
async function generateEnterpriseCA(options) {
  const { commonName, template, upn, subjectAltNames = [], outputPath } = options;
  
  try {
    // Get certificate template configuration
    const templateConfig = certificateTemplates[template] || certificateTemplates['User'];
    console.log(`📋 Using certificate template: ${template}`);

    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }

    // Generate file paths
    const baseName = commonName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const keyPath = path.join(outputPath, `${baseName}-key.pem`);
    const csrPath = path.join(outputPath, `${baseName}.csr`);
    const certPath = path.join(outputPath, `${baseName}.pem`);
    const configPath = path.join(outputPath, `${baseName}.conf`);

    // Step 1: Generate private key
    console.log('🔑 Generating private key...');
    await security.executeCommand(`openssl genrsa -out "${keyPath}" ${enterpriseCAConfig.keySize}`);

    // Step 2: Create OpenSSL configuration file with proper extensions
    console.log('📝 Creating OpenSSL configuration...');
    const opensslConfig = await createOpenSSLConfig({
      commonName,
      template: templateConfig,
      upn,
      subjectAltNames,
      configPath
    });

    // Step 3: Generate Certificate Signing Request
    console.log('📄 Generating certificate signing request...');
    const subjectString = buildSubjectString({ commonName, upn });
    await security.executeCommand(`openssl req -new -key "${keyPath}" -out "${csrPath}" -config "${configPath}" -subj "${subjectString}"`);

    // Step 4: Sign certificate with enterprise CA
    console.log('✍️ Signing certificate with enterprise CA...');
    await security.executeCommand(`openssl x509 -req -in "${csrPath}" -CA "${enterpriseCAConfig.caCertPath}" -CAkey "${enterpriseCAConfig.caKeyPath}" -CAcreateserial -out "${certPath}" -days ${enterpriseCAConfig.validityDays} -extensions v3_req -extfile "${configPath}" -${enterpriseCAConfig.hashAlgorithm}`);

    // Step 5: Create certificate chain if CA chain is available
    let chainPath = null;
    if (enterpriseCAConfig.caChainPath) {
      chainPath = path.join(outputPath, `${baseName}-chain.pem`);
      console.log('🔗 Creating certificate chain...');
      
      // Combine certificate with CA chain
      const certContent = fs.readFileSync(certPath, 'utf8');
      const chainContent = fs.readFileSync(enterpriseCAConfig.caChainPath, 'utf8');
      fs.writeFileSync(chainPath, certContent + '\n' + chainContent);
    }

    // Step 6: Generate PKCS#12 bundle for client installation
    const p12Path = path.join(outputPath, `${baseName}.p12`);
    console.log('📦 Creating PKCS#12 bundle...');
    
    let p12Command = `openssl pkcs12 -export -out "${p12Path}" -inkey "${keyPath}" -in "${certPath}"`;
    if (chainPath) {
      p12Command += ` -certfile "${chainPath}"`;
    }
    p12Command += ' -password pass:'; // Empty password for easier deployment
    
    await security.executeCommand(p12Command);

    // Clean up temporary files
    fs.unlinkSync(csrPath);
    fs.unlinkSync(configPath);

    console.log('✅ Enterprise certificate generated successfully');

    return {
      success: true,
      certificatePath: certPath,
      keyPath: keyPath,
      chainPath: chainPath,
      p12Path: p12Path,
      commonName: commonName,
      template: template,
      upn: upn,
      method: 'enterprise-ca'
    };

  } catch (error) {
    console.error('❌ Enterprise certificate generation failed:', error);
    throw new Error(`Enterprise CA certificate generation failed: ${error.message}`);
  }
}

/**
 * Generate certificate using mkcert (fallback method)
 * @param {Object} options - Certificate generation options  
 * @returns {Object} Certificate generation result
 */
async function generateMkcert(options) {
  const { commonName, upn, subjectAltNames = [], outputPath } = options;

  try {
    // Build mkcert domains list
    const domains = [commonName];
    
    // Add UPN as SAN if provided
    if (upn) {
      domains.push(upn);
    }
    
    // Add additional SANs
    domains.push(...subjectAltNames);

    // Create output directory
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }

    // Generate certificate with mkcert
    const quotedDomains = domains.map(domain => `"${domain}"`).join(' ');
    await security.executeCommand(`cd "${outputPath}" && mkcert ${quotedDomains}`);

    // Find generated files (mkcert uses its own naming convention)
    const certFiles = fs.readdirSync(outputPath).filter(file => 
      file.endsWith('.pem') && !file.endsWith('-key.pem')
    );
    
    if (certFiles.length === 0) {
      throw new Error('No certificate files found after mkcert generation');
    }

    const certPath = path.join(outputPath, certFiles[0]);
    const keyPath = certPath.replace('.pem', '-key.pem');

    console.log('✅ mkcert certificate generated successfully');

    return {
      success: true,
      certificatePath: certPath,
      keyPath: keyPath,
      chainPath: null,
      p12Path: null,
      commonName: commonName,
      template: 'mkcert-default',
      upn: upn,
      method: 'mkcert'
    };

  } catch (error) {
    console.error('❌ mkcert certificate generation failed:', error);
    throw new Error(`mkcert certificate generation failed: ${error.message}`);
  }
}

/**
 * Create OpenSSL configuration file with proper extensions
 * @param {Object} params - Configuration parameters
 * @returns {string} Generated configuration content
 */
async function createOpenSSLConfig({ commonName, template, upn, subjectAltNames, configPath }) {
  const config = `
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = ${commonName}

[v3_req]
basicConstraints = CA:FALSE
keyUsage = ${template.keyUsage.join(', ')}
extendedKeyUsage = ${template.extendedKeyUsage.join(', ')}
subjectAltName = @alt_names

[alt_names]
`;

  // Add subject alternative names
  let altNameIndex = 1;
  let altNamesSection = '';

  // Add email if UPN is provided and template supports it
  if (upn && template.subjectAltNameTypes.includes('email')) {
    altNamesSection += `email.${altNameIndex} = ${upn}\n`;
    altNameIndex++;
  }

  // Add UPN if template supports it (M365 integration)
  if (upn && template.subjectAltNameTypes.includes('upn')) {
    altNamesSection += `otherName.${altNameIndex} = 1.3.6.1.4.1.311.20.2.3;UTF8:${upn}\n`;
    altNameIndex++;
  }

  // Add DNS names
  if (template.subjectAltNameTypes.includes('dns')) {
    altNamesSection += `DNS.${altNameIndex} = ${commonName}\n`;
    altNameIndex++;
    
    subjectAltNames.forEach(san => {
      if (san.includes('.')) { // Assume DNS name if it contains dots
        altNamesSection += `DNS.${altNameIndex} = ${san}\n`;
        altNameIndex++;
      }
    });
  }

  const fullConfig = config + altNamesSection;
  
  // Write configuration to file
  fs.writeFileSync(configPath, fullConfig, 'utf8');
  
  return fullConfig;
}

/**
 * Build subject string for certificate request
 * @param {Object} params - Subject parameters
 * @returns {string} Subject string for OpenSSL
 */
function buildSubjectString({ commonName, upn }) {
  let subject = `/CN=${commonName}`;
  
  // Add additional subject fields if needed
  if (upn && upn.includes('@')) {
    const domain = upn.split('@')[1];
    subject += `/O=${domain}`;
  }
  
  return subject;
}

/**
 * Validate UPN format for M365 integration
 * @param {string} upn - User Principal Name
 * @returns {boolean} Whether UPN is valid
 */
function validateUPN(upn) {
  if (!upn) return false;
  
  // Basic UPN format validation: user@domain.com
  const upnRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return upnRegex.test(upn);
}

/**
 * Get available certificate templates
 * @returns {Object} Available templates with descriptions
 */
function getAvailableTemplates() {
  return Object.keys(certificateTemplates).map(name => ({
    name,
    description: getTemplateDescription(name),
    keyUsage: certificateTemplates[name].keyUsage,
    extendedKeyUsage: certificateTemplates[name].extendedKeyUsage
  }));
}

/**
 * Get description for certificate template
 * @param {string} templateName - Template name
 * @returns {string} Template description
 */
function getTemplateDescription(templateName) {
  const descriptions = {
    'User': 'Standard user certificate for authentication',
    'M365User': 'Microsoft 365 user certificate with UPN support',
    'Computer': 'Computer certificate for machine authentication',
    'WiFi': 'WiFi authentication certificate'
  };
  
  return descriptions[templateName] || 'Custom certificate template';
}

/**
 * Get current enterprise CA status and configuration
 * @returns {Promise<Object>} CA status information
 */
async function getEnterpriseCAStatus() {
  try {
    const config = require('../config');
    const caConfig = config.enterpriseCA || {};
    
    // Check if enterprise CA is enabled
    const isEnabled = caConfig.enabled === true;
    
    let caStatus = 'disabled';
    let caDetails = null;
    
    if (isEnabled && caConfig.caCertPath && caConfig.caKeyPath) {
      try {
        // Verify CA files exist
        await fs.access(caConfig.caCertPath);
        await fs.access(caConfig.caKeyPath);
        
        // Get CA certificate details
        const certInfo = await security.executeCommand(
          `openssl x509 -in "${caConfig.caCertPath}" -noout -subject -issuer -dates`
        );
        
        caStatus = 'active';
        caDetails = {
          subject: certInfo.stdout.match(/subject=(.+)/)?.[1],
          issuer: certInfo.stdout.match(/issuer=(.+)/)?.[1],
          validFrom: certInfo.stdout.match(/notBefore=(.+)/)?.[1],
          validTo: certInfo.stdout.match(/notAfter=(.+)/)?.[1]
        };
      } catch (error) {
        caStatus = 'configured-but-unavailable';
        caDetails = { error: error.message };
      }
    }
    
    return {
      enabled: isEnabled,
      status: caStatus,
      fallbackToMkcert: !isEnabled || caStatus !== 'active',
      configuration: {
        caCertPath: caConfig.caCertPath || null,
        caKeyPath: caConfig.caKeyPath || null,
        organizationalUnit: caConfig.organizationalUnit || 'Default OU',
        organization: caConfig.organization || 'Default Org',
        country: caConfig.country || 'US'
      },
      caDetails
    };
  } catch (error) {
    console.error('Failed to get enterprise CA status:', error);
    return {
      enabled: false,
      status: 'error',
      fallbackToMkcert: true,
      error: error.message
    };
  }
}

/**
 * Get available certificate templates with enhanced metadata
 * @returns {Object} Certificate templates configuration
 */
function getCertificateTemplates() {
  return {
    templates: certificateTemplates,
    available: getAvailableTemplates(),
    description: 'Available certificate templates for enterprise CA',
    usage: {
      User: 'Standard user certificates for client authentication',
      M365User: 'Microsoft 365 user certificates with UPN in SAN',
      Computer: 'Computer/device certificates for machine authentication', 
      WiFi: 'WiFi authentication certificates with specific key usage'
    }
  };
}

module.exports = {
  generateEnterpriseOrMkcertCertificate,
  isEnterpriseCaAvailable,
  validateUPN,
  getAvailableTemplates,
  getEnterpriseCAStatus,
  getCertificateTemplates,
  enterpriseCAConfig,
  certificateTemplates
};
