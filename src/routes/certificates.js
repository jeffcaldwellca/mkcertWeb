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
          // Create date-based folder structure: certificates/YYYY-MM-DD/
          const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
          const certDir = path.join(process.cwd(), 'certificates', today);
          const fs = require('fs');
          
          // Ensure the directory exists
          if (!fs.existsSync(path.join(process.cwd(), 'certificates'))) {
            fs.mkdirSync(path.join(process.cwd(), 'certificates'), { recursive: true });
          }
          if (!fs.existsSync(certDir)) {
            fs.mkdirSync(certDir, { recursive: true });
          }
          
          // Generate certificates in the date-based folder using cwd option
          const domainName = sanitizedInput.split(' ')[0];
          fullCommand = `mkcert -cert-file "${domainName}.pem" -key-file "${domainName}-key.pem" ${sanitizedInput}`;
          
          // Execute with working directory set to the date-based folder
          try {
            const result = await security.executeCommand(fullCommand, { cwd: certDir });
            return apiResponse.success(res, {
              output: result.stdout || result.stderr,
              command: fullCommand,
              certificateDir: certDir
            });
          } catch (error) {
            console.error('Certificate generation error:', error);
            return apiResponse.error(res, 
              `Certificate generation failed: ${error.error || error.message}`, 
              error.stderr
            );
          }
        case 'caroot':
          fullCommand = 'mkcert -CAROOT';
          break;
        case 'list':
          fullCommand = 'ls -la *.pem 2>/dev/null || echo "No certificates found"';
          break;
        default:
          return apiResponse.badRequest(res, 'Invalid command');
      }

      // Execute command (generate case handles its own execution above)
      if (command !== 'generate') {
        const result = await security.executeCommand(fullCommand);
        
        apiResponse.success(res, {
          output: result.output,
          command: fullCommand
        });
      }
    })
  );

  // List certificate files with metadata
  router.get('/api/certificates', requireAuth, generalRateLimiter, asyncHandler(async (req, res) => {
    // Search in certificates directory instead of cwd
    const certificatesDir = path.join(process.cwd(), 'certificates');
    const files = await certificateUtils.findAllCertificateFiles(certificatesDir);
    
    const certificates = await Promise.all(files.map(async (fileInfo) => {
      try {
        const stats = await fs.stat(fileInfo.fullPath);
        const isKeyFile = fileInfo.name.endsWith('-key.pem');
        
        // Only get certificate info for actual certificate files, not key files
        const expiry = isKeyFile ? null : await certificateUtils.getCertificateExpiry(fileInfo.fullPath);
        const domains = isKeyFile ? [] : await certificateUtils.getCertificateDomains(fileInfo.fullPath);
        const fingerprint = isKeyFile ? null : await certificateUtils.getCertificateFingerprint(fileInfo.fullPath);
        
        // Extract folder information from path
        const relativePath = path.relative(certificatesDir, fileInfo.fullPath);
        const pathParts = relativePath.split(path.sep);
        const dateFolder = pathParts.length > 1 ? pathParts[0] : null;
        const isArchived = pathParts.includes('archive');
        
        // Check if this is an interface SSL certificate (directly in certificates folder, not in subfolders)
        const isInterfaceSSLCert = pathParts.length === 1;
        
        return {
          filename: fileInfo.name,
          path: fileInfo.fullPath,
          size: stats.size,
          modified: stats.mtime,
          expiry: expiry,
          domains: domains,
          fingerprint: fingerprint,
          type: isKeyFile ? 'key' : 'cert',
          folder: dateFolder,
          folderDate: dateFolder && /^\d{4}-\d{2}-\d{2}$/.test(dateFolder) ? dateFolder : null,
          isArchived: isArchived,
          isInterfaceSSL: isInterfaceSSLCert,
          canEdit: pathParts[0] !== 'uploaded' && !isInterfaceSSLCert, // Read-only for uploaded certs and interface SSL certs
          relativePath: fileInfo.relativePath
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
          expiry: null,
          fingerprint: null,
          folder: cert.folder || null,
          folderDate: cert.folderDate || null,
          isArchived: cert.isArchived || false,
          isInterfaceSSL: cert.isInterfaceSSL || false,
          canEdit: cert.canEdit !== false // Default to true unless explicitly false
        };
      }
      
      if (cert.type === 'cert') {
        grouped[baseName].cert = cert;
        grouped[baseName].domains = cert.domains || [];
        grouped[baseName].expiry = cert.expiry;
        grouped[baseName].fingerprint = cert.fingerprint;
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
    const fingerprint = await certificateUtils.getCertificateFingerprint(safePath);
    
    apiResponse.success(res, {
      filename: filename,
      size: stats.size,
      modified: stats.mtime,
      expiry: expiry,
      domains: domains,
      fingerprint: fingerprint,
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

  // Archive certificate endpoint
  router.post('/certificates/:folder/:certname/archive', requireAuth, cliRateLimiter, asyncHandler(async (req, res) => {
    const { folder, certname } = req.params;
    const certificatesDir = path.join(process.cwd(), 'certificates');
    
    // Determine the source directory based on folder parameter
    let sourceDir;
    if (folder === 'interface-ssl' || folder === 'legacy') {
      sourceDir = certificatesDir;
    } else if (folder && /^\d{4}-\d{2}-\d{2}$/.test(folder)) {
      sourceDir = path.join(certificatesDir, folder);
    } else {
      return apiResponse.badRequest(res, 'Invalid folder parameter');
    }
    
    const archiveDir = path.join(sourceDir, 'archive');
    const certFile = path.join(sourceDir, `${certname}.pem`);
    const keyFile = path.join(sourceDir, `${certname}-key.pem`);
    
    try {
      // Ensure archive directory exists
      if (!require('fs').existsSync(archiveDir)) {
        require('fs').mkdirSync(archiveDir, { recursive: true });
      }
      
      // Move certificate files to archive
      const fs = require('fs');
      if (fs.existsSync(certFile)) {
        fs.renameSync(certFile, path.join(archiveDir, `${certname}.pem`));
      }
      if (fs.existsSync(keyFile)) {
        fs.renameSync(keyFile, path.join(archiveDir, `${certname}-key.pem`));
      }
      
      apiResponse.success(res, { message: `Certificate ${certname} archived successfully` });
    } catch (error) {
      console.error('Archive error:', error);
      apiResponse.error(res, `Failed to archive certificate: ${error.message}`, 500);
    }
  }));

  // Restore certificate from archive endpoint
  router.post('/certificates/:folder/:certname/restore', requireAuth, cliRateLimiter, asyncHandler(async (req, res) => {
    const { folder, certname } = req.params;
    const certificatesDir = path.join(process.cwd(), 'certificates');
    
    // Determine the target directory based on folder parameter
    let targetDir;
    if (folder === 'interface-ssl' || folder === 'legacy') {
      targetDir = certificatesDir;
    } else if (folder && /^\d{4}-\d{2}-\d{2}$/.test(folder)) {
      targetDir = path.join(certificatesDir, folder);
    } else {
      return apiResponse.badRequest(res, 'Invalid folder parameter');
    }
    
    const archiveDir = path.join(targetDir, 'archive');
    const certFile = path.join(archiveDir, `${certname}.pem`);
    const keyFile = path.join(archiveDir, `${certname}-key.pem`);
    
    try {
      // Move certificate files from archive back to main directory
      const fs = require('fs');
      if (fs.existsSync(certFile)) {
        fs.renameSync(certFile, path.join(targetDir, `${certname}.pem`));
      }
      if (fs.existsSync(keyFile)) {
        fs.renameSync(keyFile, path.join(targetDir, `${certname}-key.pem`));
      }
      
      apiResponse.success(res, { message: `Certificate ${certname} restored successfully` });
    } catch (error) {
      console.error('Restore error:', error);
      apiResponse.error(res, `Failed to restore certificate: ${error.message}`, 500);
    }
  }));

  // Download certificate file
  router.get('/download/cert/:folder/:filename', requireAuth, generalRateLimiter, asyncHandler(async (req, res) => {
    const { folder, filename } = req.params;
    const certificatesDir = path.join(process.cwd(), 'certificates');
    
    // Determine the file path based on folder parameter
    let filePath;
    if (folder === 'interface-ssl' || folder === 'legacy') {
      filePath = path.join(certificatesDir, filename);
    } else if (folder && /^\d{4}-\d{2}-\d{2}$/.test(folder)) {
      filePath = path.join(certificatesDir, folder, filename);
    } else {
      return apiResponse.error(res, 'Invalid folder parameter', 400);
    }
    
    try {
      const fs = require('fs');
      if (!fs.existsSync(filePath)) {
        return apiResponse.error(res, 'Certificate file not found', 404);
      }
      
      res.download(filePath, filename);
    } catch (error) {
      console.error('Download error:', error);
      apiResponse.error(res, `Failed to download certificate: ${error.message}`, 500);
    }
  }));

  // Download private key file
  router.get('/download/key/:folder/:filename', requireAuth, generalRateLimiter, asyncHandler(async (req, res) => {
    const { folder, filename } = req.params;
    const certificatesDir = path.join(process.cwd(), 'certificates');
    
    // Determine the file path based on folder parameter
    let filePath;
    if (folder === 'interface-ssl' || folder === 'legacy') {
      filePath = path.join(certificatesDir, filename);
    } else if (folder && /^\d{4}-\d{2}-\d{2}$/.test(folder)) {
      filePath = path.join(certificatesDir, folder, filename);
    } else {
      return apiResponse.error(res, 'Invalid folder parameter', 400);
    }
    
    try {
      const fs = require('fs');
      if (!fs.existsSync(filePath)) {
        return apiResponse.error(res, 'Key file not found', 404);
      }
      
      res.download(filePath, filename);
    } catch (error) {
      console.error('Download error:', error);
      apiResponse.error(res, `Failed to download key: ${error.message}`, 500);
    }
  }));

  // Download certificate bundle as ZIP
  router.get('/download/bundle/:folder/:certname', requireAuth, generalRateLimiter, asyncHandler(async (req, res) => {
    const { folder, certname } = req.params;
    const certificatesDir = path.join(process.cwd(), 'certificates');
    
    // Determine the source directory based on folder parameter
    let sourceDir;
    if (folder === 'interface-ssl' || folder === 'legacy') {
      sourceDir = certificatesDir;
    } else if (folder && /^\d{4}-\d{2}-\d{2}$/.test(folder)) {
      sourceDir = path.join(certificatesDir, folder);
    } else {
      return apiResponse.error(res, 'Invalid folder parameter', 400);
    }
    
    const certFile = path.join(sourceDir, `${certname}.pem`);
    const keyFile = path.join(sourceDir, `${certname}-key.pem`);
    
    try {
      const fs = require('fs');
      const archiver = require('archiver');
      
      if (!fs.existsSync(certFile) && !fs.existsSync(keyFile)) {
        return apiResponse.error(res, 'Certificate files not found', 404);
      }
      
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${certname}.zip"`);
      
      const archive = archiver('zip', { zlib: { level: 9 }});
      archive.pipe(res);
      
      if (fs.existsSync(certFile)) {
        archive.file(certFile, { name: `${certname}.pem` });
      }
      if (fs.existsSync(keyFile)) {
        archive.file(keyFile, { name: `${certname}-key.pem` });
      }
      
      await archive.finalize();
    } catch (error) {
      console.error('Bundle download error:', error);
      apiResponse.error(res, `Failed to download bundle: ${error.message}`, 500);
    }
  }));

  // Download root CA certificate
  router.get('/download/rootca', requireAuth, generalRateLimiter, asyncHandler(async (req, res) => {
    try {
      const result = await security.executeCommand('mkcert -CAROOT');
      const caRoot = result.stdout.trim();
      const rootCAPath = path.join(caRoot, 'rootCA.pem');
      
      const fs = require('fs');
      if (!fs.existsSync(rootCAPath)) {
        return apiResponse.error(res, 'Root CA certificate not found', 404);
      }
      
      res.download(rootCAPath, 'mkcert-rootCA.pem');
    } catch (error) {
      console.error('Root CA download error:', error);
      apiResponse.error(res, `Failed to download root CA: ${error.message}`, 500);
    }
  }));

  return router;
};

module.exports = {
  createCertificateRoutes
};
