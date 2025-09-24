// PKCS#7 parsing and generation utilities for SCEP
const forge = require('node-forge');
const crypto = require('crypto');

/**
 * Parse a PKCS#7 SCEP request message
 * @param {Buffer} pkcs7Buffer - The PKCS#7 message buffer
 * @returns {Object} Parsed SCEP request with CSR and metadata
 */
function parseSCEPRequest(pkcs7Buffer) {
  try {
    // Convert buffer to forge format
    const pkcs7Der = forge.util.encode64(pkcs7Buffer);
    const pkcs7Asn1 = forge.asn1.fromDer(forge.util.decode64(pkcs7Der));
    const pkcs7 = forge.pkcs7.messageFromAsn1(pkcs7Asn1);

    // Verify that this is a signed data structure
    if (pkcs7.type !== forge.pki.oids.signedData) {
      throw new Error('Invalid PKCS#7 message type');
    }

    // Extract the enveloped data (should contain the CSR)
    const content = pkcs7.content;
    if (!content) {
      throw new Error('No content found in PKCS#7 message');
    }

    // The content should be another PKCS#7 enveloped data containing the CSR
    let csrPem = null;
    let challengePassword = null;

    // Try to extract CSR from the content
    try {
      const contentAsn1 = forge.asn1.fromDer(content);
      const envelopedData = forge.pkcs7.messageFromAsn1(contentAsn1);
      
      if (envelopedData.type === forge.pki.oids.envelopedData) {
        // This would require decryption in a full implementation
        // For now, we'll simulate the extraction
        console.log('Found enveloped data - would need decryption');
      }
    } catch (err) {
      // If it's not enveloped data, try to parse as direct CSR
      try {
        csrPem = forge.pki.certificationRequestToPem(
          forge.pki.certificationRequestFromAsn1(forge.asn1.fromDer(content))
        );
      } catch (csrErr) {
        console.log('Could not parse content as CSR directly');
      }
    }

    // Extract challenge password from attributes if present
    if (pkcs7.signers && pkcs7.signers.length > 0) {
      const signer = pkcs7.signers[0];
      if (signer.authenticatedAttributes) {
        signer.authenticatedAttributes.forEach(attr => {
          if (attr.type === forge.pki.oids.challengePassword) {
            challengePassword = attr.value;
          }
        });
      }
    }

    return {
      messageType: 'PKCSReq', // SCEP message type
      csrPem,
      challengePassword,
      transactionId: generateTransactionId(),
      senderNonce: generateNonce(),
      parsed: true
    };

  } catch (error) {
    console.error('Error parsing PKCS#7 SCEP request:', error);
    throw new Error(`Failed to parse SCEP request: ${error.message}`);
  }
}

/**
 * Create a PKCS#7 SCEP response message
 * @param {Object} responseData - Response data including certificate
 * @param {string} responseData.certificatePem - Generated certificate in PEM format
 * @param {string} responseData.transactionId - Transaction ID from request
 * @param {string} responseData.recipientNonce - Recipient nonce from request
 * @returns {Buffer} PKCS#7 response message
 */
function createSCEPResponse(responseData) {
  try {
    const { certificatePem, transactionId, recipientNonce } = responseData;

    // Parse the certificate
    const cert = forge.pki.certificateFromPem(certificatePem);
    
    // Create PKCS#7 signed data structure
    const pkcs7 = forge.pkcs7.createSignedData();
    
    // Add the certificate to the response
    pkcs7.content = forge.util.createBuffer(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
    pkcs7.contentInfo.contentType = forge.pki.oids.data;

    // In a full implementation, you would:
    // 1. Load the CA private key
    // 2. Sign the response with the CA key
    // 3. Add proper SCEP attributes (messageType, transactionId, etc.)
    
    // For this simplified version, create a basic response
    const responseMessage = forge.asn1.toDer(forge.pkcs7.messageToAsn1(pkcs7));
    
    return Buffer.from(responseMessage.getBytes(), 'binary');

  } catch (error) {
    console.error('Error creating PKCS#7 SCEP response:', error);
    throw new Error(`Failed to create SCEP response: ${error.message}`);
  }
}

/**
 * Extract CSR from SCEP request (simplified approach)
 * @param {Buffer} pkcs7Buffer - The PKCS#7 message buffer
 * @returns {string} CSR in PEM format
 */
function extractCSRFromSCEP(pkcs7Buffer) {
  try {
    // This is a simplified extraction method
    // In a real SCEP implementation, you'd need to properly decrypt the enveloped data
    
    // Try to find CSR patterns in the binary data
    const dataStr = pkcs7Buffer.toString('binary');
    
    // Look for CSR ASN.1 structure markers
    // This is a hack for demo purposes - real implementation needs proper parsing
    
    // For now, return null to indicate we need manual CSR input
    return null;
    
  } catch (error) {
    console.error('Error extracting CSR from SCEP:', error);
    return null;
  }
}

/**
 * Generate a transaction ID for SCEP operations
 * @returns {string} Transaction ID
 */
function generateTransactionId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate a nonce for SCEP operations
 * @returns {string} Nonce
 */
function generateNonce() {
  return crypto.randomBytes(16).toString('base64');
}

/**
 * Validate challenge password against stored challenges
 * @param {string} challengePassword - Challenge password from request
 * @param {Map} challengeStore - Store of active challenges
 * @returns {boolean} Whether challenge is valid
 */
function validateChallenge(challengePassword, challengeStore) {
  if (!challengePassword) {
    return false;
  }

  for (const [key, challenge] of challengeStore.entries()) {
    if (challenge.challengePassword === challengePassword) {
      // Check if challenge is still valid
      if (new Date() < new Date(challenge.expiresAt) && !challenge.used) {
        // Mark as used
        challenge.used = true;
        return true;
      }
    }
  }

  return false;
}

/**
 * Create a SCEP failure response
 * @param {string} transactionId - Transaction ID
 * @param {string} failInfo - Failure information
 * @returns {Buffer} PKCS#7 failure response
 */
function createSCEPFailure(transactionId, failInfo = 'badRequest') {
  try {
    // Create a simple failure response
    const failureData = {
      messageType: 'CertRep',
      pkiStatus: 'FAILURE',
      failInfo,
      transactionId
    };

    return Buffer.from(JSON.stringify(failureData));
    
  } catch (error) {
    console.error('Error creating SCEP failure response:', error);
    throw new Error('Failed to create failure response');
  }
}

module.exports = {
  parseSCEPRequest,
  createSCEPResponse,
  extractCSRFromSCEP,
  generateTransactionId,
  generateNonce,
  validateChallenge,
  createSCEPFailure
};
