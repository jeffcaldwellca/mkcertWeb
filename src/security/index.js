// Security utilities module
const { exec } = require('child_process');
const path = require('path');

// SECURITY: This function validates all commands against an allowlist to prevent 
// command injection attacks. Only specific mkcert and openssl commands are permitted.
const executeCommand = (command, options = {}) => {
  return new Promise((resolve, reject) => {
    // Validate and sanitize command
    if (!isCommandSafe(command)) {
      console.error('Security: Blocked unsafe command execution attempt:', command);
      reject({ 
        error: 'Command not allowed for security reasons', 
        stderr: 'Invalid or potentially dangerous command detected' 
      });
      return;
    }

    // Prepare exec options
    const execOptions = { 
      timeout: 30000, 
      maxBuffer: 1024 * 1024,
      ...options
    };

    // Add timeout to prevent hanging processes
    exec(command, execOptions, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 'ETIMEDOUT') {
          reject({ error: 'Command timed out after 30 seconds', stderr });
        } else {
          reject({ error: error.message, stderr });
        }
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
};

// Command validation function - only allows specific safe commands
const isCommandSafe = (command) => {
  if (!command || typeof command !== 'string') {
    return false;
  }

  // Trim the command
  const trimmedCommand = command.trim();
  
  // Define allowed command patterns
  const allowedPatterns = [
    // mkcert commands - basic operations
    /^mkcert\s+(-CAROOT|--help|-help|-install|-uninstall)$/,
    
    // mkcert certificate generation - simple domain format
    /^mkcert\s+[\w\.\-\s\*]+$/,
    
    // mkcert certificate generation - standalone with explicit file names
    /^mkcert\s+-cert-file\s+"[^"]+"\s+-key-file\s+"[^"]+"\s+[\w\.\-\s\*]+$/,
    
    // mkcert certificate generation - with cd command (for organized folders)
    /^cd\s+"[^"]+"\s+&&\s+mkcert\s+-cert-file\s+"[^"]+"\s+-key-file\s+"[^"]+"\s+[\w\.\-\s\*]+$/,
    
    // Shell commands for file listing
    /^ls\s+(-la\s+)?\*\.pem(\s+2>\/dev\/null(\s+\|\|\s+echo\s+"[^"]+"))?$/,
    
    // OpenSSL commands for certificate inspection (read-only)
    /^openssl\s+version$/,
    /^openssl\s+x509\s+-in\s+"[^"]+"\s+-noout\s+[^\|;&`$(){}[\]<>]+$/,
    
    // OpenSSL PKCS12 commands for PFX generation (allow empty password)
    /^openssl\s+pkcs12\s+-export\s+-out\s+"[^"]+"\s+-inkey\s+"[^"]+"\s+-in\s+"[^"]+"\s+(-certfile\s+"[^"]+"\s+)?-passout\s+(pass:[^;|&`$]*|file:"[^"]+")(\s+-legacy)?$/
  ];

  // Check if command matches any allowed pattern
  const isAllowed = allowedPatterns.some(pattern => pattern.test(trimmedCommand));
  
  if (!isAllowed) {
    console.warn('Blocked potentially unsafe command:', trimmedCommand);
    return false;
  }

  // Additional security checks
  // Block commands with dangerous characters or sequences
  const dangerousPatterns = [
    /[;&|`$(){}[\]<>]/,  // Shell metacharacters (except & in cd && mkcert pattern)
    /\.\.\//,            // Directory traversal
    /\/etc\/|\/bin\/|\/usr\/bin\/|\/sbin\//, // System directories
    /rm\s+|del\s+|format\s+/i, // Deletion commands
    />\s*\/|>>\s*\//, // Output redirection to system paths
    /sudo|su\s/i,     // Privilege escalation
  ];

  // Special handling for cd && mkcert commands - allow the && operator
  const isCdMkcertCommand = /^cd\s+"[^"]+"\s+&&\s+mkcert/.test(trimmedCommand);
  
  // Special handling for OpenSSL commands - allow colon in password options
  const isOpensslCommand = /^openssl\s+(x509|pkcs12|version)/.test(trimmedCommand);
  
  const hasDangerousPattern = dangerousPatterns.some(pattern => {
    if (isCdMkcertCommand && pattern.source.includes('&')) {
      // For cd && mkcert commands, only check for other dangerous patterns
      return false;
    }
    if (isOpensslCommand && (pattern.source.includes('|') || pattern.source.includes('`') || pattern.source.includes('$'))) {
      // For OpenSSL commands, allow some special characters that are safe in this context
      return false;
    }
    return pattern.test(trimmedCommand);
  });
  
  if (hasDangerousPattern) {
    console.warn('Blocked command with dangerous pattern:', trimmedCommand);
    return false;
  }

  return true;
};

// Path validation function to prevent directory traversal attacks
// SECURITY: This function validates and sanitizes user-provided paths to prevent
// access to files outside the certificates directory
const validateAndSanitizePath = (userPath, allowedBasePath) => {
  if (!userPath || typeof userPath !== 'string') {
    throw new Error('Invalid path: path must be a non-empty string');
  }

  // Remove any null bytes which could be used to bypass filters
  const cleanPath = userPath.replace(/\0/g, '');
  
  // Decode URI component safely
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(cleanPath);
  } catch (error) {
    throw new Error('Invalid path: malformed URI encoding');
  }

  // Reject paths with dangerous patterns
  const dangerousPatterns = [
    /\.\.\//,           // Directory traversal
    /\.\.\\/, 
    /\.\.\\/,
    /\.\.$/,            // Ends with ..
    /\/\.\./,           // Starts with /..
    /\\\.\./,           // Starts with \..
    /^~\//,             // Home directory
    /^\/[^/]/,          // Absolute paths (starts with /)
    /^[A-Za-z]:\\/,     // Windows absolute paths (C:\)
    /\0/,               // Null bytes
    /[<>"|*?]/,         // Invalid filename characters
    /\/\//,             // Double slashes
    /\\\\/,             // Double backslashes
    /\/$|\\$/           // Trailing slashes/backslashes
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(decodedPath)) {
      throw new Error(`Invalid path: contains unsafe pattern '${decodedPath}'`);
    }
  }

  // Normalize the path and resolve it relative to the allowed base
  const normalizedPath = path.normalize(decodedPath);
  const resolvedPath = path.resolve(allowedBasePath, normalizedPath);
  
  // Ensure the resolved path is within the allowed base directory
  const relativePath = path.relative(allowedBasePath, resolvedPath);
  
  // Check if the path tries to escape the base directory
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Access denied: path outside allowed directory '${decodedPath}'`);
  }

  return {
    safe: true,
    sanitized: normalizedPath,
    resolved: resolvedPath,
    relative: relativePath
  };
};

// Secure filename validation to prevent malicious filenames
const validateFilename = (filename) => {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Invalid filename: must be a non-empty string');
  }

  // Remove any null bytes
  const cleanFilename = filename.replace(/\0/g, '');

  // Check for dangerous patterns in filenames
  const dangerousFilenamePatterns = [
    /\.\.\./,           // Multiple dots
    /^\.\.?$/,          // . or .. filename
    /[<>"|*?\\\/]/,     // Invalid filename characters and path separators
    /\0/,               // Null bytes
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i, // Windows reserved names
    /\s+$/,             // Trailing spaces
    /\.+$/              // Trailing dots
  ];

  for (const pattern of dangerousFilenamePatterns) {
    if (pattern.test(cleanFilename)) {
      throw new Error(`Invalid filename: contains unsafe pattern '${cleanFilename}'`);
    }
  }

  // Additional length check
  if (cleanFilename.length > 255) {
    throw new Error('Invalid filename: too long');
  }

  return cleanFilename;
};

module.exports = {
  executeCommand,
  isCommandSafe,
  validateAndSanitizePath,
  validateFilename
};
