// Certificate management routes module
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fsSync = require('fs');
const fs = require('fs').promises;
const security = require('../security');
const certificateUtils = require('../utils/certificates');
const { apiResponse, asyncHandler, validateRequest } = require('../utils/responses');
const { createNotesStore } = require('../services/notesStore');

const createCertificateRoutes = (config, rateLimiters, requireAuth, notesStore = createNotesStore()) => {
  const router = express.Router();
  const { cliRateLimiter, generalRateLimiter } = rateLimiters;

  // Note-store key for a grouped certificate. Mirrors the folder identifiers
  // the frontend uses for API calls (locationOf in public/js/cert-model.js).
  const noteKeyForCert = (group) => {
    let folder;
    if (group.isInterfaceSSL) folder = 'interface-ssl';
    else if (group.folder) folder = group.folder;
    else if (group.name === 'mkcert-rootCA') folder = 'root-ca';
    else folder = 'legacy';
    return `${folder}/${group.name}`;
  };

  // The .pem / -key.pem pair for `certname` inside `dir`, resolved through
  // the security helpers (throws on an unsafe name). Each file must sit
  // directly in `dir`: the helper URL-decodes again, so a name Express has
  // already decoded once (e.g. "archive%2Ftw") could otherwise reach a
  // subdirectory such as archive/.
  const pemPairIn = (dir, certname) => {
    const inDir = (filename) => {
      const resolved = security.validateAndSanitizePath(filename, dir).resolved;
      if (path.dirname(resolved) !== path.resolve(dir)) {
        throw new Error(`Invalid path: ${filename} is not directly inside its folder`);
      }
      return resolved;
    };
    return { cert: inDir(`${certname}.pem`), key: inDir(`${certname}-key.pem`) };
  };
  const pairExists = (pair) => fsSync.existsSync(pair.cert) || fsSync.existsSync(pair.key);
  const twinExists = (res, message) => apiResponse.conflict(res, message, { code: 'TWIN_EXISTS' });

  // Temp files from an interrupted swap of `certname`, named as in the restore
  // route: <SWAP_TEMP_PREFIX><16 hex>-<certname>.pem / -key.pem inside archive/.
  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const SWAP_TEMP = new RegExp(`^${escapeRegExp(certificateUtils.SWAP_TEMP_PREFIX)}[0-9a-f]{16}-`);
  const hasSwapLeftovers = (archiveDir, certname) => {
    let entries;
    try {
      entries = fsSync.readdirSync(archiveDir);
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
    return entries.some((f) => SWAP_TEMP.test(f) &&
      [`${certname}.pem`, `${certname}-key.pem`].includes(f.replace(SWAP_TEMP, '')));
  };

  // Exchange an active pair with its archived twin without overwriting
  // anything. Per file: active -> temp, archived -> active, temp -> archived.
  // Either side may hold only the cert or only the key. If any rename throws,
  // the renames already done are undone in reverse order and the error is
  // rethrown, with err.rollbackFailures listing any rename that could not be undone.
  const swapPairs = (active, archived, temp) => {
    const done = [];
    const move = (from, to) => {
      if (fsSync.existsSync(to)) throw new Error(`refusing to overwrite ${path.basename(to)}`);
      fsSync.renameSync(from, to);
      done.push([from, to]);
    };
    try {
      for (const kind of ['cert', 'key']) {
        const hadActive = fsSync.existsSync(active[kind]);
        if (hadActive) move(active[kind], temp[kind]);
        if (fsSync.existsSync(archived[kind])) move(archived[kind], active[kind]);
        if (hadActive) move(temp[kind], archived[kind]);
      }
    } catch (err) {
      const failures = [];
      for (const [from, to] of done.reverse()) {
        try {
          fsSync.renameSync(to, from);
        } catch (undoErr) {
          failures.push(`${to} -> ${from}: ${undoErr.message}`);
        }
      }
      if (failures.length) err.rollbackFailures = failures;
      throw err;
    }
  };

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
          // SECURITY: mkcert -uninstall is destructive (breaks trust for every
          // cert this server issued). Mirror the guards on POST /api/uninstall-ca
          // so this path can't be used to bypass them.
          if (!config.auth.enabled && !config.oidc.enabled) {
            return apiResponse.forbidden(res, 'mkcert -uninstall is destructive and is only available when authentication is enabled');
          }
          if (req.body?.confirm !== true) {
            return apiResponse.badRequest(res, 'Pass { "confirm": true } to acknowledge this will remove the local root CA from the system trust store');
          }
          console.warn(`⚠ mkcert -uninstall requested by ${req.session?.username || req.user?.email || 'unknown'} from ${req.ip}`);
          fullCommand = 'mkcert -uninstall';
          break;
        case 'generate':
          if (!sanitizedInput) {
            return apiResponse.badRequest(res, 'Domain names are required for certificate generation');
          }
          
          // Get format from request body, default to 'pem'
          const format = req.body.format || 'pem';
          if (!['pem', 'crt', 'p12', 'p12-client'].includes(format)) {
            return apiResponse.badRequest(res, 'Invalid certificate format. Must be "pem", "crt", "p12", or "p12-client"');
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

          if (format === 'crt') {
            fullCommand = `mkcert -cert-file "${domainName}.crt" -key-file "${domainName}.key" ${sanitizedInput}`;
          } else if (format === 'p12') {
            // P12/PFX format - PKCS#12 bundle
            fullCommand = `mkcert -pkcs12 -p12-file "${domainName}.p12" ${sanitizedInput}`;
          } else if (format === 'p12-client') {
            // P12 with client authentication flag for S/MIME and client certificates
            fullCommand = `mkcert -pkcs12 -client -p12-file "${domainName}.p12" ${sanitizedInput}`;
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
        default:
          return apiResponse.badRequest(res, 'Invalid command');
      }

      // Execute command (generate case handles its own execution above)
      if (command !== 'generate') {
        const result = await security.executeCommand(fullCommand);

        apiResponse.success(res, {
          output: result.stdout || result.stderr,
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
        const isP12File = fileInfo.name.endsWith('.p12') || fileInfo.name.endsWith('.pfx');
        
        // Only get certificate info for actual certificate files, not key files or P12 files
        // P12 files are binary PKCS#12 format and can't be inspected with openssl x509
        const expiry = (isKeyFile || isP12File) ? null : await certificateUtils.getCertificateExpiry(fileInfo.fullPath);
        const domains = (isKeyFile || isP12File) ? [] : await certificateUtils.getCertificateDomains(fileInfo.fullPath);
        const fingerprint = (isKeyFile || isP12File) ? null : await certificateUtils.getCertificateFingerprint(fileInfo.fullPath);
        
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
        } else if (fileInfo.name.endsWith('.p12') || fileInfo.name.endsWith('.pfx')) {
          format = 'p12';
        }
        
        return {
          filename: fileInfo.name,
          path: fileInfo.fullPath,
          size: stats.size,
          modified: stats.mtime,
          expiry: expiry,
          domains: domains,
          fingerprint: fingerprint,
          type: isKeyFile ? 'key' : (isP12File ? 'p12' : 'cert'),
          format: format,
          folder: dateFolder,
          folderDate: dateFolder && /^\d{4}-\d{2}-\d{2}$/.test(dateFolder) ? dateFolder : null,
          isArchived: isArchived,
          isInterfaceSSL: isInterfaceSSLCert,
          canEdit: pathParts[0] !== 'uploaded' && !isInterfaceSSLCert, // Read-only for uploaded certs and interface SSL certs
          relativePath: fileInfo.relativePath
        };
      } catch (err) {
        // Deleted by another request since the directory scan: just skip it.
        if (err.code === 'ENOENT') return { filename: fileInfo.name, error: 'File no longer exists' };
        console.error(`Error processing certificate ${fileInfo.fullPath}:`, err);
        return {
          filename: fileInfo.name,
          path: fileInfo.fullPath,
          error: 'Could not read certificate details'
        };
      }
    }));
    
    // Group certificate files into logical certificates, keyed by folder +
    // base name so same-named certs in different folders don't collide.
    const groupedCertificates = certificateUtils.groupCertificates(certificates);

    for (const group of groupedCertificates) {
      const note = notesStore.get(noteKeyForCert(group));
      if (note !== undefined) group.note = note;
    }

    apiResponse.success(res, {
      certificates: groupedCertificates,
      total: groupedCertificates.length
    });
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
      
      
      // Parse certificate information
      const subjectMatch = certInfo.match(/subject=(.+)/);
      const issuerMatch = certInfo.match(/issuer=(.+)/);
      const notAfterMatch = certInfo.match(/notAfter=(.+)/);
      
      // Parse fingerprint from dedicated output  
      const fingerprintMatch = fingerprintOutput.match(/sha256 Fingerprint=(.+)/s);

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
    const { folder, certname } = req.params;
    const { password } = req.body;
    const certificatesDir = path.join(process.cwd(), 'certificates');

    // Validate the certificate name through security module (throws on invalid)
    try {
      security.validateFilename(`${certname}.pem`);
    } catch (err) {
      return apiResponse.badRequest(res, 'Invalid certificate name');
    }

    // Determine the source directory based on folder parameter
    let sourceDir;
    if (folder === 'interface-ssl' || folder === 'legacy') {
      sourceDir = certificatesDir;
    } else if (folder && /^\d{4}-\d{2}-\d{2}$/.test(folder)) {
      sourceDir = path.join(certificatesDir, folder);
    } else {
      return apiResponse.badRequest(res, 'Invalid folder parameter');
    }

    // validateAndSanitizePath returns { safe, sanitized, resolved, relative } — use .resolved
    let certFile, keyFile, pfxFile;
    try {
      certFile = security.validateAndSanitizePath(`${certname}.pem`, sourceDir).resolved;
      keyFile  = security.validateAndSanitizePath(`${certname}-key.pem`, sourceDir).resolved;
      pfxFile  = security.validateAndSanitizePath(`${certname}.pfx`, sourceDir).resolved;
    } catch (error) {
      return apiResponse.badRequest(res, 'Invalid file path');
    }

    const fsSync = require('fs');
    if (!fsSync.existsSync(certFile) || !fsSync.existsSync(keyFile)) {
      return apiResponse.notFound(res, 'Certificate or key file not found');
    }

    // SECURITY: never interpolate the password into a shell string.
    // Write it to a temp file and pass via `-passout file:"..."` so even
    // shell metacharacters in the password cannot escape.
    const os = require('os');
    const crypto = require('crypto');
    const passFile = password && password.trim() !== ''
      ? path.join(os.tmpdir(), `mkcertweb-pfxpass-${crypto.randomBytes(8).toString('hex')}`)
      : null;

    const opensslCommand = passFile
      ? `openssl pkcs12 -export -out "${pfxFile}" -inkey "${keyFile}" -in "${certFile}" -passout file:"${passFile}"`
      : `openssl pkcs12 -export -out "${pfxFile}" -inkey "${keyFile}" -in "${certFile}" -passout pass:`;

    try {
      if (passFile) {
        // Write without trailing newline; 0600 perms.
        await fs.writeFile(passFile, password, { encoding: 'utf8', mode: 0o600 });
      }

      await security.executeCommand(opensslCommand);

      res.download(pfxFile, `${certname}.pfx`, (err) => {
        if (err) console.error('PFX download error:', err);
        if (fsSync.existsSync(pfxFile)) fsSync.unlinkSync(pfxFile);
      });
    } catch (error) {
      console.error('PFX generation error:', error);
      if (fsSync.existsSync(pfxFile)) {
        try { fsSync.unlinkSync(pfxFile); } catch (_) {}
      }
      // The raw error embeds the openssl command line (absolute server paths); keep it in the log only.
      return apiResponse.serverError(res, 'failed to generate PFX');
    } finally {
      if (passFile && fsSync.existsSync(passFile)) {
        try { fsSync.unlinkSync(passFile); } catch (_) {}
      }
    }
  }));

  // Archive certificate endpoint
  router.post('/api/certificates/:folder/:certname/archive', requireAuth, cliRateLimiter, asyncHandler(async (req, res) => {
    const { folder, certname } = req.params;
    const certificatesDir = path.join(process.cwd(), 'certificates');
    
    // Validate the certificate name through security module
    // (validateFilename throws on invalid input — it does not return false).
    try {
      security.validateFilename(`${certname}.pem`);
    } catch (error) {
      return apiResponse.badRequest(res, 'Invalid certificate name');
    }

    // Determine the source directory based on folder parameter
    let sourceDir;
    if (folder === 'interface-ssl' || folder === 'legacy') {
      sourceDir = certificatesDir;
    } else if (folder && /^\d{4}-\d{2}-\d{2}$/.test(folder)) {
      sourceDir = path.join(certificatesDir, folder);
    } else {
      return apiResponse.badRequest(res, 'Invalid folder parameter');
    }

    // Use security-validated paths
    let active, archiveDir, archived;
    try {
      active = pemPairIn(sourceDir, certname);
      archiveDir = security.validateAndSanitizePath('archive', sourceDir).resolved;
      archived = pemPairIn(archiveDir, certname);
    } catch (error) {
      return apiResponse.badRequest(res, 'Invalid file path');
    }

    // Never overwrite an archived certificate of the same name.
    if (pairExists(archived)) {
      return twinExists(res, `an archived "${certname}" already exists in this folder`);
    }

    // Nothing to archive: the list was stale (deleted or archived elsewhere).
    if (!pairExists(active)) {
      return apiResponse.notFound(res, 'Certificate files not found');
    }

    try {
      // Ensure archive directory exists
      if (!fsSync.existsSync(archiveDir)) {
        fsSync.mkdirSync(archiveDir, { recursive: true });
      }

      // Move certificate files to archive
      if (fsSync.existsSync(active.cert)) fsSync.renameSync(active.cert, archived.cert);
      if (fsSync.existsSync(active.key)) fsSync.renameSync(active.key, archived.key);

      apiResponse.success(res, { message: `Certificate ${certname} archived successfully` });
    } catch (error) {
      console.error('Archive error:', error);
      apiResponse.serverError(res, `Failed to archive certificate: ${error.message}`);
    }
  }));

  // Delete certificate endpoint
  router.delete('/api/certificates/:folder/:certname', requireAuth, cliRateLimiter, asyncHandler(async (req, res) => {
    const { folder, certname } = req.params;
    const certificatesDir = path.join(process.cwd(), 'certificates');
    
    // Validate the certificate name through security module
    try {
      security.validateFilename(`${certname}.pem`);
    } catch (error) {
      return apiResponse.badRequest(res, 'Invalid certificate name');
    }
    
    // Determine the source directory based on folder parameter
    let sourceDir;
    if (folder === 'interface-ssl' || folder === 'legacy') {
      sourceDir = certificatesDir;
    } else if (folder && /^\d{4}-\d{2}-\d{2}$/.test(folder)) {
      sourceDir = path.join(certificatesDir, folder);
    } else {
      return apiResponse.badRequest(res, 'Invalid folder parameter');
    }
    
    // ?archived=true deletes the archive/ copy, ?archived=false the active
    // copy; absent, the active copy if it exists, else the archived one.
    // An active cert and an archived cert can share a name, so one request
    // never deletes both.
    const archivedParam = req.query.archived;
    if (archivedParam !== undefined && archivedParam !== 'true' && archivedParam !== 'false') {
      return apiResponse.badRequest(res, 'archived must be "true" or "false"');
    }

    // Use security-validated paths. Archived certificates live in the
    // folder's archive/ subdirectory (see the /archive endpoint above).
    let active, archived;
    try {
      const archiveDir = security.validateAndSanitizePath('archive', sourceDir).resolved;
      active = pemPairIn(sourceDir, certname);
      archived = pemPairIn(archiveDir, certname);
    } catch (error) {
      return apiResponse.badRequest(res, 'Invalid file path');
    }

    let scope;
    if (archivedParam === 'true') scope = 'archived';
    else if (archivedParam === 'false') scope = 'active';
    else scope = pairExists(active) ? 'active' : 'archived';
    const target = scope === 'active' ? active : archived;

    try {
      const deletedFiles = [];
      if (fsSync.existsSync(target.cert)) {
        fsSync.unlinkSync(target.cert);
        deletedFiles.push(`${certname}.pem`);
      }
      if (fsSync.existsSync(target.key)) {
        fsSync.unlinkSync(target.key);
        deletedFiles.push(`${certname}-key.pem`);
      }

      if (deletedFiles.length === 0) {
        return apiResponse.notFound(res,
          scope === 'archived' ? 'Archived certificate files not found' : 'Certificate files not found');
      }

      // Both copies share one note; keep it while either copy remains.
      if (!pairExists(active) && !pairExists(archived)) {
        notesStore.remove(`${folder}/${certname}`);
      }

      apiResponse.success(res, {
        message: `Certificate ${certname} deleted successfully`,
        deletedFiles,
        scope
      });
    } catch (error) {
      console.error('Delete error:', error);
      apiResponse.serverError(res, `Failed to delete certificate: ${error.message}`);
    }
  }));

  // Restore certificate from archive endpoint
  router.post('/api/certificates/:folder/:certname/restore', requireAuth, cliRateLimiter, asyncHandler(async (req, res) => {
    const { folder, certname } = req.params;
    const certificatesDir = path.join(process.cwd(), 'certificates');
    
    // Validate the certificate name through security module
    try {
      security.validateFilename(`${certname}.pem`);
    } catch (error) {
      return apiResponse.badRequest(res, 'Invalid certificate name');
    }
    
    // Determine the target directory based on folder parameter
    let targetDir;
    if (folder === 'interface-ssl' || folder === 'legacy') {
      targetDir = certificatesDir;
    } else if (folder && /^\d{4}-\d{2}-\d{2}$/.test(folder)) {
      targetDir = path.join(certificatesDir, folder);
    } else {
      return apiResponse.badRequest(res, 'Invalid folder parameter');
    }

    const swapParam = req.query.swap;
    if (swapParam !== undefined && swapParam !== 'true' && swapParam !== 'false') {
      return apiResponse.badRequest(res, 'swap must be "true" or "false"');
    }

    // Use security-validated paths
    let archiveDir, archived, active;
    try {
      archiveDir = security.validateAndSanitizePath('archive', targetDir).resolved;
      archived = pemPairIn(archiveDir, certname);
      active = pemPairIn(targetDir, certname);
    } catch (error) {
      return apiResponse.badRequest(res, 'Invalid file path');
    }

    // An interrupted swap leaves one of the pair under a temp name; moving
    // anything now could strand it further.
    if (hasSwapLeftovers(archiveDir, certname)) {
      return apiResponse.conflict(res,
        `an interrupted swap left temporary files for "${certname}"; resolve them manually`,
        { code: 'SWAP_INCOMPLETE' });
    }

    if (!pairExists(archived)) {
      return apiResponse.notFound(res, 'Archived certificate files not found');
    }

    // An active certificate of the same name is never overwritten: refuse,
    // or with ?swap=true exchange the two copies.
    const twin = pairExists(active);
    if (twin && swapParam !== 'true') {
      return twinExists(res, `an active "${certname}" already exists in this folder`);
    }

    if (twin) {
      // The swap parks the active pair in archive/ under a temp name, which
      // is longer than the certificate name and must still be valid.
      let temp;
      try {
        const tempName = `${certificateUtils.SWAP_TEMP_PREFIX}${crypto.randomBytes(8).toString('hex')}-${certname}`;
        security.validateFilename(`${tempName}-key.pem`);
        temp = pemPairIn(archiveDir, tempName);
      } catch (error) {
        return apiResponse.badRequest(res, 'Certificate name is too long to swap with the active copy');
      }
      try {
        swapPairs(active, archived, temp);
        return apiResponse.success(res, {
          message: `Certificate ${certname} swapped with the active copy`,
          swapped: true
        });
      } catch (error) {
        console.error('Restore swap error:', error);
        if (error.rollbackFailures) {
          console.error('Restore swap rollback incomplete:', error.rollbackFailures);
          return apiResponse.serverError(res,
            `Failed to swap certificate ${certname} and could not fully roll back; check its archive folder for .swap-* files`);
        }
        return apiResponse.serverError(res, `Failed to swap certificate: ${error.message}`);
      }
    }

    try {
      // Move certificate files from archive back to main directory
      if (fsSync.existsSync(archived.cert)) fsSync.renameSync(archived.cert, active.cert);
      if (fsSync.existsSync(archived.key)) fsSync.renameSync(archived.key, active.key);

      apiResponse.success(res, { message: `Certificate ${certname} restored successfully`, swapped: false });
    } catch (error) {
      console.error('Restore error:', error);
      apiResponse.serverError(res, `Failed to restore certificate: ${error.message}`);
    }
  }));

  // Save (or clear) the per-certificate note. Notes are UI metadata, so this
  // is allowed even for read-only certificates and does not require the cert
  // files to exist — orphaned entries are invisible and cleaned on delete.
  router.put('/api/certificates/:folder/:certname/notes', requireAuth, generalRateLimiter, asyncHandler(async (req, res) => {
    const { folder, certname } = req.params;

    const folderOk = folder === 'interface-ssl' || folder === 'legacy' || folder === 'root-ca'
      || /^\d{4}-\d{2}-\d{2}$/.test(folder);
    if (!folderOk) {
      return apiResponse.badRequest(res, 'Invalid folder parameter');
    }
    try {
      security.validateFilename(`${certname}.pem`);
    } catch (error) {
      return apiResponse.badRequest(res, 'Invalid certificate name');
    }

    const note = req.body ? req.body.note : undefined;
    if (typeof note !== 'string') {
      return apiResponse.badRequest(res, 'note must be a string');
    }
    if (note.length > 2000) {
      return apiResponse.badRequest(res, 'note must be 2000 characters or fewer');
    }

    const saved = notesStore.set(`${folder}/${certname}`, note);
    apiResponse.success(res, { note: saved });
  }));

  // Download certificate file
  router.get('/api/download/cert/:folder/:filename', requireAuth, generalRateLimiter, asyncHandler(async (req, res) => {
    const { folder, filename } = req.params;
    const certificatesDir = path.join(process.cwd(), 'certificates');
    
    // Validate the filename through security module
    try {
      security.validateFilename(filename);
    } catch (error) {
      return apiResponse.badRequest(res, 'Invalid filename');
    }
    
    // Determine the source directory based on folder parameter
    let sourceDir;
    if (folder === 'interface-ssl' || folder === 'legacy') {
      sourceDir = certificatesDir;
    } else if (folder && /^\d{4}-\d{2}-\d{2}$/.test(folder)) {
      sourceDir = path.join(certificatesDir, folder);
    } else {
      return apiResponse.badRequest(res, 'Invalid folder parameter');
    }
    
    // Use security-validated path
    let filePath;
    try {
      const pathInfo = security.validateAndSanitizePath(filename, sourceDir);
      filePath = pathInfo.resolved;
    } catch (error) {
      return apiResponse.badRequest(res, 'Invalid file path');
    }
    
    try {
      const fs = require('fs');
      if (!fs.existsSync(filePath)) {
        return apiResponse.notFound(res, 'Certificate file not found');
      }
      
      res.download(filePath, filename);
    } catch (error) {
      console.error('Download error:', error);
      apiResponse.serverError(res, `Failed to download certificate: ${error.message}`);
    }
  }));

  // Download private key file
  router.get('/api/download/key/:folder/:filename', requireAuth, generalRateLimiter, asyncHandler(async (req, res) => {
    const { folder, filename } = req.params;
    const certificatesDir = path.join(process.cwd(), 'certificates');
    
    // Validate the filename through security module
    try {
      security.validateFilename(filename);
    } catch (error) {
      return apiResponse.badRequest(res, 'Invalid filename');
    }
    
    // Determine the source directory based on folder parameter
    let sourceDir;
    if (folder === 'interface-ssl' || folder === 'legacy') {
      sourceDir = certificatesDir;
    } else if (folder && /^\d{4}-\d{2}-\d{2}$/.test(folder)) {
      sourceDir = path.join(certificatesDir, folder);
    } else {
      return apiResponse.badRequest(res, 'Invalid folder parameter');
    }
    
    // Use security-validated path
    let filePath;
    try {
      const pathInfo = security.validateAndSanitizePath(filename, sourceDir);
      filePath = pathInfo.resolved;
    } catch (error) {
      return apiResponse.badRequest(res, 'Invalid file path');
    }
    
    try {
      const fs = require('fs');
      if (!fs.existsSync(filePath)) {
        return apiResponse.notFound(res, 'Key file not found');
      }
      
      res.download(filePath, filename);
    } catch (error) {
      console.error('Download error:', error);
      apiResponse.serverError(res, `Failed to download key: ${error.message}`);
    }
  }));

  // Download certificate bundle as ZIP
  router.get('/api/download/bundle/:folder/:certname', requireAuth, generalRateLimiter, asyncHandler(async (req, res) => {
    const { folder, certname } = req.params;
    const certificatesDir = path.join(process.cwd(), 'certificates');
    
    // Validate the certificate name through security module
    try {
      security.validateFilename(`${certname}.pem`);
    } catch (error) {
      return apiResponse.badRequest(res, 'Invalid certificate name');
    }
    
    // Determine the source directory based on folder parameter
    let sourceDir;
    if (folder === 'interface-ssl' || folder === 'legacy') {
      sourceDir = certificatesDir;
    } else if (folder && /^\d{4}-\d{2}-\d{2}$/.test(folder)) {
      sourceDir = path.join(certificatesDir, folder);
    } else {
      return apiResponse.badRequest(res, 'Invalid folder parameter');
    }
    
    // Use security-validated paths - try both .pem and .crt formats
    let certFile, keyFile, certExt, keyExt;
    const fs = require('fs');
    
    try {
      // Try .pem format for certificate
      let certPathInfo = security.validateAndSanitizePath(`${certname}.pem`, sourceDir);
      if (fs.existsSync(certPathInfo.resolved)) {
        certFile = certPathInfo.resolved;
        certExt = '.pem';
      } else {
        // Try .crt format
        certPathInfo = security.validateAndSanitizePath(`${certname}.crt`, sourceDir);
        if (fs.existsSync(certPathInfo.resolved)) {
          certFile = certPathInfo.resolved;
          certExt = '.crt';
        }
      }
      
      // Try -key.pem format for key
      let keyPathInfo = security.validateAndSanitizePath(`${certname}-key.pem`, sourceDir);
      if (fs.existsSync(keyPathInfo.resolved)) {
        keyFile = keyPathInfo.resolved;
        keyExt = '-key.pem';
      } else {
        // Try .key format
        keyPathInfo = security.validateAndSanitizePath(`${certname}.key`, sourceDir);
        if (fs.existsSync(keyPathInfo.resolved)) {
          keyFile = keyPathInfo.resolved;
          keyExt = '.key';
        }
      }
    } catch (error) {
      return apiResponse.badRequest(res, 'Invalid file path');
    }
    
    try {
      const archiver = require('archiver');

      if (!certFile && !keyFile) {
        return apiResponse.notFound(res, 'Certificate files not found');
      }

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${certname}.zip"`);

      const archive = archiver('zip', { zlib: { level: 9 }});

      // Surface archiver errors instead of leaving the response hanging.
      // Once headers are sent we can't 500; the best we can do is destroy
      // the socket so the client sees an aborted download.
      archive.on('error', (err) => {
        console.error('Archive stream error:', err);
        if (!res.headersSent) {
          return apiResponse.serverError(res, `Bundle stream failed: ${err.message}`);
        }
        try { res.destroy(err); } catch (_) {}
      });
      archive.on('warning', (err) => {
        if (err.code !== 'ENOENT') console.warn('Archive warning:', err);
      });

      archive.pipe(res);

      if (certFile) archive.file(certFile, { name: `${certname}${certExt}` });
      if (keyFile)  archive.file(keyFile,  { name: `${certname}${keyExt}` });

      await archive.finalize();
    } catch (error) {
      console.error('Bundle download error:', error);
      if (!res.headersSent) {
        apiResponse.serverError(res, `Failed to download bundle: ${error.message}`);
      }
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
