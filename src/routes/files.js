// Certificate upload route module
const express = require('express');
const path = require('path');
const os = require('os');
const fsSync = require('fs');
const fs = require('fs').promises;
const multer = require('multer');
const security = require('../security');
const { apiResponse, asyncHandler } = require('../utils/responses');

// Prefix of the per-request directory multer stages uploads in.
const UPLOAD_STAGING_PREFIX = 'mkcertweb-upload-staging-';

// busboy's errors for a body that isn't valid multipart (truncated, no
// boundary, bad headers). They are the client's fault: 400, not 500.
const MALFORMED_UPLOAD = /^(Unexpected end of (form|file)|Malformed (part header|content type|urlencoded form)|Multipart: Boundary not found|Missing Content-Type|Unsupported content type)/;
const isMalformedUpload = (err) => !!err && !err.syscall && typeof err.message === 'string' && MALFORMED_UPLOAD.test(err.message);

// Remove the request's staging directory (and anything left in it).
const removeStaging = async (req) => {
  if (!req.uploadStagingDir) return;
  const dir = req.uploadStagingDir;
  req.uploadStagingDir = null;
  await fs.rm(dir, { recursive: true, force: true }).catch((err) => {
    console.error('Failed to remove upload staging directory:', err);
  });
};

const createFileRoutes = (config, rateLimiters, requireAuth) => {
  const router = express.Router();
  const { apiRateLimiter } = rateLimiters;

  // Configure multer for file uploads. Files are staged in a private
  // per-request directory under os.tmpdir(), never in the working directory
  // (the read-only code tree under the systemd unit), then moved into the
  // uploaded folder by the handler below.
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        if (!req.uploadStagingDir) {
          req.uploadStagingDir = fsSync.mkdtempSync(path.join(os.tmpdir(), UPLOAD_STAGING_PREFIX));
        }
        cb(null, req.uploadStagingDir);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      // security.validateFilename throws on an unsafe name.
      try {
        security.validateFilename(file.originalname);
      } catch (err) {
        err.expose = true; // our own validation message, safe to show
        return cb(err);
      }
      cb(null, file.originalname);
    }
  });

  const upload = multer({ 
    storage,
    limits: {
      fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: (req, file, cb) => {
      // Allow certificate files: .pem, .crt, .key, .p12, .pfx
      const allowedExtensions = ['.pem', '.crt', '.key', '.p12', '.pfx'];
      const hasAllowedExtension = allowedExtensions.some(ext => file.originalname.endsWith(ext));
      
      if (hasAllowedExtension) {
        cb(null, true);
      } else {
        cb(Object.assign(new Error('Only certificate files (.pem, .crt, .key, .p12, .pfx) are allowed'), { expose: true }));
      }
    }
  });

  // Upload certificate files
  router.post('/api/upload', requireAuth, apiRateLimiter, upload.array('certificates'), asyncHandler(async (req, res) => {
    try {
      await saveUploads(req, res);
    } finally {
      await removeStaging(req); // no-op unless saveUploads threw
    }
  }));

  const saveUploads = async (req, res) => {
    if (!req.files || req.files.length === 0) {
      return apiResponse.badRequest(res, 'No files uploaded');
    }

    const uploadedFolder = config.paths?.uploaded || 'certificates/uploaded';
    const absoluteUploadedFolder = path.resolve(process.cwd(), uploadedFolder);
    
    // Ensure uploaded directory exists
    try {
      await fs.mkdir(absoluteUploadedFolder, { recursive: true });
    } catch (err) {
      console.error('Failed to create uploaded directory:', err);
    }

    const results = {
      success: true,
      completePairs: 0,
      incompletePairs: [],
      errors: [],
      files: []
    };

    // Group files by base name. A Map (not a plain object) so a file named
    // e.g. "__proto__.pem" can't write through to Object.prototype.
    const fileGroups = new Map();
    
    for (const file of req.files) {
      const fileName = file.originalname;
      let baseName = fileName;
      let type = 'unknown';

      if (fileName.endsWith('-key.pem')) {
        baseName = fileName.replace(/-key\.pem$/, '');
        type = 'key';
      } else if (fileName.endsWith('.key')) {
        baseName = fileName.replace(/\.key$/, '');
        type = 'key';
      } else if (fileName.endsWith('.pem')) {
        baseName = fileName.replace(/\.pem$/, '');
        type = 'cert';
      } else if (fileName.endsWith('.crt')) {
        baseName = fileName.replace(/\.crt$/, '');
        type = 'cert';
      } else if (fileName.endsWith('.p12')) {
        baseName = fileName.replace(/\.p12$/, '');
        type = 'p12';
      } else if (fileName.endsWith('.pfx')) {
        baseName = fileName.replace(/\.pfx$/, '');
        type = 'p12';
      }

      if (!fileGroups.has(baseName)) {
        fileGroups.set(baseName, { cert: null, key: null, p12: null });
      }
      const group = fileGroups.get(baseName);
      if (type === 'cert') group.cert = file;
      else if (type === 'key') group.key = file;
      else if (type === 'p12') group.p12 = file;

      // Move file to uploaded folder
      const targetPath = path.join(absoluteUploadedFolder, fileName);
      try {
        // copy + unlink rather than rename: the tmpdir staging area is often
        // on a different filesystem, where rename fails with EXDEV.
        await fs.copyFile(file.path, targetPath);
        await fs.unlink(file.path);
        
        results.files.push({
          name: fileName,
          size: file.size,
          type: type
        });
      } catch (moveError) {
        // The fs error names server paths; keep it in the log.
        console.error(`Failed to save upload ${fileName}:`, moveError);
        results.errors.push(`Failed to save ${fileName}`);
      }
    }

    // Identify complete and incomplete pairs
    for (const [baseName, group] of fileGroups) {
      if (group.p12) {
        results.completePairs++;
      } else if (group.cert && group.key) {
        results.completePairs++;
      } else {
        const missing = !group.cert ? 'certificate' : 'key';
        const hasFile = group.cert ? group.cert.originalname : group.key.originalname;
        results.incompletePairs.push({
          certName: baseName,
          missing: missing,
          hasFile: hasFile
        });
      }
    }

    if (results.completePairs === 0 && results.incompletePairs.length === 0 && results.errors.length > 0) {
      results.success = false;
    }

    await removeStaging(req);
    apiResponse.success(res, results, 'Upload processing complete');
  };

  // Handle file upload errors
  router.use('/api/upload', async (error, req, res, next) => {
    await removeStaging(req);
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return apiResponse.badRequest(res, 'File size too large (max 10MB)');
      }
    }
    
    if (isMalformedUpload(error)) {
      console.warn(`Malformed upload rejected: ${error.message}`);
      return apiResponse.badRequest(res, 'Malformed upload');
    }
    // Multer's own errors and our validation errors (expose) are written for
    // the user; anything else (fs, staging) may name server paths.
    if (error instanceof multer.MulterError || error.expose === true) {
      return apiResponse.badRequest(res, error.message || 'File upload failed');
    }
    return apiResponse.serverError(res, 'File upload failed', error);
  });

  return router;
};

module.exports = {
  createFileRoutes,
  UPLOAD_STAGING_PREFIX
};
