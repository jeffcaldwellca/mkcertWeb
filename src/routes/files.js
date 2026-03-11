// File management routes module - Refactored to eliminate code duplication
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const multer = require('multer');
const security = require('../security');
const { apiResponse, handleError, asyncHandler } = require('../utils/responses');
const { validateFileRequest, listCertificateFiles, readFileContent } = require('../utils/fileValidation');

const createFileRoutes = (config, rateLimiters, requireAuth) => {
  const router = express.Router();
  const { generalRateLimiter, apiRateLimiter } = rateLimiters;

  // Configure multer for file uploads
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, process.cwd());
    },
    filename: (req, file, cb) => {
      // Validate and sanitize filename
      if (!security.validateFilename(file.originalname)) {
        return cb(new Error('Invalid filename'));
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
        cb(new Error('Only certificate files (.pem, .crt, .key, .p12, .pfx) are allowed'));
      }
    }
  });

  // Download certificate files
  router.get('/download/:filename', requireAuth, generalRateLimiter, asyncHandler(async (req, res) => {
    const { filename } = req.params;
    
    // Validate file request (filename, path, existence)
    const { isValid, safePath } = await validateFileRequest(filename, process.cwd(), res);
    if (!isValid) return; // Error response already sent by validateFileRequest
    
    // Determine content type based on file extension
    let contentType = 'application/x-pem-file';
    if (filename.endsWith('.p12') || filename.endsWith('.pfx')) {
      contentType = 'application/x-pkcs12';
    } else if (filename.endsWith('.crt')) {
      contentType = 'application/x-x509-ca-cert';
    } else if (filename.endsWith('.key')) {
      contentType = 'application/x-pem-file';
    }
    
    // Send file with appropriate headers
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', contentType);
    res.sendFile(safePath);
  }));

  // Upload certificate files
  router.post('/api/upload', requireAuth, apiRateLimiter, upload.array('certificates'), asyncHandler(async (req, res) => {
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

    // Group files by base name
    const fileGroups = {};
    
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

      if (!fileGroups[baseName]) {
        fileGroups[baseName] = { cert: null, key: null, p12: null };
      }

      if (type === 'cert') fileGroups[baseName].cert = file;
      else if (type === 'key') fileGroups[baseName].key = file;
      else if (type === 'p12') fileGroups[baseName].p12 = file;

      // Move file to uploaded folder
      const targetPath = path.join(absoluteUploadedFolder, fileName);
      try {
        // Use copy + unlink instead of rename to handle cross-device moves (EXDEV error)
        await fs.copyFile(file.path, targetPath);
        await fs.unlink(file.path);
        
        results.files.push({
          name: fileName,
          size: file.size,
          type: type
        });
      } catch (moveError) {
        results.errors.push(`Failed to save ${fileName}: ${moveError.message}`);
      }
    }

    // Identify complete and incomplete pairs
    for (const [baseName, group] of Object.entries(fileGroups)) {
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

    apiResponse.success(res, results, 'Upload processing complete');
  }));

  // List files in current directory
  router.get('/api/files', requireAuth, generalRateLimiter, asyncHandler(async (req, res) => {
    try {
      const files = await listCertificateFiles();
      
      apiResponse.success(res, {
        files,
        total: files.length,
        directory: process.cwd()
      });
    } catch (error) {
      handleError(res, error, 'listing files');
    }
  }));

  // Get file content (for viewing certificate content)
  router.get('/api/file/:filename/content', requireAuth, generalRateLimiter, asyncHandler(async (req, res) => {
    const { filename } = req.params;
    
    // Validate file request
    const { isValid, safePath } = await validateFileRequest(filename, process.cwd(), res);
    if (!isValid) return; // Error response already sent
    
    // Read file content
    const content = await readFileContent(safePath, 'utf8', res);
    if (content === null) return; // Error response already sent
    
    apiResponse.success(res, {
      filename,
      content,
      size: content.length
    });
  }));

  // Handle file upload errors
  router.use('/api/upload', (error, req, res, next) => {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return apiResponse.badRequest(res, 'File size too large (max 10MB)');
      }
    }
    
    return apiResponse.badRequest(res, error.message || 'File upload failed');
  });

  return router;
};

module.exports = {
  createFileRoutes
};
