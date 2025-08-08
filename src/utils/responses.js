// HTTP response utilities to eliminate code duplication
const isDevelopment = process.env.NODE_ENV === 'development';

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
   * Send an unauthorized error (401)
   */
  unauthorized: (res, error = 'Unauthorized') => {
    return res.status(401).json({ success: false, error });
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
   * Send an internal server error (500)
   */
  serverError: (res, error = 'Internal server error', originalError = null) => {
    const response = { 
      success: false, 
      error: isDevelopment && originalError ? originalError.message : error 
    };
    if (isDevelopment && originalError?.stack) {
      response.stack = originalError.stack;
    }
    return res.status(500).json(response);
  },

  /**
   * Send a rate limit error (429)
   */
  rateLimited: (res, error = 'Too many requests') => {
    return res.status(429).json({ success: false, error });
  }
};

/**
 * Enhanced error handler that logs and responds
 */
const handleError = (res, error, context = '', statusCode = 500) => {
  // Log the error
  console.error(`Error ${context}:`, error);
  
  // Respond based on status code
  switch (statusCode) {
    case 400:
      return apiResponse.badRequest(res, error.message || error, error);
    case 401:
      return apiResponse.unauthorized(res, error.message || error);
    case 403:
      return apiResponse.forbidden(res, error.message || error);
    case 404:
      return apiResponse.notFound(res, error.message || error);
    case 429:
      return apiResponse.rateLimited(res, error.message || error);
    default:
      return apiResponse.serverError(res, 'Internal server error', error);
  }
};

/**
 * Async route wrapper that catches errors automatically
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      console.error('Async route error:', error);
      apiResponse.serverError(res, 'Internal server error', error);
    });
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
      
      if (validator.required && (!value || value.trim() === '')) {
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
  handleError,
  asyncHandler,
  validateRequest
};
