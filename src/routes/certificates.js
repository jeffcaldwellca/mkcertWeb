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

  // Helper function to validate and sanitize path parameters
  const validatePathParams = (folder, certname, filename) => {
    const certificatesDir = path.join(process.cwd(), 'certificates');
    
    try {
      // Validate folder parameter if provided
      if (folder) {
        if (folder === 'interface-ssl' || folder === 'legacy') {
          // These are allowed special folder names
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(folder)) {
          // Date-based folder format is allowed
          const folderResult = security.validateAndSanitizePath(folder, certificatesDir);
          folder = folderResult.sanitized;
        } else {
          throw new Error('Invalid folder parameter');
        }
      }
      
      // Validate certificate name if provided
      if (certname) {
        const sanitizedCertname = security.validateFilename(certname);
        certname = sanitizedCertname;
      }
      
      // Validate filename if provided
      if (filename) {
        const sanitizedFilename = security.validateFilename(filename);
        filename = sanitizedFilename;
      }
      
      return { folder, certname, filename };
    } catch (error) {
      throw new Error(`Path validation failed: ${error.message}`);
    }
  };

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
          
          // Get format from request body, default to 'pem'
          const format = req.body.format || 'pem';
          if (!['pem', 'crt'].includes(format)) {
            return apiResponse.badRequest(res, 'Invalid certificate format. Must be "pem" or "crt"');
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
          let fullCommand;
          
          if (format === 'crt') {
            fullCommand = `mkcert -cert-file "${domainName}.crt" -key-file "${domainName}.key" ${sanitizedInput}`;
          } else {
            fullCommand = `mkcert -cert-file "${domainName}.pem" -key-file "${domainName}-key.pem" ${sanitizedInput}`;
          }
          
          // Execute with working directory set to the date-based folder
          try {
            const result = await security.executeCommand(fullCommand, { cwd: certDir });
            return apiResponse.success(res, {
              output: result.stdout || result.stderr,
              command: fullCommand,
              certificateDir: certDir,
              format: format
            });
          } catch (error) {
            console.error('Certificate generation error:', error);
            return apiResponse.serverError(res, 
              `Certificate generation failed: ${error.error || error.message}`
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
        const isKeyFile = fileInfo.name.endsWith('-key.pem') || fileInfo.name.endsWith('.key');
        
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
        
        // Determine format based on file extension
        let format = 'pem';
        if (fileInfo.name.endsWith('.crt') || fileInfo.name.endsWith('.key')) {
          format = 'crt';
        }
        
        return {
          filename: fileInfo.name,
          path: fileInfo.fullPath,
          size: stats.size,
          modified: stats.mtime,
          expiry: expiry,
          domains: domains,
          fingerprint: fingerprint,
          type: isKeyFile ? 'key' : 'cert',
          format: format,
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
      
      // Handle both .pem and .crt/.key patterns
      let baseName;
      if (cert.filename.endsWith('-key.pem')) {
        baseName = cert.filename.replace(/-key\.pem$/, '');
      } else if (cert.filename.endsWith('.key')) {
        baseName = cert.filename.replace(/\.key$/, '');
      } else if (cert.filename.endsWith('.pem')) {
        baseName = cert.filename.replace(/\.pem$/, '');
      } else if (cert.filename.endsWith('.crt')) {
        baseName = cert.filename.replace(/\.crt$/, '');
      } else {
        baseName = cert.filename;
      }
      
      if (!grouped[baseName]) {
        grouped[baseName] = {
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
          canEdit: cert.canEdit !== false // Default to true unless explicitly false
        };
      }
      
      if (cert.type === 'cert') {
        grouped[baseName].cert = cert;
        grouped[baseName].domains = cert.domains || [];
        grouped[baseName].expiry = cert.expiry;
        grouped[baseName].fingerprint = cert.fingerprint;
        grouped[baseName].format = cert.format;
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
        return apiResponse.serverError(res, 'Could not determine CA root directory');
      }

      const fs = require('fs').promises;
      const rootCAPath = path.join(caRoot, 'rootCA.pem');
      
      // Check if root CA exists
      try {
        await fs.access(rootCAPath);
      } catch (error) {
        return apiResponse.notFound(res, 'Root CA certificate not found');
      }

      // Get certificate details using OpenSSL
      const certInfoResult = await security.executeCommand(`openssl x509 -in "${rootCAPath}" -noout -subject -issuer -dates`);
      
      // Get fingerprint separately to handle multiline output
      const fingerprintResult = await security.executeCommand(`openssl x509 -in "${rootCAPath}" -noout -fingerprint -sha256`);
      
      if (!certInfoResult.stdout) {
        return apiResponse.serverError(res, 'Could not read certificate information');
      }

      const certInfo = certInfoResult.stdout;
      const fingerprintOutput = fingerprintResult.stdout || '';
      
      console.log('Debug - fingerprint output:', JSON.stringify(fingerprintOutput));
      
      // Parse certificate information
      const subjectMatch = certInfo.match(/subject=(.+)/);
      const issuerMatch = certInfo.match(/issuer=(.+)/);
      const notAfterMatch = certInfo.match(/notAfter=(.+)/);
      
      // Parse fingerprint from dedicated output  
      const fingerprintMatch = fingerprintOutput.match(/sha256 Fingerprint=(.+)/s);
      console.log('Debug - fingerprint match:', fingerprintMatch);

      const subject = subjectMatch ? subjectMatch[1].trim() : 'Unknown';
      const issuer = issuerMatch ? issuerMatch[1].trim() : 'Unknown';
      const expiry = notAfterMatch ? new Date(notAfterMatch[1].trim()).toISOString() : null;
      const fingerprint = fingerprintMatch ? fingerprintMatch[1].replace(/\s+/g, '').trim() : 'Unknown';

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
      apiResponse.serverError(res, 'Failed to get root CA information: ' + error.message);
    }
  }));

  // Generate PFX certificate endpoint
  router.post('/api/generate/pfx/:folder/:certname', requireAuth, cliRateLimiter, asyncHandler(async (req, res) => {
    const { folder: rawFolder, certname: rawCertname } = req.params;
    const { password } = req.body;
    
    try {
      // Validate and sanitize path parameters
      const { folder, certname } = validatePathParams(rawFolder, rawCertname);
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
      
      const certFile = path.join(sourceDir, `${certname}.pem`);
      const keyFile = path.join(sourceDir, `${certname}-key.pem`);
      const pfxFile = path.join(sourceDir, `${certname}.pfx`);
      
      const fs = require('fs');
      
      // Check if certificate and key files exist
      if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
        return apiResponse.notFound(res, 'Certificate or key file not found');
      }
      
      // Generate PFX file using OpenSSL
      let opensslCommand = `openssl pkcs12 -export -out "${pfxFile}" -inkey "${keyFile}" -in "${certFile}"`;
      
      if (password && password.trim() !== '') {
        opensslCommand += ` -passout pass:${password}`;
      } else {
        opensslCommand += ` -passout pass:`;
      }
      
      const result = await security.executeCommand(opensslCommand);
      
      // If we get here without an exception, the command succeeded
      // Return the PFX file for download
      res.download(pfxFile, `${certname}.pfx`, (err) => {
        if (err) {
          console.error('PFX download error:', err);
        }
        // Clean up the temporary PFX file
        if (fs.existsSync(pfxFile)) {
          fs.unlinkSync(pfxFile);
        }
      });
    } catch (error) {
      console.error('PFX generation error:', error);
      if (error.message.includes('Path validation failed')) {
        return apiResponse.badRequest(res, error.message);
      }
      apiResponse.serverError(res, `Failed to generate PFX: ${error.message}`);
    }
  }));

  // Archive certificate endpoint
  router.post('/api/certificates/:folder/:certname/archive', requireAuth, cliRateLimiter, asyncHandler(async (req, res) => {
    const { folder: rawFolder, certname: rawCertname } = req.params;
    
    try {
      // Validate and sanitize path parameters
      const { folder, certname } = validatePathParams(rawFolder, rawCertname);
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
      if (error.message.includes('Path validation failed')) {
        return apiResponse.badRequest(res, error.message);
      }
      apiResponse.serverError(res, `Failed to archive certificate: ${error.message}`);
    }
  }));

  // Restore certificate from archive endpoint
  router.post('/api/certificates/:folder/:certname/restore', requireAuth, cliRateLimiter, asyncHandler(async (req, res) => {
    const { folder: rawFolder, certname: rawCertname } = req.params;
    
    try {
      // Validate and sanitize path parameters
      const { folder, certname } = validatePathParams(rawFolder, rawCertname);
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
      if (error.message.includes('Path validation failed')) {
        return apiResponse.badRequest(res, error.message);
      }
      apiResponse.serverError(res, `Failed to restore certificate: ${error.message}`);
    }
  }));

  // Download certificate file
  router.get('/api/download/cert/:folder/:filename', requireAuth, generalRateLimiter, asyncHandler(async (req, res) => {
    const { folder: rawFolder, filename: rawFilename } = req.params;
    
    try {
      // Validate and sanitize path parameters
      const { folder, filename } = validatePathParams(rawFolder, null, rawFilename);
      
      // Double-check for path traversal attempts (belt and suspenders)
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return apiResponse.badRequest(res, 'Invalid filename: path traversal attempt detected');
      }
      
      const certificatesDir = path.join(process.cwd(), 'certificates');
      
      // Determine the file path based on folder parameter
      let filePath;
      if (folder === 'interface-ssl' || folder === 'legacy') {
        filePath = path.join(certificatesDir, filename);
      } else if (folder && /^\d{4}-\d{2}-\d{2}$/.test(folder)) {
        filePath = path.join(certificatesDir, folder, filename);
      } else {
        return apiResponse.badRequest(res, 'Invalid folder parameter');
      }
      
      const fs = require('fs');
      if (!fs.existsSync(filePath)) {
        return apiResponse.notFound(res, 'Certificate file not found');
      }
      
      res.download(filePath, filename);
    } catch (error) {
      console.error('Download error:', error);
      if (error.message.includes('Path validation failed')) {
        return apiResponse.badRequest(res, error.message);
      }
      apiResponse.serverError(res, `Failed to download certificate: ${error.message}`);
    }
  }));

  // Download private key file
  router.get('/api/download/key/:folder/:filename', requireAuth, generalRateLimiter, asyncHandler(async (req, res) => {
    const { folder: rawFolder, filename: rawFilename } = req.params;
    
    try {
      // Validate and sanitize path parameters
      const { folder, filename } = validatePathParams(rawFolder, null, rawFilename);
      const certificatesDir = path.join(process.cwd(), 'certificates');
      
      // Determine the file path based on folder parameter
      let filePath;
      if (folder === 'interface-ssl' || folder === 'legacy') {
        filePath = path.join(certificatesDir, filename);
      } else if (folder && /^\d{4}-\d{2}-\d{2}$/.test(folder)) {
        filePath = path.join(certificatesDir, folder, filename);
      } else {
        return apiResponse.badRequest(res, 'Invalid folder parameter');
      }
      
      const fs = require('fs');
      if (!fs.existsSync(filePath)) {
        return apiResponse.notFound(res, 'Key file not found');
      }
      
      res.download(filePath, filename);
    } catch (error) {
      console.error('Download error:', error);
      if (error.message.includes('Path validation failed')) {
        return apiResponse.badRequest(res, error.message);
      }
      apiResponse.serverError(res, `Failed to download key: ${error.message}`);
    }
  }));

  // Download certificate bundle as ZIP
  router.get('/api/download/bundle/:folder/:certname', requireAuth, generalRateLimiter, asyncHandler(async (req, res) => {
    const { folder: rawFolder, certname: rawCertname } = req.params;
    
    try {
      // Validate and sanitize path parameters
      const { folder, certname } = validatePathParams(rawFolder, rawCertname);
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
      
      const certFile = path.join(sourceDir, `${certname}.pem`);
      const keyFile = path.join(sourceDir, `${certname}-key.pem`);
      
      const fs = require('fs');
      const archiver = require('archiver');
      
      if (!fs.existsSync(certFile) && !fs.existsSync(keyFile)) {
        return apiResponse.notFound(res, 'Certificate files not found');
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
      if (error.message.includes('Path validation failed')) {
        return apiResponse.badRequest(res, error.message);
      }
      apiResponse.serverError(res, `Failed to download bundle: ${error.message}`);
    }
  }));

  // Download root CA certificate
  router.get('/api/download/rootca', requireAuth, generalRateLimiter, asyncHandler(async (req, res) => {
    try {
      const result = await security.executeCommand('mkcert -CAROOT');
      const caRoot = result.stdout.trim();
      const rootCAPath = path.join(caRoot, 'rootCA.pem');
      
      const fs = require('fs');
      if (!fs.existsSync(rootCAPath)) {
        return apiResponse.notFound(res, 'Root CA certificate not found');
      }
      
      res.download(rootCAPath, 'mkcert-rootCA.pem');
    } catch (error) {
      console.error('Root CA download error:', error);
      apiResponse.serverError(res, `Failed to download root CA: ${error.message}`);
    }
  }));

  return router;
};

module.exports = {
  createCertificateRoutes
};
