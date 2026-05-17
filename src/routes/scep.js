// SCEP (Simple Certificate Enrollment Protocol) routes module
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const scepUtils = require('../utils/scep');
const pkcs7Utils = require('../utils/pkcs7');
const enterpriseCA = require('../utils/enterpriseCA');
const security = require('../security');
const { apiResponse, handleError, asyncHandler } = require('../utils/responses');

// Load CA key + cert lazily so we don't fail boot if mkcert isn't installed.
async function loadCAMaterial() {
  const result = await security.runTool('mkcert', ['-CAROOT']);
  const caRoot = result.stdout.trim();
  const caCertPem = await fs.readFile(path.join(caRoot, 'rootCA.pem'),     'utf8');
  const caKeyPem  = await fs.readFile(path.join(caRoot, 'rootCA-key.pem'), 'utf8');
  return { caCertPem, caKeyPem, caRoot };
}

// Sign a CSR with the mkcert CA, returning the issued cert PEM.
// Uses openssl x509 -req — the same approach as enterpriseCA.js but minimal.
async function signCSRWithCA(csrPem, caCertPath, caKeyPath, days = 825) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mkcertweb-scep-'));
  try {
    const csrPath  = path.join(tmpDir, 'req.csr');
    const certPath = path.join(tmpDir, 'cert.pem');
    await fs.writeFile(csrPath, csrPem, 'utf8');
    await security.runTool('openssl', [
      'x509', '-req', '-in', csrPath,
      '-CA', caCertPath, '-CAkey', caKeyPath, '-CAcreateserial',
      '-out', certPath, '-days', String(days), '-sha256'
    ]);
    return await fs.readFile(certPath, 'utf8');
  } finally {
    // Best-effort cleanup
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

// Configure multer for handling SCEP binary requests
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit for certificate requests
  }
});

// Raw body parser for SCEP — clients send the binary PKCS#7 directly with
// Content-Type: application/x-pki-message, not multipart form data.
const bodyParser = require('body-parser');
const rawSCEPBody = bodyParser.raw({
  type: ['application/x-pki-message', 'application/octet-stream'],
  limit: '10mb'
});

const createSCEPRoutes = (config, rateLimiters, requireAuth) => {
  const router = express.Router();
  const { cliRateLimiter, apiRateLimiter } = rateLimiters;

  // Store for challenge passwords (in production, use Redis or database)
  const challengeStore = new Map();

  // SCEP CA Certificate endpoint
  // This is the standard SCEP endpoint for getting CA certificates
  router.get('/scep', apiRateLimiter, asyncHandler(async (req, res) => {
    const { operation, message } = req.query;

    if (operation === 'GetCACert') {
      try {
        const caCert = await scepUtils.getSCEPCACertificate();
        
        res.setHeader('Content-Type', 'application/x-x509-ca-cert');
        res.setHeader('Content-Disposition', 'attachment; filename="ca-cert.der"');
        res.send(caCert);
      } catch (error) {
        console.error('SCEP GetCACert error:', error);
        return apiResponse.serverError(res, 'Failed to retrieve CA certificate');
      }
    } else if (operation === 'GetCACaps') {
      // Return SCEP capabilities
      const capabilities = [
        'Renewal',
        'SHA-1',
        'SHA-256',
        'DES3',
        'AES'
      ].join('\n');
      
      res.setHeader('Content-Type', 'text/plain');
      res.send(capabilities);
    } else {
      return apiResponse.badRequest(res, 'Unsupported SCEP operation');
    }
  }));

  // SCEP Certificate Request endpoint
  // RFC 8894 §3.2: PKCS#7 SignedData over PKCS#7 EnvelopedData over PKCS#10.
  router.post('/scep', rawSCEPBody, upload.single('message'), cliRateLimiter, asyncHandler(async (req, res) => {
    const { operation } = req.query;
    if (operation !== 'PKIOperation') {
      return apiResponse.badRequest(res, 'Unsupported SCEP operation');
    }

    // The request body may arrive as multipart (multer "message" field) or
    // as the raw application/x-pki-message body. Accept both.
    const body = req.file
      ? req.file.buffer
      : (Buffer.isBuffer(req.body) ? req.body : null);
    if (!body || body.length === 0) {
      return apiResponse.badRequest(res, 'No PKCS#7 message provided');
    }

    res.setHeader('Content-Type', 'application/x-pki-message');

    // Load CA material; if mkcert isn't installed, we can't sign at all.
    let caMaterial;
    try {
      caMaterial = await loadCAMaterial();
    } catch (err) {
      console.error('SCEP: failed to load CA material:', err.message);
      return res.status(500).end();
    }

    const sendFailure = (transactionId, recipientNonce, failInfo) => {
      try {
        const buf = pkcs7Utils.buildSCEPFailureResponse({
          transactionId,
          recipientNonce,
          failInfo,
          caKeyPem:  caMaterial.caKeyPem,
          caCertPem: caMaterial.caCertPem
        });
        return res.send(buf);
      } catch (err) {
        console.error('SCEP: failed to build failure response:', err.message);
        return res.status(500).end();
      }
    };

    // Parse + decrypt
    let scepRequest;
    try {
      scepRequest = pkcs7Utils.parseSCEPRequest(body, {
        caKeyPem:  caMaterial.caKeyPem,
        caCertPem: caMaterial.caCertPem
      });
    } catch (err) {
      console.error('SCEP: parse failed:', err.message);
      return sendFailure(null, null, pkcs7Utils.FAIL_INFO.badRequest);
    }

    console.log('SCEP request parsed:', {
      messageType: scepRequest.messageType,
      transactionId: scepRequest.transactionId,
      hasCSR: !!scepRequest.csrPem,
      hasChallenge: !!scepRequest.challengePassword
    });

    if (!scepRequest.csrPem) {
      return sendFailure(
        scepRequest.transactionId,
        scepRequest.senderNonce,
        pkcs7Utils.FAIL_INFO.badRequest
      );
    }

    // Challenge password is *required* when the operator has issued any.
    // (Pure no-challenge enrollment is allowed when challengeStore is empty.)
    if (challengeStore.size > 0) {
      const ok = pkcs7Utils.validateChallenge(scepRequest.challengePassword, challengeStore);
      if (!ok) {
        console.warn('SCEP: invalid or missing challenge password');
        return sendFailure(
          scepRequest.transactionId,
          scepRequest.senderNonce,
          pkcs7Utils.FAIL_INFO.badRequest
        );
      }
    }

    // Sign the CSR with the mkcert CA → real X.509 certificate.
    let issuedCertPem;
    try {
      const caRoot = caMaterial.caRoot;
      issuedCertPem = await signCSRWithCA(
        scepRequest.csrPem,
        path.join(caRoot, 'rootCA.pem'),
        path.join(caRoot, 'rootCA-key.pem')
      );
    } catch (err) {
      console.error('SCEP: CSR signing failed:', err.error || err.message);
      return sendFailure(
        scepRequest.transactionId,
        scepRequest.senderNonce,
        pkcs7Utils.FAIL_INFO.badRequest
      );
    }

    // Wrap in signed/enveloped response targeted at the requester.
    try {
      const responseBuf = pkcs7Utils.buildSCEPSuccessResponse({
        issuedCertPem,
        transactionId: scepRequest.transactionId,
        recipientNonce: scepRequest.senderNonce,
        signerCert: scepRequest.signerCert,
        caKeyPem:  caMaterial.caKeyPem,
        caCertPem: caMaterial.caCertPem
      });
      return res.send(responseBuf);
    } catch (err) {
      console.error('SCEP: response build failed:', err.message);
      return sendFailure(
        scepRequest.transactionId,
        scepRequest.senderNonce,
        pkcs7Utils.FAIL_INFO.badRequest
      );
    }
  }));

  // SCEP Management API endpoints (protected by auth)
  
  // Generate a new challenge password
  router.post('/api/scep/challenge', requireAuth, apiRateLimiter, asyncHandler(async (req, res) => {
    const { identifier, expiresIn = 3600 } = req.body; // Default 1 hour expiration

    if (!identifier) {
      return apiResponse.badRequest(res, 'Identifier is required');
    }

    const challengePassword = scepUtils.generateChallengePassword();
    const expiresAt = new Date(Date.now() + (expiresIn * 1000));

    // Store challenge (in production, use proper storage)
    challengeStore.set(identifier, {
      password: challengePassword,
      expiresAt,
      used: false
    });

    // Clean up expired challenges
    setTimeout(() => {
      challengeStore.delete(identifier);
    }, expiresIn * 1000);

    return apiResponse.success(res, {
      identifier,
      challengePassword,
      expiresAt
    }, 'Challenge password generated');
  }));

  // List challenge passwords
  router.get('/api/scep/challenges', requireAuth, apiRateLimiter, asyncHandler(async (req, res) => {
    const challenges = Array.from(challengeStore.entries()).map(([id, data]) => ({
      identifier: id,
      expiresAt: data.expiresAt,
      used: data.used,
      expired: new Date() > data.expiresAt
    }));

    return apiResponse.success(res, { challenges }, 'Challenge passwords retrieved');
  }));

  // Manual certificate generation via SCEP workflow with enterprise CA support
  router.post('/api/scep/certificate', requireAuth, cliRateLimiter, asyncHandler(async (req, res) => {
    const { 
      commonName, 
      challengePassword, 
      subjectAltNames = [], 
      template = 'User',
      upn
    } = req.body;

    if (!commonName) {
      return apiResponse.badRequest(res, 'Common name is required');
    }

    if (!scepUtils.isValidDomainName(commonName)) {
      return apiResponse.badRequest(res, 'Invalid common name format');
    }

    // Validate UPN if provided
    if (upn && !enterpriseCA.validateUPN(upn)) {
      return apiResponse.badRequest(res, 'Invalid UPN format');
    }

    try {
      console.log('🔄 Manual SCEP certificate generation requested');
      console.log(`📋 Template: ${template}, UPN: ${upn || 'none'}`);

      // Generate certificate using enhanced SCEP processing
      const result = await scepUtils.processSCEPCertificateRequest({
        commonName,
        challengePassword: challengePassword || 'manual-generation',
        template,
        upn,
        subjectAltNames
      });

      return apiResponse.success(res, {
        commonName: result.commonName,
        template: result.template,
        upn: result.upn,
        certificatePath: result.certificatePath,
        method: result.method,
        enterpriseMode: result.enterpriseMode,
        message: `Certificate generated successfully using ${result.method}`
      }, 'SCEP certificate generated');

    } catch (error) {
      console.error('SCEP certificate generation error:', error);
      return apiResponse.serverError(res, error.message);
    }
  }));

  // List SCEP certificates
  router.get('/api/scep/certificates', requireAuth, apiRateLimiter, asyncHandler(async (req, res) => {
    try {
      const certificates = await scepUtils.listSCEPCertificates();
      return apiResponse.success(res, { certificates }, 'SCEP certificates retrieved');
    } catch (error) {
      console.error('Error listing SCEP certificates:', error);
      return apiResponse.serverError(res, error.message);
    }
  }));

  // Get SCEP certificate details
  router.get('/api/scep/certificates/:commonName', requireAuth, apiRateLimiter, asyncHandler(async (req, res) => {
    const { commonName } = req.params;

    try {
      const details = await scepUtils.getSCEPCertificateDetails(commonName);
      return apiResponse.success(res, details, 'SCEP certificate details retrieved');
    } catch (error) {
      console.error('Error getting SCEP certificate details:', error);
      return apiResponse.notFound(res, 'SCEP certificate not found');
    }
  }));

  // SCEP configuration endpoint
  router.get('/api/scep/config', requireAuth, apiRateLimiter, asyncHandler(async (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    
    const scepConfig = {
      scepUrl: `${baseUrl}/scep`,
      getCACertUrl: `${baseUrl}/scep?operation=GetCACert`,
      getCACapsUrl: `${baseUrl}/scep?operation=GetCACaps`,
      pkiOperationUrl: `${baseUrl}/scep?operation=PKIOperation`,
      managementApi: {
        challenges: `${baseUrl}/api/scep/challenges`,
        certificates: `${baseUrl}/api/scep/certificates`,
        generateCertificate: `${baseUrl}/api/scep/certificate`
      },
      supportedOperations: [
        'GetCACert',
        'GetCACaps',
        'PKIOperation'
      ],
      capabilities: [
        'Renewal',
        'SHA-1',
        'SHA-256',
        'DES3',
        'AES'
      ],
      notes: {
        implementation: 'SCEP implementation with PKCS#7 parsing using mkcert',
        fullPKIOperation: 'Implemented with PKCS#7 message parsing and certificate generation',
        limitations: 'CSR extraction from enveloped data requires manual processing',
        manualGeneration: 'Available via management API for testing'
      }
    };

    return apiResponse.success(res, scepConfig, 'SCEP configuration retrieved');
  }));

  // Enterprise CA status and configuration
  router.get('/api/scep/enterprise-ca/status', requireAuth, apiRateLimiter, asyncHandler(async (req, res) => {
    try {
      const status = await enterpriseCA.getEnterpriseCAStatus();
      return apiResponse.success(res, status, 'Enterprise CA status retrieved');
    } catch (error) {
      console.error('Enterprise CA status error:', error);
      return apiResponse.serverError(res, error.message);
    }
  }));

  // Certificate template management
  router.get('/api/scep/templates', requireAuth, apiRateLimiter, asyncHandler(async (req, res) => {
    try {
      const templates = enterpriseCA.getCertificateTemplates();
      return apiResponse.success(res, templates, 'Certificate templates retrieved');
    } catch (error) {
      console.error('Certificate templates error:', error);
      return apiResponse.serverError(res, error.message);
    }
  }));

  // UPN validation endpoint
  router.post('/api/scep/validate-upn', requireAuth, apiRateLimiter, asyncHandler(async (req, res) => {
    const { upn } = req.body;
    
    if (!upn) {
      return apiResponse.badRequest(res, 'UPN is required');
    }

    try {
      const isValid = enterpriseCA.validateUPN(upn);
      return apiResponse.success(res, { 
        upn, 
        valid: isValid,
        message: isValid ? 'Valid UPN format' : 'Invalid UPN format'
      }, 'UPN validation completed');
    } catch (error) {
      console.error('UPN validation error:', error);
      return apiResponse.serverError(res, error.message);
    }
  }));

  return router;
};

module.exports = { createSCEPRoutes };
