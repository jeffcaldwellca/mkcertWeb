# Testing mkcert Web UI on Ubuntu

This document provides comprehensive testing procedures for the mkcert Web UI application on Ubuntu systems. All tests use built-in Ubuntu tools and avoid external curl calls where possible.

## Prerequisites Verification

### 1. System Requirements Check
```bash
# Check if required tools are available
which node nodejs npm wget python3 openssl

# Verify versions
node --version    # Should be 16+
npm --version     # Should be 8+
wget --version    # Built into Ubuntu
openssl version   # Built into Ubuntu
```

### 2. Install Missing Prerequisites
```bash
# Update package list
sudo apt update

# Install Node.js 18 LTS (if not installed)
sudo apt install -y nodejs npm

# Install additional tools if needed
sudo apt install -y wget curl git libnss3-tools openssl

# Verify installations
node --version && npm --version
```

### 3. Install mkcert (Ubuntu-native approach)
```bash
# Install dependencies
sudo apt install -y libnss3-tools wget

# Download mkcert (avoiding curl)
wget -O mkcert https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v1.4.4-linux-amd64
chmod +x mkcert
sudo mv mkcert /usr/local/bin/

# Verify installation
mkcert -version
which mkcert
```

## Application Setup and Installation Testing

### 1. Project Setup
```bash
# Clone the repository
git clone https://github.com/jeffcaldwellca/mkcertWeb.git
cd mkcertWeb

# Verify project structure
find . -name "*.js" -o -name "*.json" -o -name "*.md" | head -10

# Install dependencies
npm install

# Verify dependencies installed correctly
ls node_modules/ | wc -l  # Should show many packages
npm list --depth=0        # Show direct dependencies
```

### 2. Initialize mkcert CA
```bash
# Initialize the Certificate Authority
mkcert -install

# Verify CA was created
mkcert -CAROOT
ls -la $(mkcert -CAROOT)

# Should show rootCA.pem and rootCA-key.pem files
```

### 3. Start Application
```bash
# Start the server
npm start &
SERVER_PID=$!

# Wait for server to start
sleep 3

# Verify server is running
ps aux | grep node
netstat -tlnp | grep :3000
```

## Functional Testing Using Built-in Tools

### 1. System Status API Testing
```bash
# Test system status endpoint
wget -qO- http://localhost:3000/api/status | python3 -m json.tool

# Expected output should include:
# - "success": true
# - "mkcertInstalled": true  
# - "caExists": true
# - "caRoot": "/home/username/.local/share/mkcert"
```

### 2. Root CA Information Testing
```bash
# Test CA info endpoint
wget -qO- http://localhost:3000/api/rootca/info | python3 -m json.tool

# Expected output should include:
# - Certificate subject, issuer, serial
# - Valid from/to dates
# - SHA256 fingerprint
# - Days until expiry
```

### 3. Certificate Generation Testing

#### PEM Format Certificate
```bash
# Generate PEM format certificate using wget
wget --post-data='{"domains":["localhost","127.0.0.1","test.local"],"format":"pem"}' \
     --header='Content-Type: application/json' \
     http://localhost:3000/api/generate \
     -O /tmp/pem-response.json

# Verify response
cat /tmp/pem-response.json | python3 -m json.tool

# Expected output:
# - "success": true
# - "certFile": filename ending in .pem
# - "keyFile": filename ending in -key.pem
# - "folder": date-based folder path
```

#### CRT Format Certificate  
```bash
# Generate CRT format certificate
wget --post-data='{"domains":["example.local","api.example.local"],"format":"crt"}' \
     --header='Content-Type: application/json' \
     http://localhost:3000/api/generate \
     -O /tmp/crt-response.json

# Verify response
cat /tmp/crt-response.json | python3 -m json.tool

# Expected output:
# - "success": true
# - "certFile": filename ending in .crt
# - "keyFile": filename ending in .key
```

### 4. Certificate Listing Testing
```bash
# List all certificates
wget -qO- http://localhost:3000/api/certificates | python3 -m json.tool > /tmp/certificates.json

# Verify certificate list
cat /tmp/certificates.json

# Check that both generated certificates appear
grep -c "localhost" /tmp/certificates.json     # Should be > 0
grep -c "example.local" /tmp/certificates.json  # Should be > 0
```

### 5. File Download Testing
```bash
# Create temporary directory for downloads
mkdir -p /tmp/mkcert-downloads
cd /tmp/mkcert-downloads

# Download root CA certificate
wget http://localhost:3000/api/download/rootca -O mkcert-rootCA.pem

# Verify it's a valid certificate
openssl x509 -in mkcert-rootCA.pem -text -noout | head -20

# Download certificate bundle (extract folder/filename from previous listing)
# Example folder format: 2025-07-25_2025-07-25T10-30-45_localhost_127-0-0-1_test-local
FOLDER=$(cat /tmp/certificates.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
if data['certificates']:
    folder = data['certificates'][0]['folder'].replace('/', '_')
    name = data['certificates'][0]['name']
    print(f'{folder}')
")

CERT_NAME=$(cat /tmp/certificates.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
if data['certificates']:
    print(data['certificates'][0]['name'])
")

if [ ! -z "$FOLDER" ] && [ ! -z "$CERT_NAME" ]; then
    # Download certificate bundle
    wget "http://localhost:3000/api/download/bundle/${FOLDER}/${CERT_NAME}" -O certificate-bundle.zip
    
    # Verify ZIP file
    unzip -l certificate-bundle.zip
    unzip certificate-bundle.zip
    
    # Verify certificate files
    ls -la *.pem *.crt *.key 2>/dev/null || echo "Certificate files extracted"
fi
```

## File System Testing

### 1. Certificate Storage Structure
```bash
# Navigate back to project directory
cd - 

# Verify certificate organization
find certificates/ -type f -name "*.pem" -o -name "*.crt" -o -name "*.key" | head -10

# Check folder structure
find certificates/ -type d | sort

# Expected structure:
# certificates/
# certificates/YYYY-MM-DD/
# certificates/YYYY-MM-DD/YYYY-MM-DDTHH-MM-SS_domainnames/
```

### 2. File Permissions Testing
```bash
# Check file permissions
ls -la certificates/
find certificates/ -name "*.key" -exec ls -la {} \;

# Private keys should be readable by owner only (600 or similar)
# Certificates can be more permissive (644)
```

### 3. Root Certificate Protection Testing
```bash
# Try to delete a certificate from root (should fail)
if [ -d "certificates/root" ]; then
    # This should return 403 Forbidden
    wget --method=DELETE http://localhost:3000/api/certificates/root/test-cert \
         -O /tmp/delete-response.txt 2>&1
    cat /tmp/delete-response.txt
    grep -q "403" /tmp/delete-response.txt && echo "✓ Root protection working"
fi

# Try to delete a subfolder certificate (should succeed if any exist)
if [ ! -z "$FOLDER" ] && [ ! -z "$CERT_NAME" ]; then
    wget --method=DELETE "http://localhost:3000/api/certificates/${FOLDER}/${CERT_NAME}" \
         -O /tmp/delete-response2.txt 2>&1
    cat /tmp/delete-response2.txt
fi
```

## Security Testing

### 1. Input Validation Testing
```bash
# Test invalid domain names
wget --post-data='{"domains":[],"format":"pem"}' \
     --header='Content-Type: application/json' \
     http://localhost:3000/api/generate \
     -O /tmp/invalid-empty.json 2>&1

grep -q "400" /tmp/invalid-empty.json && echo "✓ Empty domains rejected"

# Test invalid format
wget --post-data='{"domains":["test.local"],"format":"invalid"}' \
     --header='Content-Type: application/json' \
     http://localhost:3000/api/generate \
     -O /tmp/invalid-format.json 2>&1

grep -q "400" /tmp/invalid-format.json && echo "✓ Invalid format rejected"
```

### 2. File Access Security Testing
```bash
# Try to access files outside certificate directory (should fail)
wget http://localhost:3000/api/download/cert/root/../../../etc/passwd \
     -O /tmp/security-test.txt 2>&1

grep -q "404\|400" /tmp/security-test.txt && echo "✓ Path traversal protection working"
```

## Performance Testing

### 1. Concurrent Certificate Generation
```bash
# Generate multiple certificates simultaneously
for i in {1..5}; do
    wget --post-data="{\"domains\":[\"test${i}.local\",\"api${i}.local\"],\"format\":\"pem\"}" \
         --header='Content-Type: application/json' \
         http://localhost:3000/api/generate \
         -O "/tmp/concurrent-${i}.json" &
done

# Wait for all to complete
wait

# Check all succeeded
for i in {1..5}; do
    if grep -q "success.*true" "/tmp/concurrent-${i}.json"; then
        echo "✓ Concurrent test $i passed"
    else
        echo "✗ Concurrent test $i failed"
    fi
done
```

### 2. Large Certificate List Testing
```bash
# Get certificate count
CERT_COUNT=$(wget -qO- http://localhost:3000/api/certificates | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(len(data.get('certificates', [])))
")

echo "Certificate count: $CERT_COUNT"

# Measure response time for certificate listing
time wget -qO- http://localhost:3000/api/certificates > /dev/null
```

## Browser Integration Testing

### 1. Web Interface Testing
```bash
# Test main page loads
wget -qO- http://localhost:3000/ | grep -q "<title>" && echo "✓ Main page loads"

# Test static assets
wget -qO- http://localhost:3000/styles.css | grep -q "body" && echo "✓ CSS loads"
wget -qO- http://localhost:3000/script.js | grep -q "function" && echo "✓ JavaScript loads"
```

### 2. Certificate Trust Testing (if desktop environment available)
```bash
# If running on desktop Ubuntu, test certificate trust
if command -v firefox &> /dev/null; then
    echo "Firefox detected - manual testing recommended:"
    echo "1. Navigate to https://localhost (if you have a localhost cert)"
    echo "2. Verify no security warnings appear"
    echo "3. Check certificate details show mkcert as issuer"
fi
```

## Error Handling Testing

### 1. Service Unavailable Testing
```bash
# Stop the server
kill $SERVER_PID 2>/dev/null || echo "Server already stopped"

# Test connection to stopped server
wget http://localhost:3000/api/status -O /tmp/stopped-test.txt 2>&1 || echo "✓ Connection refused when server stopped"

# Restart server for cleanup
npm start &
SERVER_PID=$!
sleep 3
```

### 2. Missing mkcert Testing
```bash
# Temporarily rename mkcert to simulate missing installation
sudo mv /usr/local/bin/mkcert /usr/local/bin/mkcert.backup 2>/dev/null || echo "mkcert not in /usr/local/bin"

# Test API response
wget -qO- http://localhost:3000/api/status | python3 -c "
import json, sys
data = json.load(sys.stdin)
if not data.get('mkcertInstalled', True):
    print('✓ Missing mkcert detected correctly')
else:
    print('✗ Missing mkcert not detected')
"

# Restore mkcert
sudo mv /usr/local/bin/mkcert.backup /usr/local/bin/mkcert 2>/dev/null || echo "mkcert restored"
```

## Cleanup and Validation

### 1. Test Cleanup
```bash
# Stop the server
kill $SERVER_PID 2>/dev/null

# Clean up test files
rm -rf /tmp/mkcert-downloads /tmp/*.json /tmp/*.txt

# Optionally clean up generated certificates
# rm -rf certificates/$(date +%Y-%m-%d)

echo "✓ Test cleanup completed"
```

### 2. Final Validation Report
```bash
echo "=== mkcert Web UI Test Summary ==="
echo "Date: $(date)"
echo "Ubuntu Version: $(lsb_release -d | cut -f2)"
echo "Node.js Version: $(node --version)"
echo "mkcert Version: $(mkcert -version 2>/dev/null || echo 'Not found')"
echo "Certificate Count: $(find certificates/ -name "*.pem" -o -name "*.crt" | wc -l)"
echo "Server Status: $(wget -q --spider http://localhost:3000 && echo 'Running' || echo 'Stopped')"
echo "=================================="
```

## Automated Test Script

Create an automated test runner:

```bash
#!/bin/bash
# save as test-runner.sh
set -e

echo "Starting automated mkcert Web UI tests..."

# Source all the test commands above
# This script can be expanded to include all tests in sequence

echo "✓ All tests completed successfully!"
```

## Troubleshooting Common Issues

### Permission Issues
```bash
# Fix certificate directory permissions
chmod 755 certificates/
find certificates/ -type f -name "*.key" -exec chmod 600 {} \;
find certificates/ -type f -name "*.pem" -o -name "*.crt" -exec chmod 644 {} \;
```

### Port Conflicts
```bash
# Check what's using port 3000
sudo netstat -tlnp | grep :3000

# Use alternative port
PORT=3001 npm start
```

### mkcert Issues
```bash
# Reinstall CA if needed
mkcert -uninstall
mkcert -install

# Check CA location and permissions
ls -la $(mkcert -CAROOT)
```

This comprehensive testing suite ensures the mkcert Web UI works correctly on Ubuntu systems using only built-in tools and package manager installations.
mkcert -install

# Verify CA installation
mkcert -CAROOT
ls -la $(mkcert -CAROOT)
```

### 5. Start the Web UI
```bash
# Start the server
npm start

# Or for development with auto-restart
npm run dev
```

### 6. Access the Web Interface
Open your browser and go to: `http://localhost:3000`

### 7. Test Certificate Generation

#### Via Web Interface:
1. Open `http://localhost:3000` in your browser
2. Check the system status (should show mkcert installed and CA installed)
3. Enter domains in the text area (one per line):
   ```
   localhost
   127.0.0.1
   *.local.dev
   test.example.com
   ```
4. Choose certificate format:
   - **PEM**: Standard format (.pem, -key.pem) - good for most applications
   - **CRT/KEY**: Web server format (.crt, .key) - common for Apache, Nginx, etc.
5. Click "Generate Certificate"
6. Download the generated certificates

#### Via API (using curl):
```bash
# Generate a PEM certificate via API
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"domains": ["localhost", "127.0.0.1", "*.local.dev"], "format": "pem"}'

# Generate a CRT/KEY certificate via API  
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"domains": ["web.local"], "format": "crt"}'

# List all certificates
curl http://localhost:3000/api/certificates

# Download a certificate (PEM format example)
curl -O http://localhost:3000/api/download/cert/localhost_127-0-0-1_local-dev.pem

# Download a certificate (CRT format example)  
curl -O http://localhost:3000/api/download/cert/web_local.crt

# Download a key file (PEM format example)
curl -O http://localhost:3000/api/download/key/localhost_127-0-0-1_local-dev-key.pem

# Download a key file (CRT format example)
curl -O http://localhost:3000/api/download/key/web_local.key

# Download bundle as ZIP
curl -O http://localhost:3000/api/download/bundle/localhost_127-0-0-1_local-dev
```

### 8. Verify Generated Certificates
```bash
# Check certificates directory
ls -la certificates/

# Verify certificate details and expiry (works for both .pem and .crt)
openssl x509 -in certificates/your-cert-file.pem -text -noout
openssl x509 -in certificates/your-cert-file.crt -text -noout

# Check certificate expiry specifically
openssl x509 -in certificates/your-cert-file.pem -noout -enddate
openssl x509 -in certificates/your-cert-file.crt -noout -enddate

# Check certificate domains
openssl x509 -in certificates/your-cert-file.pem -noout -text | grep -A1 "Subject Alternative Name"

# Test the certificate with a simple HTTPS server
# (Optional - requires additional setup)
```

### 9. Test Certificate Management and Expiry Display
1. **View certificates**: Check the web interface for the list
2. **Verify format badges**: Each certificate should show PEM or CRT/KEY format badge
3. **Verify expiry information**: Each certificate should show:
   - Days until expiry with color coding:
     - Green: More than 30 days
     - Yellow/Orange: 7-30 days  
     - Red: Less than 7 days or expired
   - Exact expiry date
   - Domain names covered by the certificate
4. **Test both formats**: Generate certificates in both PEM and CRT/KEY formats
5. **Download individual files**: Click download buttons for both formats
6. **Download bundles**: Test ZIP download functionality  
7. **Delete certificates**: Use the delete button and verify files are removed

## Troubleshooting on Ubuntu

### Common Issues and Solutions:

1. **mkcert command not found**
   ```bash
   # Add to PATH if needed
   echo 'export PATH=$PATH:/usr/local/bin' >> ~/.bashrc
   source ~/.bashrc
   ```

2. **Permission denied errors**
   ```bash
   # Make sure user has write permissions
   chmod 755 /path/to/mkcertWeb
   chmod 755 /path/to/mkcertWeb/certificates
   ```

3. **Port 3000 already in use**
   ```bash
   # Use a different port
   PORT=3001 npm start
   ```

4. **CA installation fails**
   ```bash
   # Install NSS tools for browser support
   sudo apt install libnss3-tools
   mkcert -install
   ```

5. **Node.js version too old**
   ```bash
   # Update Node.js
   sudo npm install -g n
   sudo n stable
   ```

## Testing Checklist

- [ ] mkcert is installed and accessible
- [ ] Node.js and npm are installed
- [ ] Project dependencies are installed
- [ ] mkcert CA is installed (`mkcert -install`)
- [ ] Web server starts without errors
- [ ] Web interface loads at `http://localhost:3000`
- [ ] System status shows green checkmarks
- [ ] Can generate certificates for multiple domains
- [ ] Can generate certificates in PEM format (.pem, -key.pem)
- [ ] Can generate certificates in CRT/KEY format (.crt, .key)
- [ ] Certificate format badges display correctly
- [ ] Certificate expiry dates are displayed correctly
- [ ] Expiry status shows proper color coding (green/yellow/red)
- [ ] Domain names are extracted and displayed
- [ ] Can download individual certificate files (both formats)
- [ ] Can download certificate bundles (ZIP)
- [ ] Can delete certificates (both formats)
- [ ] API endpoints respond correctly
- [ ] Expired certificates are clearly marked

## Expected File Structure After Testing
```
mkcertWeb/
├── certificates/           # Generated certificates will appear here
│   ├── localhost.pem       # PEM format certificate
│   ├── localhost-key.pem   # PEM format key
│   ├── web_local.crt       # CRT format certificate  
│   ├── web_local.key       # CRT format key
│   ├── test_example_com.pem
│   └── test_example_com-key.pem
├── node_modules/          # Dependencies
├── public/                # Web interface files
├── server.js              # Main server
└── package.json           # Project configuration
```

## Performance Testing
```bash
# Test with multiple concurrent requests
for i in {1..5}; do
  curl -X POST http://localhost:3000/api/generate \
    -H "Content-Type: application/json" \
    -d "{\"domains\": [\"test$i.local\"]}" &
done
wait
```

This should give you a comprehensive way to test the mkcert Web UI on your Ubuntu system!
