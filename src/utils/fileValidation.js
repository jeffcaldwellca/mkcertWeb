// File validation utilities to eliminate code duplication
const fs = require('fs').promises;
const path = require('path');
const security = require('../security');
const { apiResponse } = require('./responses');

/**
 * Validate filename and return standardized error response if invalid
 */
const validateFilename = (filename, res) => {
  if (!filename || typeof filename !== 'string') {
    apiResponse.badRequest(res, 'Filename is required and must be a string');
    return false;
  }
  
  if (!security.validateFilename(filename)) {
    apiResponse.badRequest(res, 'Invalid filename');
    return false;
  }
  
  return true;
};

/**
 * Validate that filename is a .pem certificate file
 */
const validateCertificateFile = (filename, res) => {
  if (!validateFilename(filename, res)) {
    return false;
  }
  
  if (!filename.endsWith('.pem')) {
    apiResponse.badRequest(res, 'Only certificate files (.pem) are allowed');
    return false;
  }
  
  return true;
};

/**
 * Validate and sanitize file path, return safe path or send error response
 */
const validateAndGetSafePath = async (filename, baseDir, res) => {
  if (!validateCertificateFile(filename, res)) {
    return null;
  }
  
  const safePath = security.validateAndSanitizePath(filename, baseDir);
  if (!safePath) {
    apiResponse.badRequest(res, 'Invalid file path');
    return null;
  }
  
  return safePath;
};

/**
 * Check if file exists and return standardized error if not
 */
const checkFileExists = async (filePath, res) => {
  try {
    await fs.access(filePath);
    return true;
  } catch (err) {
    apiResponse.notFound(res, 'File not found');
    return false;
  }
};

/**
 * Get file stats with error handling
 */
const getFileStats = async (filePath, res) => {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    apiResponse.serverError(res, 'Failed to get file information', error);
    return null;
  }
};

/**
 * Read file content with error handling
 */
const readFileContent = async (filePath, encoding = 'utf8', res) => {
  try {
    return await fs.readFile(filePath, encoding);
  } catch (error) {
    apiResponse.serverError(res, 'Failed to read file content', error);
    return null;
  }
};

/**
 * Delete file with error handling
 */
const deleteFile = async (filePath, res = null) => {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if (res) {
      apiResponse.serverError(res, 'Failed to delete file', error);
    } else {
      console.error('Failed to delete file:', error);
    }
    return false;
  }
};

/**
 * Complete file validation and path resolution workflow
 * Returns { isValid: boolean, safePath: string|null }
 */
const validateFileRequest = async (filename, baseDir = process.cwd(), res) => {
  // Validate filename
  if (!validateCertificateFile(filename, res)) {
    return { isValid: false, safePath: null };
  }
  
  // Get safe path
  const safePath = await validateAndGetSafePath(filename, baseDir, res);
  if (!safePath) {
    return { isValid: false, safePath: null };
  }
  
  // Check if file exists
  const exists = await checkFileExists(safePath, res);
  if (!exists) {
    return { isValid: false, safePath: null };
  }
  
  return { isValid: true, safePath };
};

/**
 * Enhanced file listing with filtering and stats
 */
const listCertificateFiles = async (directory = process.cwd()) => {
  try {
    const files = await fs.readdir(directory);
    const pemFiles = files.filter(file => file.endsWith('.pem'));
    
    const fileStats = await Promise.all(pemFiles.map(async (file) => {
      try {
        const fullPath = path.join(directory, file);
        const stats = await fs.stat(fullPath);
        return {
          name: file,
          path: fullPath,
          size: stats.size,
          modified: stats.mtime,
          isFile: stats.isFile()
        };
      } catch (err) {
        console.error(`Error getting stats for ${file}:`, err);
        return {
          name: file,
          error: 'Could not read file stats'
        };
      }
    }));
    
    return fileStats.filter(file => !file.error);
  } catch (error) {
    throw new Error(`Failed to list certificate files: ${error.message}`);
  }
};

module.exports = {
  validateFilename,
  validateCertificateFile,
  validateAndGetSafePath,
  checkFileExists,
  getFileStats,
  readFileContent,
  deleteFile,
  validateFileRequest,
  listCertificateFiles
};
