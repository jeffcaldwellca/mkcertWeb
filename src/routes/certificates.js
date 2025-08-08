// Certificate management routes module - Refactored to eliminate code duplication
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const security = require('../security');
const certificateUtils = require('../utils/certificates');
const { apiResponse, handleError, asyncHandler, validateRequest } = require('../utils/responses');
const { validateFileRequest, deleteFile } = require('../utils/fileValidation');

const createCertificateRoutes = (config, rateLimiters, requireAuth) => {
  const router = express.Router();
  const { cliRateLimiter, generalRateLimiter } = rateLimiters;

  // Get all available commands
  router.get('/api/commands', requireAuth, generalRateLimiter, asyncHandler(async (req, res) => {
    const commands = [
      {
        name: 'Install CA',
        key: 'install-ca',
        description: 'Install the local CA certificate',
        dangerous: false
      },
      {
        name: 'Uninstall CA',
        key: 'uninstall-ca',
        description: 'Uninstall the local CA certificate',
        dangerous: true
      },
      {
        name: 'Generate',
        key: 'generate',
        description: 'Generate certificate for domains',
        dangerous: false,
        hasInput: true,
        inputPlaceholder: 'Enter domain names (space-separated)'
      },
      {
        name: 'Get CAROOT',
        key: 'caroot',
        description: 'Get the CA root directory path',
        dangerous: false
      },
      {
        name: 'List Certificates',
        key: 'list',
        description: 'List all certificates in the current directory',
        dangerous: false
      }
    ];

    apiResponse.success(res, { commands });
  }));

  // Execute mkcert commands
  router.post('/api/execute', requireAuth, cliRateLimiter,
    validateRequest({
      command: {
        required: true,
        validate: (value) => typeof value === 'string' && value.trim().length > 0,
        message: 'Command is required and must be a non-empty string'
      }
    }),
    asyncHandler(async (req, res) => {
      const { command, input } = req.body;
      const sanitizedInput = input ? input.trim() : '';
      
      let fullCommand;
      
      switch (command) {
        case 'install-ca':
          // Check if CA is already installed to avoid sudo prompt
          try {
            const statusResult = await security.executeCommand('mkcert -CAROOT');
            if (statusResult.stdout) {
              const caRoot = statusResult.stdout.trim();
              const fs = require('fs');
              const rootCAPath = path.join(caRoot, 'rootCA.pem');
              const rootCAKeyPath = path.join(caRoot, 'rootCA-key.pem');
              
              if (fs.existsSync(rootCAPath) && fs.existsSync(rootCAKeyPath)) {
                // CA already exists, check if it's installed in system trust store
                return apiResponse.success(res, {
                  output: 'CA is already available. If you need to install it in the system trust store, please run "mkcert -install" manually with administrator privileges.',
                  command: 'mkcert -install (skipped - CA exists)',
                  warning: 'Manual installation may be required for system trust'
                });
              }
            }
          } catch (error) {
            console.error('Error checking CA status:', error);
          }
          
          // If we get here, try the install but with a shorter timeout
          fullCommand = 'mkcert -install';
          break;
        case 'uninstall-ca':
          fullCommand = 'mkcert -uninstall';
          break;
        case 'generate':
          if (!sanitizedInput) {
            return apiResponse.badRequest(res, 'Domain names are required for certificate generation');
          }
          fullCommand = `mkcert ${sanitizedInput}`;
          break;
        case 'caroot':
          fullCommand = 'mkcert -CAROOT';
          break;
        case 'list':
          fullCommand = 'ls -la *.pem 2>/dev/null || echo "No certificates found"';
          break;
        default:
          return apiResponse.badRequest(res, 'Invalid command');
      }

      const result = await security.executeCommand(fullCommand);
      
      apiResponse.success(res, {
        output: result.output,
        command: fullCommand
      });
    })
  );

  // List certificate files with metadata
  router.get('/api/certificates', requireAuth, generalRateLimiter, asyncHandler(async (req, res) => {
    const files = await certificateUtils.findAllCertificateFiles(process.cwd());
    
    const certificates = await Promise.all(files.map(async (fileInfo) => {
      try {
        const stats = await fs.stat(fileInfo.fullPath);
        const expiry = await certificateUtils.getCertificateExpiry(fileInfo.fullPath);
        const domains = await certificateUtils.getCertificateDomains(fileInfo.fullPath);
        
        return {
          filename: fileInfo.name,
          path: fileInfo.fullPath,
          size: stats.size,
          modified: stats.mtime,
          expiry: expiry,
          domains: domains,
          type: fileInfo.name.endsWith('-key.pem') ? 'key' : 'cert'
        };
      } catch (err) {
        console.error(`Error processing certificate ${fileInfo.fullPath}:`, err);
        return {
          filename: fileInfo.name,
          path: fileInfo.fullPath,
          error: 'Could not read certificate details'
        };
      }
    }));
    
    // Group certificates by domain
    const grouped = {};
    certificates.forEach(cert => {
      if (cert.error) return;
      
      const baseName = cert.filename.replace(/(-key)?\.pem$/, '');
      
      if (!grouped[baseName]) {
        grouped[baseName] = {
          name: baseName,
          cert: null,
          key: null,
          domains: [],
          expiry: null
        };
      }
      
      if (cert.type === 'cert') {
        grouped[baseName].cert = cert;
        grouped[baseName].domains = cert.domains || [];
        grouped[baseName].expiry = cert.expiry;
      } else {
        grouped[baseName].key = cert;
      }
    });
    
    apiResponse.success(res, {
      certificates: Object.values(grouped),
      total: Object.keys(grouped).length
    });
  }));

  // Get certificate details
  router.get('/api/certificate/:filename', requireAuth, generalRateLimiter, asyncHandler(async (req, res) => {
    const { filename } = req.params;
    
    // Validate file request
    const { isValid, safePath } = await validateFileRequest(filename, process.cwd(), res);
    if (!isValid) return; // Error response already sent
    
    const stats = await fs.stat(safePath);
    const expiry = await certificateUtils.getCertificateExpiry(safePath);
    const domains = await certificateUtils.getCertificateDomains(safePath);
    
    apiResponse.success(res, {
      filename: filename,
      size: stats.size,
      modified: stats.mtime,
      expiry: expiry,
      domains: domains,
      type: filename.endsWith('-key.pem') ? 'key' : 'cert'
    });
  }));

  // Delete certificate
  router.delete('/api/certificate/:filename', requireAuth, cliRateLimiter, asyncHandler(async (req, res) => {
    const { filename } = req.params;
    
    // Validate file request
    const { isValid, safePath } = await validateFileRequest(filename, process.cwd(), res);
    if (!isValid) return; // Error response already sent
    
    // Delete the certificate file
    const deleted = await deleteFile(safePath, res);
    if (!deleted) return; // Error response already sent by deleteFile
    
    // Also try to delete the corresponding key/cert file if it exists
    let companionFile;
    if (filename.endsWith('-key.pem')) {
      companionFile = filename.replace('-key.pem', '.pem');
    } else if (filename.endsWith('.pem') && !filename.endsWith('-key.pem')) {
      companionFile = filename.replace('.pem', '-key.pem');
    }
    
    if (companionFile) {
      const companionPath = path.join(process.cwd(), companionFile);
      try {
        await fs.access(companionPath);
        await deleteFile(companionPath); // Don't pass res - we don't want to send error response for companion file
      } catch (err) {
        // Companion file doesn't exist or couldn't be deleted, that's OK
      }
    }
    
    apiResponse.success(res, {}, 'Certificate deleted successfully');
  }));

  // Get root CA information
  router.get('/api/rootca/info', requireAuth, generalRateLimiter, asyncHandler(async (req, res) => {
    try {
      // Get CAROOT directory
      const carootResult = await security.executeCommand('mkcert -CAROOT');
      const caRoot = carootResult.stdout ? carootResult.stdout.trim() : null;
      
      if (!caRoot) {
        return apiResponse.error(res, 'Could not determine CA root directory', 500);
      }

      const fs = require('fs').promises;
      const rootCAPath = path.join(caRoot, 'rootCA.pem');
      
      // Check if root CA exists
      try {
        await fs.access(rootCAPath);
      } catch (error) {
        return apiResponse.error(res, 'Root CA certificate not found', 404);
      }

      // Get certificate details using OpenSSL
      const certInfoResult = await security.executeCommand(`openssl x509 -in "${rootCAPath}" -noout -subject -issuer -dates -fingerprint`);
      
      if (!certInfoResult.stdout) {
        return apiResponse.error(res, 'Could not read certificate information', 500);
      }

      const certInfo = certInfoResult.stdout;
      
      // Parse certificate information
      const subjectMatch = certInfo.match(/subject=(.+)/);
      const issuerMatch = certInfo.match(/issuer=(.+)/);
      const notAfterMatch = certInfo.match(/notAfter=(.+)/);
      const fingerprintMatch = certInfo.match(/SHA256 Fingerprint=(.+)/);

      const subject = subjectMatch ? subjectMatch[1].trim() : 'Unknown';
      const issuer = issuerMatch ? issuerMatch[1].trim() : 'Unknown';
      const expiry = notAfterMatch ? new Date(notAfterMatch[1].trim()).toISOString() : null;
      const fingerprint = fingerprintMatch ? fingerprintMatch[1].trim() : 'Unknown';

      // Calculate days until expiry
      let daysUntilExpiry = null;
      if (expiry) {
        const expiryDate = new Date(expiry);
        const now = new Date();
        const timeDiff = expiryDate.getTime() - now.getTime();
        daysUntilExpiry = Math.ceil(timeDiff / (1000 * 3600 * 24));
      }

      apiResponse.success(res, {
        caRoot,
        subject,
        issuer,
        expiry: expiry ? new Date(expiry).toLocaleDateString() : null,
        daysUntilExpiry,
        fingerprint,
        path: rootCAPath
      });
    } catch (error) {
      console.error('Error getting root CA info:', error);
      apiResponse.error(res, 'Failed to get root CA information: ' + error.message, 500);
    }
  }));

  return router;
};

module.exports = {
  createCertificateRoutes
};
