// PKCS#7 / SCEP message handling
//
// Implements the subset of RFC 8894 (SCEP) that this server needs:
//   - parseSCEPRequest: parse and decrypt an incoming PKIOperation message
//     (a SignedData wrapping an EnvelopedData wrapping a PKCS#10 CSR)
//   - buildSCEPSuccessResponse: produce a SignedData(EnvelopedData(cert))
//     for the requester
//   - buildSCEPFailureResponse: produce a CertRep with pkiStatus=FAILURE
//
// node-forge does the heavy lifting (PKCS#7 + PKCS#10 + RSA).
const forge = require('node-forge');
const crypto = require('crypto');

// SCEP message types (RFC 8894 §3.2.1.2)
const MSG_TYPE = {
  CertRep:        '3',
  PKCSReq:        '19',
  CertPoll:       '20',
  GetCert:        '21',
  GetCRL:         '22',
  RenewalReq:     '17'
};
// SCEP pkiStatus values
const PKI_STATUS = { SUCCESS: '0', FAILURE: '2', PENDING: '3' };
// SCEP failInfo values
const FAIL_INFO  = { badAlg: '0', badMessageCheck: '1', badRequest: '2', badTime: '3', badCertId: '4' };

// SCEP attribute OIDs
const OID = {
  messageType:    '2.16.840.1.113733.1.9.2',
  pkiStatus:      '2.16.840.1.113733.1.9.3',
  failInfo:       '2.16.840.1.113733.1.9.4',
  senderNonce:    '2.16.840.1.113733.1.9.5',
  recipientNonce: '2.16.840.1.113733.1.9.6',
  transactionId:  '2.16.840.1.113733.1.9.7'
};

/**
 * Parse a PKCS#7 SCEP request and extract the inner PKCS#10 CSR.
 *
 * @param {Buffer} pkcs7Buffer  DER-encoded SignedData from the client
 * @param {object} caCryptoMaterial { caKeyPem, caCertPem } — used to
 *                 decrypt the enveloped data (the EnvelopedData's recipient
 *                 is the SCEP server / CA itself).
 * @returns {object} { messageType, transactionId, senderNonce,
 *                     challengePassword, csr (forge object), csrPem,
 *                     signerCert (forge object) }
 */
function parseSCEPRequest(pkcs7Buffer, caCryptoMaterial = null) {
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pkcs7Buffer.toString('binary')));
  const signed = forge.pkcs7.messageFromAsn1(asn1);
  if (signed.type !== forge.pki.oids.signedData) {
    throw new Error('Outer PKCS#7 is not signedData');
  }
  if (!signed.signers || signed.signers.length === 0) {
    throw new Error('SCEP signedData has no signers');
  }
  const signer = signed.signers[0];

  // SCEP authenticated attributes carry messageType / transactionId / nonces.
  const attrs = {};
  for (const a of (signer.authenticatedAttributes || [])) {
    attrs[a.type] = a.value;
  }
  const messageType   = attrs[OID.messageType];
  const transactionId = attrs[OID.transactionId];
  const senderNonce   = attrs[OID.senderNonce];
  if (!messageType || !transactionId) {
    throw new Error('SCEP signedData missing messageType or transactionId');
  }

  // The signer's certificate identifies the requesting client and is the
  // public key we'll use to encrypt the response back to them.
  let signerCert = null;
  if (signed.certificates && signed.certificates.length > 0) {
    signerCert = signed.certificates[0];
  }

  // Inner content: an EnvelopedData carrying the CSR. node-forge's
  // signed.content is the raw bytes after the SignedData wrapping. We need
  // to decrypt with the CA private key.
  let csr = null, csrPem = null, challengePassword = null;
  if (caCryptoMaterial && signed.rawCapture && signed.rawCapture.content) {
    try {
      // The signed content is itself a PKCS#7 EnvelopedData; parse it.
      const innerAsn1 = forge.asn1.fromDer(signed.rawCapture.content);
      const enveloped = forge.pkcs7.messageFromAsn1(innerAsn1);
      if (enveloped.type !== forge.pki.oids.envelopedData) {
        throw new Error('Inner content is not envelopedData');
      }
      const caKey = forge.pki.privateKeyFromPem(caCryptoMaterial.caKeyPem);
      enveloped.decrypt(enveloped.recipients[0], caKey);
      // After decrypt, enveloped.content holds the CSR (PKCS#10) bytes.
      const csrDer = enveloped.content.bytes();
      const csrAsn1 = forge.asn1.fromDer(csrDer);
      csr = forge.pki.certificationRequestFromAsn1(csrAsn1);
      csrPem = forge.pki.certificationRequestToPem(csr);

      // Pull challengePassword out of the CSR attributes (RFC 2985 §5.4.1).
      for (const a of (csr.attributes || [])) {
        if (a.type === forge.pki.oids.challengePassword) {
          challengePassword = Array.isArray(a.value) ? a.value[0]?.value : a.value;
          break;
        }
      }
    } catch (err) {
      console.error('SCEP: failed to decrypt/parse inner CSR:', err.message);
    }
  }

  return {
    messageType,
    transactionId,
    senderNonce,
    challengePassword,
    csr,
    csrPem,
    signerCert
  };
}

/**
 * Build a SCEP CertRep with pkiStatus=SUCCESS containing the issued cert.
 *
 * @param {object} opts
 *   - issuedCertPem: the freshly-signed certificate (PEM)
 *   - transactionId: from the request
 *   - recipientNonce: senderNonce from the request becomes recipientNonce
 *   - signerCert: forge cert representing the requester (used as recipient)
 *   - caKeyPem, caCertPem: CA crypto material to sign the response
 * @returns {Buffer} DER-encoded SignedData
 */
function buildSCEPSuccessResponse(opts) {
  const { issuedCertPem, transactionId, recipientNonce, signerCert,
          caKeyPem, caCertPem } = opts;
  if (!signerCert) throw new Error('SCEP response requires signerCert (requester public key)');

  // 1. Wrap the issued certificate in a degenerate PKCS#7 (SignedData with
  //    no signers — just a cert bag). This is what RFC 8894 §3.3.1 requires
  //    as the response content.
  const issuedCert = forge.pki.certificateFromPem(issuedCertPem);
  const certBag = forge.pkcs7.createSignedData();
  certBag.addCertificate(issuedCert);
  const certBagDer = forge.asn1.toDer(certBag.toAsn1()).getBytes();

  // 2. Envelope (encrypt) certBagDer for the requester.
  const enveloped = forge.pkcs7.createEnvelopedData();
  enveloped.addRecipient(signerCert);
  enveloped.content = forge.util.createBuffer(certBagDer);
  enveloped.encrypt();
  const envelopedDer = forge.asn1.toDer(enveloped.toAsn1()).getBytes();

  // 3. Sign the EnvelopedData with the CA key, attaching SCEP auth attributes.
  const caCert = forge.pki.certificateFromPem(caCertPem);
  const caKey  = forge.pki.privateKeyFromPem(caKeyPem);
  const newSenderNonce = forge.util.encode64(forge.random.getBytesSync(16));

  const signed = forge.pkcs7.createSignedData();
  signed.content = forge.util.createBuffer(envelopedDer);
  signed.addCertificate(caCert);
  signed.addSigner({
    key: caKey,
    certificate: caCert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest /* filled in by sign() */ },
      { type: forge.pki.oids.signingTime, value: new Date() },
      { type: OID.messageType,    value: MSG_TYPE.CertRep },
      { type: OID.pkiStatus,      value: PKI_STATUS.SUCCESS },
      { type: OID.transactionId,  value: transactionId },
      { type: OID.senderNonce,    value: newSenderNonce },
      { type: OID.recipientNonce, value: recipientNonce || newSenderNonce }
    ]
  });
  signed.sign();
  return Buffer.from(forge.asn1.toDer(signed.toAsn1()).getBytes(), 'binary');
}

/**
 * Build a SCEP CertRep with pkiStatus=FAILURE. Signed with the CA key.
 */
function buildSCEPFailureResponse(opts) {
  const { transactionId, recipientNonce, failInfo = FAIL_INFO.badRequest,
          caKeyPem, caCertPem } = opts;
  const caCert = forge.pki.certificateFromPem(caCertPem);
  const caKey  = forge.pki.privateKeyFromPem(caKeyPem);
  const newSenderNonce = forge.util.encode64(forge.random.getBytesSync(16));

  const signed = forge.pkcs7.createSignedData();
  // Empty content for failure responses.
  signed.content = forge.util.createBuffer('');
  signed.addCertificate(caCert);
  signed.addSigner({
    key: caKey,
    certificate: caCert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
      { type: OID.messageType,    value: MSG_TYPE.CertRep },
      { type: OID.pkiStatus,      value: PKI_STATUS.FAILURE },
      { type: OID.failInfo,       value: failInfo },
      { type: OID.transactionId,  value: transactionId || generateTransactionId() },
      { type: OID.senderNonce,    value: newSenderNonce },
      { type: OID.recipientNonce, value: recipientNonce || newSenderNonce }
    ]
  });
  signed.sign();
  return Buffer.from(forge.asn1.toDer(signed.toAsn1()).getBytes(), 'binary');
}

// Backwards-compat: older code calls createSCEPFailure(transactionId, failInfo)
// without the CA material. Keep the signature but require the caller to pass
// a third argument with the keys; if absent, fall back to a JSON debug stub
// so we don't crash. New callers should use buildSCEPFailureResponse directly.
function createSCEPFailure(transactionId, failInfo = 'badRequest', caMaterial = null) {
  if (caMaterial && caMaterial.caKeyPem && caMaterial.caCertPem) {
    return buildSCEPFailureResponse({
      transactionId,
      failInfo: FAIL_INFO[failInfo] ?? FAIL_INFO.badRequest,
      caKeyPem: caMaterial.caKeyPem,
      caCertPem: caMaterial.caCertPem
    });
  }
  // Last-resort: not a real SCEP message, but at least the client gets
  // SOMETHING distinguishable instead of HTML.
  return Buffer.from(JSON.stringify({
    messageType: 'CertRep', pkiStatus: 'FAILURE', failInfo, transactionId
  }));
}

function generateTransactionId() {
  return crypto.randomBytes(16).toString('hex');
}
function generateNonce() {
  return crypto.randomBytes(16).toString('base64');
}

/**
 * Validate challenge password against stored challenges. Marks valid as used.
 */
function validateChallenge(challengePassword, challengeStore) {
  if (!challengePassword) return false;
  for (const [, challenge] of challengeStore.entries()) {
    const stored = challenge.password ?? challenge.challengePassword;
    if (stored && stored === challengePassword) {
      if (new Date() < new Date(challenge.expiresAt) && !challenge.used) {
        challenge.used = true;
        return true;
      }
    }
  }
  return false;
}

module.exports = {
  parseSCEPRequest,
  buildSCEPSuccessResponse,
  buildSCEPFailureResponse,
  createSCEPFailure,            // legacy alias
  createSCEPResponse: buildSCEPSuccessResponse, // legacy alias
  generateTransactionId,
  generateNonce,
  validateChallenge,
  MSG_TYPE,
  PKI_STATUS,
  FAIL_INFO
};
