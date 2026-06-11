# SCEP Service Documentation

## Overview

This mkcert Web UI now includes SCEP (Simple Certificate Enrollment Protocol) support, allowing devices to automatically request and receive certificates. This implementation provides a simplified SCEP server that generates certificates using mkcert.

## SCEP Endpoints

### Standard SCEP Endpoints

#### Get CA Capabilities
```bash
GET /scep?operation=GetCACaps
```
Returns the SCEP server capabilities:
- Renewal
- SHA-1
- SHA-256
- DES3
- AES

#### Get CA Certificate
```bash
GET /scep?operation=GetCACert
```
Downloads the CA certificate in PEM format. This certificate should be installed on client devices for certificate validation.

#### PKI Operation (Implemented)
```bash
POST /scep?operation=PKIOperation
Content-Type: multipart/form-data
```

Handles PKCS#7 certificate requests with SCEP protocol support. This endpoint:

1. **Parses PKCS#7 SCEP requests** using node-forge library
2. **Validates challenge passwords** against active challenge store  
3. **Extracts certificate signing requests** from PKCS#7 enveloped data
4. **Generates certificates** using mkcert for valid requests
5. **Returns PKCS#7 responses** with proper SCEP message format

**Request Format:**
- Multipart form data with `message` field containing PKCS#7 binary data
- PKCS#7 message should contain encrypted CSR and optional challenge password
- Transaction ID and nonces are handled automatically

**Response Format:**
- Success: `application/x-pki-message` containing PKCS#7 certificate response
- Failure: `application/x-pki-message` containing SCEP failure message with appropriate error codes

**Supported SCEP Message Types:**
- PKCSReq: Certificate signing request
- CertRep: Certificate response (success/failure)

**Error Handling:**
- Invalid PKCS#7: Returns `badRequest` failure
- Expired/invalid challenge: Returns `badRequest` failure  
- Certificate generation failure: Returns `systemFailure` failure

### Management API Endpoints (Authenticated)

#### Get SCEP Configuration
```bash
GET /api/scep/config
```
Returns complete SCEP server configuration including URLs and capabilities.

#### Generate Challenge Password
```bash
POST /api/scep/challenge
Content-Type: application/json

{
  "identifier": "device-001",
  "expiresIn": 3600
}
```
Generates a challenge password for SCEP clients.

#### List Challenge Passwords
```bash
GET /api/scep/challenges
```
Lists all active challenge passwords with their status.

#### Manual Certificate Generation
```bash
POST /api/scep/certificate
Content-Type: application/json

{
  "commonName": "test.example.com",
  "challengePassword": "optional-challenge"
}
```
Generates a certificate using the SCEP workflow (for testing purposes).

#### List SCEP Certificates
```bash
GET /api/scep/certificates
```
Lists all certificates generated via SCEP.

#### Get Certificate Details
```bash
GET /api/scep/certificates/:commonName
```
Returns details for a specific SCEP-generated certificate.

## Web Interface

Access the SCEP management interface at: `http://localhost:3000/scep.html`

The web interface provides:
- SCEP configuration display
- Challenge password generation and management
- Manual certificate generation for testing
- List of SCEP-generated certificates

## Client Configuration

### iOS Profile Example
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>PayloadType</key>
            <string>com.apple.security.scep</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
            <key>PayloadIdentifier</key>
            <string>com.example.scep</string>
            <key>PayloadDisplayName</key>
            <string>SCEP Certificate</string>
            <key>URL</key>
            <string>http://localhost:3000/scep</string>
            <key>Subject</key>
            <array>
                <array>
                    <string>CN</string>
                    <string>device.example.com</string>
                </array>
            </array>
            <key>Challenge</key>
            <string>YOUR_CHALLENGE_PASSWORD</string>
            <key>Keysize</key>
            <integer>2048</integer>
            <key>KeyType</key>
            <string>RSA</string>
            <key>KeyUsage</key>
            <integer>5</integer>
        </dict>
    </array>
    <key>PayloadDisplayName</key>
    <string>SCEP Configuration</string>
    <key>PayloadIdentifier</key>
    <string>com.example.scep</string>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>12345678-1234-5678-9012-123456789012</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
</dict>
</plist>
```

### Windows Certificate Template
For Windows SCEP clients, configure with:
- SCEP URL: `http://localhost:3000/scep`
- Challenge Password: Generated via web interface
- Key Length: 2048 bits
- Hash Algorithm: SHA-256

## Security Notes

1. **Development Use**: This SCEP implementation is designed for development and testing environments.

2. **Challenge Passwords**: Generate challenge passwords via the web interface before enrolling devices.

3. **HTTPS Recommended**: For production use, enable HTTPS by setting `ENABLE_HTTPS=true`.

4. **Rate Limiting**: SCEP endpoints are rate-limited to prevent abuse:
   - CLI operations: 10 requests per 15 minutes
   - API operations: 100 requests per 15 minutes

5. **Authentication**: Management API endpoints require authentication.

## Certificate Storage

SCEP-generated certificates are stored in:
```
certificates/
├── scep/
│   ├── domain1.example.com/
│   │   ├── domain1.example.com.pem
│   │   └── domain1.example.com-key.pem
│   └── domain2.example.com/
│       ├── domain2.example.com.pem
│       └── domain2.example.com-key.pem
└── temp/
    └── [temporary CSR files]
```

## Implementation Details

### PKCS#7 Message Processing

The SCEP implementation includes full PKCS#7 message parsing using the `node-forge` library:

**Components:**
- `src/utils/pkcs7.js` - PKCS#7 parsing and generation utilities
- `src/routes/scep.js` - SCEP protocol endpoint handlers  
- `node-forge` - Cryptographic operations and ASN.1 parsing
- `asn1js` - Additional ASN.1 support for complex structures

**Message Flow:**
1. **Request Parsing**: PKCS#7 signed data structures are parsed to extract:
   - Enveloped CSR data (requires decryption)
   - Challenge passwords from authenticated attributes
   - Transaction IDs and nonces for message tracking

2. **Certificate Generation**: Valid requests trigger:
   - mkcert CLI execution for certificate creation
   - Proper domain validation and certificate storage
   - Integration with existing certificate management system

3. **Response Generation**: SCEP-compliant responses include:
   - PKCS#7 signed data containing generated certificates
   - Proper SCEP message types (CertRep) 
   - Success/failure status with appropriate error codes

### Security Features

- **Challenge Password Validation**: Time-based expiration and one-time use
- **Request Rate Limiting**: Prevents abuse of certificate generation
- **Command Injection Protection**: Secured mkcert CLI execution
- **Path Traversal Prevention**: Validated certificate storage paths

## Testing

### Web Interface
Use the web interface at `/scep.html` to:
1. Generate challenge passwords
2. Test certificate generation  
3. View SCEP configuration
4. Monitor certificate status

### Command Line Testing
Test PKI operations directly:
```bash
# Test CA certificate retrieval
curl "http://localhost:3000/scep?operation=GetCACert"

# Test SCEP capabilities
curl "http://localhost:3000/scep?operation=GetCACaps" 

# Test PKI operation with PKCS#7 message
curl -X POST "http://localhost:3000/scep?operation=PKIOperation" \
  -F "message=@path/to/pkcs7-request.p7m"
```

## Limitations

- **CSR Extraction**: Enveloped data decryption requires additional implementation
- **Full SCEP Compliance**: Some advanced SCEP features not implemented
- **Certificate Revocation**: Not implemented (CRL/OCSP support)
- **Production Security**: Intended for development/testing environments

## Future Enhancements

- Complete PKCS#7 enveloped data decryption
- Certificate revocation list (CRL) support
- Integration with external Certificate Authorities
- Enhanced security for production deployments
- Enhanced security features
- Certificate renewal automation

## Troubleshooting

### Common Issues

1. **mkcert not found**: Ensure mkcert is installed and in PATH
2. **Permission errors**: Check certificate directory permissions
3. **Authentication failures**: Verify credentials and session configuration
4. **Rate limiting**: Wait for rate limit window to reset

### Debug Mode

Enable debug logging by setting environment variables:
```bash
DEBUG=scep* npm start
```

### Log Files

Check console output for SCEP-related events:
- Challenge password generation
- Certificate requests
- Error conditions
