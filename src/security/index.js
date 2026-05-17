// Security utilities module
//
// All process execution goes through runTool, which uses execFile (no shell).
// Arguments are passed as an argv array and are never parsed by a shell, so
// metacharacters in user-supplied values (domain names, paths, passwords)
// cannot inject additional commands.
const { execFile } = require('child_process');
const path = require('path');

// Binaries this app is permitted to invoke. The PATH-resolved binary must
// match one of these names.
const ALLOWED_TOOLS = new Set(['mkcert', 'openssl']);

// Per-tool argument allowlist. Each entry is a function that takes the args
// array and returns true if it's a permitted invocation. Keeping this in
// addition to execFile gives defense in depth: even if a caller forgets to
// validate user input, only argument shapes we've explicitly approved run.
const TOOL_ARG_VALIDATORS = {
  mkcert: (args) => {
    if (args.length === 0) return false;
    // mkcert subcommands and recognized flags
    // -CAROOT, -install, -uninstall, -help (no other args)
    const adminFlags = new Set(['-CAROOT', '--help', '-help', '-install', '-uninstall']);
    if (args.length === 1 && adminFlags.has(args[0])) return true;
    // Otherwise, args must be a mix of flag/value pairs and domain names.
    // Permitted flags: -cert-file <p>, -key-file <p>, -pkcs12, -client, -p12-file <p>
    const FLAG_WITH_VALUE = new Set(['-cert-file', '-key-file', '-p12-file']);
    const FLAG_BARE       = new Set(['-pkcs12', '-client']);
    let i = 0;
    while (i < args.length) {
      const a = args[i];
      if (FLAG_WITH_VALUE.has(a)) {
        if (i + 1 >= args.length) return false;
        // Value can be any string — execFile makes injection impossible — but
        // we still reject obviously malicious paths.
        if (/[\0\n\r]/.test(args[i + 1])) return false;
        i += 2;
        continue;
      }
      if (FLAG_BARE.has(a)) { i += 1; continue; }
      // Anything else must look like a valid domain / IP / SAN entry.
      if (!isValidDomainArg(a)) return false;
      i += 1;
    }
    return true;
  },
  openssl: (args) => {
    if (args.length === 0) return false;
    // We only need a small set of openssl subcommands.
    const sub = args[0];
    const allowedSubs = new Set(['version', 'x509', 'pkcs12', 'req', 'pkcs7', 'smime', 'rand', 'genrsa', 'rsa']);
    if (!allowedSubs.has(sub)) return false;
    // Reject NUL/newline in any arg (execFile would accept them but they're
    // never legitimate for these subcommands and may indicate tampering).
    return args.every(a => !/[\0\n\r]/.test(a));
  }
};

// A liberal validator for mkcert domain arguments: hostnames, wildcards,
// IP addresses (v4/v6), and email-like SANs (for S/MIME).
function isValidDomainArg(s) {
  if (!s || s.length > 253) return false;
  // wildcard
  if (s.startsWith('*.')) s = s.slice(2);
  // email-style (S/MIME) — name@domain
  if (s.includes('@')) {
    const [local, domain] = s.split('@');
    return /^[\w.\-+]+$/.test(local) && /^[a-zA-Z0-9.\-]+$/.test(domain);
  }
  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return true;
  // IPv6 (loose)
  if (/^[0-9a-fA-F:]+$/.test(s) && s.includes(':')) return true;
  // Hostname
  return /^[a-zA-Z0-9.\-]+$/.test(s);
}

/**
 * runTool — preferred API. Invokes a tool with array arguments via execFile,
 * which never spawns a shell, eliminating command-injection entirely for any
 * argument that flows from user input.
 *
 * @param {string} tool  Tool name (must be in ALLOWED_TOOLS)
 * @param {string[]} args  Argument vector
 * @param {object} options  { cwd, timeout, maxBuffer, env, input }
 * @returns {Promise<{stdout, stderr}>}
 */
function runTool(tool, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    if (!ALLOWED_TOOLS.has(tool)) {
      return reject({ error: `Tool not allowed: ${tool}` });
    }
    if (!Array.isArray(args) || !args.every(a => typeof a === 'string')) {
      return reject({ error: 'args must be an array of strings' });
    }
    const validator = TOOL_ARG_VALIDATORS[tool];
    if (validator && !validator(args)) {
      console.error(`Security: blocked invocation: ${tool} ${JSON.stringify(args)}`);
      return reject({ error: 'Invocation rejected by argument allowlist' });
    }
    const execOptions = {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      shell: false,
      ...options
    };
    const child = execFile(tool, args, execOptions, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 'ETIMEDOUT') {
          return reject({ error: 'Command timed out after 30 seconds', stderr });
        }
        return reject({ error: error.message, stderr });
      }
      resolve({ stdout, stderr });
    });
    if (options.input != null) {
      child.stdin.end(options.input);
    }
  });
}

/**
 * executeCommand — legacy adapter. Older callers build a full shell command
 * string. Rather than spawning a shell, we parse a small, fixed set of
 * recognized command shapes back into (tool, args) and delegate to runTool.
 * Any string that doesn't match a known shape is rejected.
 */
function executeCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = parseLegacyCommand(command);
    if (!parsed) {
      console.error('Security: Blocked unsafe command execution attempt:', command);
      return reject({
        error: 'Command not allowed for security reasons',
        stderr: 'Invalid or potentially dangerous command detected'
      });
    }
    const { tool, args, cwd } = parsed;
    const opts = cwd ? { ...options, cwd } : options;
    runTool(tool, args, opts).then(resolve, reject);
  });
}

// Parse a small known set of command strings into structured argv.
// Returns null if the command doesn't match any recognized shape.
function parseLegacyCommand(command) {
  if (!command || typeof command !== 'string') return null;
  let cmd = command.trim();

  // Optional `cd "<dir>" && <rest>` prefix (used by the old PFX/cert generators).
  let cwd = null;
  const cdMatch = cmd.match(/^cd\s+"([^"]+)"\s+&&\s+(.+)$/);
  if (cdMatch) { cwd = cdMatch[1]; cmd = cdMatch[2]; }

  // Tokenize: respect "double-quoted" segments as a single argument.
  const tokens = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(cmd)) !== null) {
    tokens.push(m[1] !== undefined ? m[1] : m[2]);
  }
  if (tokens.length === 0) return null;

  const tool = tokens.shift();
  if (!ALLOWED_TOOLS.has(tool)) return null;

  // Strip trailing `2>/dev/null || echo "..."` shell appendage from the
  // legacy `ls *.pem` style command — we don't support that shape via runTool.
  // (It was an `ls` command anyway, which we don't allow.)

  return { tool, args: tokens, cwd };
}

// Command validation function — retained for back-compat in case any caller
// imports it directly. Returns true iff parseLegacyCommand can structure it
// AND the resulting argv passes the runTool allowlist.
const isCommandSafe = (command) => {
  const parsed = parseLegacyCommand(command);
  if (!parsed) return false;
  const validator = TOOL_ARG_VALIDATORS[parsed.tool];
  return !validator || validator(parsed.args);
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
  runTool,
  executeCommand,
  isCommandSafe,
  validateAndSanitizePath,
  validateFilename,
  // expose for tests / advanced callers
  isValidDomainArg
};
