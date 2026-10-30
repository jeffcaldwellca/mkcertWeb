// HTTP response utilities to eliminate code duplication
const crypto = require('crypto');
const http = require('http');
const os = require('os');
const path = require('path');
const util = require('util');

const isDevelopment = process.env.NODE_ENV === 'development';

const REASON_MAX = 120;

// Directories to hide in a public reason, longest first: CAROOT (set, and
// mkcert's defaults), the working directory and the home directory.
function privateDirs() {
  const home = os.homedir();
  const dataHome = process.env.XDG_DATA_HOME || (home && path.join(home, '.local', 'share'));
  const dirs = [
    process.env.CAROOT,
    home && path.join(home, 'Library', 'Application Support', 'mkcert'),
    dataHome && path.join(dataHome, 'mkcert'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'mkcert'),
    process.cwd(),
    home
  ];
  return [...new Set(dirs.filter((d) => typeof d === 'string' && d.length > 1))]
    .sort((a, b) => b.length - a.length);
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The rest of a path after a known directory: up to whitespace, a quote or
// punctuation that ends a path in an error message.
const PATH_TAIL = `[^\\s'"\`),;:]*`;
const UNIX_PATH = /(^|[\s'"`(=\[])\/[^\s'"`),;:\]]+/g;
const WINDOWS_PATH = /\b[A-Za-z]:\\[^\s'"`),;:]*/g;

function stripPaths(text) {
  let out = text;
  for (const dir of privateDirs()) {
    out = out.replace(new RegExp(escapeRegExp(dir) + PATH_TAIL, 'g'), '<path>');
  }
  return out.replace(UNIX_PATH, '$1<path>').replace(WINDOWS_PATH, '<path>');
}

const lines = (v) => (typeof v === 'string' ? v.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []);

function errorCode(err) {
  for (let e = err, depth = 0; e && typeof e === 'object' && depth < 5; e = e.cause, depth++) {
    // A system errno names the failure precisely (nodemailer reports a
    // refused connection as code ESOCKET with errno ECONNREFUSED).
    if (Number.isInteger(e.errno) && e.errno < 0) {
      try { return util.getSystemErrorName(e.errno); } catch (_) { /* unknown errno */ }
    }
    if (typeof e.originalCode === 'string' && /^E[A-Z0-9_]+$/.test(e.originalCode)) return e.originalCode;
    if (typeof e.code === 'string' && /^E[A-Z0-9_]+$/.test(e.code)) return e.code;
  }
  return null;
}

/**
 * A short, safe reason for an admin-actionable failure (notification tests,
 * CA install/uninstall/generate): the error code (ECONNREFUSED, EAUTH,
 * ENOENT, ...) when there is one; otherwise the last line of a child
 * process's stderr (its fatal error) or the first line of the message, with
 * absolute paths, the working/home directories and CAROOT replaced by
 * <path>, at most 120 characters. Returns undefined when there is nothing.
 * Not for generate, file or download errors: those get the fixed message.
 */
function publicReason(err) {
  if (err === null || err === undefined) return undefined;
  const code = errorCode(err);
  if (code) return code;
  let line;
  if (typeof err === 'string') line = lines(err)[0];
  else {
    const stderr = lines(err.stderr);
    line = stderr.length ? stderr[stderr.length - 1] : lines(typeof err.message === 'string' ? err.message : err.error)[0];
  }
  if (!line) return undefined;
  const safe = stripPaths(line);
  return safe.length > REASON_MAX ? safe.slice(0, REASON_MAX - 1) + '…' : safe;
}

/**
 * Standard API response helpers
 */
const apiResponse = {
  /**
   * Send a successful JSON response
   */
  success: (res, data = {}, message = null) => {
    const response = { success: true };
    if (message) response.message = message;
    if (Object.keys(data).length > 0) Object.assign(response, data);
    return res.json(response);
  },

  /**
   * Send a bad request error (400)
   */
  badRequest: (res, error, details = null) => {
    const response = { success: false, error };
    if (details && isDevelopment) response.details = details;
    return res.status(400).json(response);
  },

  /**
   * Send a forbidden error (403)
   */
  forbidden: (res, error = 'Forbidden') => {
    return res.status(403).json({ success: false, error });
  },

  /**
   * Send a not found error (404)
   */
  notFound: (res, error = 'Resource not found') => {
    return res.status(404).json({ success: false, error });
  },

  /**
   * Send a conflict error (409). `extra` carries machine-readable fields
   * such as { code: 'TWIN_EXISTS' }.
   */
  conflict: (res, error = 'Conflict', extra = {}) => {
    return res.status(409).json({ ...extra, success: false, error });
  },

  /**
   * Send an internal server error (500). The body is the caller's fixed
   * message plus a short reference ID; the full `originalError` goes to the
   * server log under that ID, never into the response. `extra.reason` (from
   * publicReason) is the only detail that may reach the client.
   */
  serverError: (res, error = 'Internal server error', originalError = null, extra = {}) => {
    const ref = crypto.randomBytes(4).toString('hex');
    const req = res.req;
    const where = req && req.method ? `${req.method} ${String(req.originalUrl || req.url || '').split('?')[0]} ` : '';
    console.error(`[ref ${ref}] ${where}500 ${error}`, ...(originalError != null ? [originalError] : []));
    const response = { success: false, error, ref };
    if (extra && typeof extra.reason === 'string' && extra.reason) response.reason = extra.reason;
    return res.status(500).json(response);
  }
};

// A fixed message for a client error raised by middleware (body-parser,
// send). Never the error's own message: body-parser's can quote the body.
function clientErrorMessage(err, status) {
  if (typeof err.type === 'string' && /^(entity|charset|encoding|request|stream)\./.test(err.type)) {
    return status === 413 ? 'Request body too large' : 'Invalid request body';
  }
  return http.STATUS_CODES[status] || 'Bad request';
}

/**
 * Central error-handling middleware (server.js mounts it last).
 * - An exposed 4xx (http-errors convention: body-parser's bad JSON or
 *   oversized body, a missing file in res.download) keeps its status with a
 *   fixed message; the log gets one line without the body.
 * - Anything else is serverError: fixed message + ref, full error logged.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    console.error(err && err.stack ? err.stack : err);
    return next(err);
  }
  const status = err && (err.status || err.statusCode);
  if (err && err.expose === true && Number.isInteger(status) && status >= 400 && status < 500) {
    const where = `${req.method} ${String(req.originalUrl || req.url || '').split('?')[0]}`;
    console.warn(`[${status}] ${where}: ${err.type || err.code || 'client error'}`);
    return res.status(status).json({ success: false, error: clientErrorMessage(err, status) });
  }
  return apiResponse.serverError(res, 'Internal server error', err);
}

/**
 * Async route wrapper that catches errors automatically
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    // Forward to the centralized error-handling middleware instead of
    // formatting the response here, so all routes share one error path.
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Validation middleware creator
 */
const validateRequest = (validators) => {
  return (req, res, next) => {
    const errors = [];
    
    for (const [field, validator] of Object.entries(validators)) {
      const value = req.body[field] || req.params[field] || req.query[field];

      // A non-string (or empty/whitespace string) fails a required check —
      // never call .trim() on a value that might not be a string.
      const isBlank = value == null ||
        (typeof value === 'string' ? value.trim() === '' : false);

      if (validator.required && (typeof value !== 'string' || isBlank)) {
        errors.push(`${field} is required`);
        continue;
      }

      if (value && validator.validate && !validator.validate(value)) {
        errors.push(validator.message || `${field} is invalid`);
      }
    }
    
    if (errors.length > 0) {
      return apiResponse.badRequest(res, 'Validation failed', errors);
    }
    
    next();
  };
};

module.exports = {
  apiResponse,
  publicReason,
  errorHandler,
  asyncHandler,
  validateRequest
};
