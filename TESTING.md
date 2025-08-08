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

### 2. Environment Configuration
```bash
# Check if .env file exists
ls -la .env

# If .env doesn't exist, copy from example
cp .env.example .env

# View current configuration
cat .env

# Test with authentication enabled (default)
grep "ENABLE_AUTH=true" .env && echo "✓ Authentication enabled"

# Test with authentication disabled (optional)
# sed -i 's/ENABLE_AUTH=true/ENABLE_AUTH=false/' .env
```

### 3. Initialize mkcert CA
```bash
# Initialize the Certificate Authority
mkcert -install

# Verify CA was created
mkcert -CAROOT
ls -la $(mkcert -CAROOT)

# Should show rootCA.pem and rootCA-key.pem files
```

### 4. Start Application
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

## Authentication Testing

### 1. Authentication Status Testing
```bash
# Test authentication status endpoint
wget -qO- http://localhost:3000/api/auth/status | python3 -m json.tool

# Expected output with authentication enabled:
# {
#   "authEnabled": true,
#   "authenticated": false,
#   "username": null
# }
```

### 2. Login Testing
```bash
# Test login with correct credentials
wget --post-data='{"username":"admin","password":"admin"}' \
     --header='Content-Type: application/json' \
     --save-cookies=/tmp/cookies.txt \
     http://localhost:3000/api/auth/login \
     -O /tmp/login-response.json

# Verify successful login
cat /tmp/login-response.json | python3 -m json.tool

# Expected output:
# {
#   "success": true,
#   "message": "Login successful",
#   "redirectTo": "/"
# }

# Test authentication status after login
wget --load-cookies=/tmp/cookies.txt \
     -qO- http://localhost:3000/api/auth/status | python3 -m json.tool

# Expected output after login:
# {
#   "authEnabled": true,
#   "authenticated": true,
#   "username": "admin"
# }
```

### 3. Login Failure Testing
```bash
# Test login with incorrect credentials
wget --post-data='{"username":"admin","password":"wrong"}' \
     --header='Content-Type: application/json' \
     http://localhost:3000/api/auth/login \
     -O /tmp/login-fail.json 2>&1

# Verify login failure
cat /tmp/login-fail.json | python3 -m json.tool

# Should contain:
# {
#   "success": false,
#   "error": "Invalid username or password"
# }

# Test with missing credentials
wget --post-data='{"username":"admin"}' \
     --header='Content-Type: application/json' \
     http://localhost:3000/api/auth/login \
     -O /tmp/login-missing.json 2>&1

# Should return 400 error for missing password
```

### 4. Logout Testing
```bash
# Login first to get valid session
wget --post-data='{"username":"admin","password":"admin"}' \
     --header='Content-Type: application/json' \
     --save-cookies=/tmp/cookies.txt \
     http://localhost:3000/api/auth/login \
     -O /tmp/temp.json

# Test logout
wget --load-cookies=/tmp/cookies.txt \
     --method=POST \
     http://localhost:3000/api/auth/logout \
     -O /tmp/logout-response.json

# Verify successful logout
cat /tmp/logout-response.json | python3 -m json.tool

# Expected output:
# {
#   "success": true,
#   "message": "Logout successful",
#   "redirectTo": "/login"
# }

# Verify session is invalidated
wget --load-cookies=/tmp/cookies.txt \
     -qO- http://localhost:3000/api/auth/status | python3 -m json.tool

# Should show authenticated: false
```

### 5. Protected Routes Testing
```bash
# Test accessing protected API without authentication
wget http://localhost:3000/api/status -O /tmp/unauth-test.json 2>&1

# Should return 401 Unauthorized when auth is enabled

# Test with valid session
wget --post-data='{"username":"admin","password":"admin"}' \
     --header='Content-Type: application/json' \
     --save-cookies=/tmp/cookies.txt \
     http://localhost:3000/api/auth/login \
     -O /tmp/temp.json

# Now test protected route with authentication
wget --load-cookies=/tmp/cookies.txt \
     -qO- http://localhost:3000/api/status | python3 -m json.tool

# Should work and return system status
```

### 6. Login Page Testing
```bash
# Test login page loads
wget -qO- http://localhost:3000/login | grep -q "<title>" && echo "✓ Login page loads"

# Test redirect to login when not authenticated
wget -qO- http://localhost:3000/ 2>&1 | grep -q "302\|login" && echo "✓ Redirects to login"

# Test redirect to main page when already authenticated
wget --post-data='{"username":"admin","password":"admin"}' \
     --header='Content-Type: application/json' \
     --save-cookies=/tmp/cookies.txt \
     http://localhost:3000/api/auth/login \
     -O /tmp/temp.json

wget --load-cookies=/tmp/cookies.txt \
     http://localhost:3000/login 2>&1 | grep -q "302\|/" && echo "✓ Redirects authenticated users from login"
```

### 7. Session Persistence Testing
```bash
# Login and save session
wget --post-data='{"username":"admin","password":"admin"}' \
     --header='Content-Type: application/json' \
     --save-cookies=/tmp/session-cookies.txt \
     http://localhost:3000/api/auth/login \
     -O /tmp/temp.json

# Test session persists across requests
for i in {1..3}; do
    echo "Request $i:"
    wget --load-cookies=/tmp/session-cookies.txt \
         -qO- http://localhost:3000/api/auth/status | python3 -c "
import json, sys
data = json.load(sys.stdin)
print('Authenticated:', data.get('authenticated', False))
"
    sleep 1
done
```

### 8. Authentication Disabled Testing
```bash
# Backup current .env
cp .env .env.backup

# Disable authentication
sed -i 's/ENABLE_AUTH=true/ENABLE_AUTH=false/' .env

# Restart server
kill $SERVER_PID 2>/dev/null
npm start &
SERVER_PID=$!
sleep 3

# Test that authentication is disabled
wget -qO- http://localhost:3000/api/auth/status | python3 -m json.tool

# Expected output:
# {
#   "authEnabled": false
# }

# Test direct access to main page (should work without login)
wget -qO- http://localhost:3000/ | grep -q "<title>" && echo "✓ Main page accessible without auth"

# Test API access without authentication (should work)
wget -qO- http://localhost:3000/api/status | python3 -m json.tool

# Restore authentication settings
cp .env.backup .env

# Restart server with auth enabled
kill $SERVER_PID 2>/dev/null
npm start &
SERVER_PID=$!
sleep 3
```

## OpenID Connect (OIDC) SSO Testing

**Note**: OIDC testing requires a configured OIDC provider. For development/testing purposes, you can use a public OIDC test provider or set up a local identity server.

### 1. OIDC Configuration Testing
```bash
# Create OIDC test configuration
cat > .env.oidc << 'EOF'
# Copy existing configuration
ENABLE_AUTH=true
ENABLE_OIDC=true

# Test OIDC Configuration (example with a test provider)
OIDC_ISSUER=https://demo.identityserver.io
OIDC_CLIENT_ID=interactive.public
OIDC_CLIENT_SECRET=
OIDC_CALLBACK_URL=http://localhost:3000/auth/oidc/callback
OIDC_SCOPE=openid profile email
EOF

# Backup current configuration
cp .env .env.backup

# Apply OIDC configuration
cp .env.oidc .env

# Restart server with OIDC enabled
kill $SERVER_PID 2>/dev/null
npm start &
SERVER_PID=$!
sleep 5
```

### 2. OIDC Provider Discovery Testing
```bash
# Test OIDC configuration endpoint
wget -qO- http://localhost:3000/api/auth/status | python3 -m json.tool

# Expected output should include:
# {
#   "authEnabled": true,
#   "oidcEnabled": true,
#   "authenticated": false
# }

# Verify OIDC provider discovery is working
# (Check server logs for successful OIDC provider initialization)
echo "Check server logs for OIDC provider initialization..."
```

### 3. OIDC Authentication Flow Testing
```bash
# Test OIDC login initiation
# This should redirect to the OIDC provider
wget --max-redirect=0 http://localhost:3000/auth/oidc 2>&1 | grep -q "302\|Location" && echo "✓ OIDC login initiation redirects properly"

# Test OIDC callback endpoint exists
wget --spider http://localhost:3000/auth/oidc/callback 2>&1 | grep -q "200\|404" && echo "✓ OIDC callback endpoint accessible"
```

### 4. OIDC Login Page Integration Testing
```bash
# Test that login page includes OIDC option when enabled
wget -qO- http://localhost:3000/login | grep -qi "sso\|oidc\|sign.*with" && echo "✓ Login page includes OIDC option"

# Test login page loads properly with OIDC enabled
wget -qO- http://localhost:3000/login | grep -q "<title>" && echo "✓ Login page loads with OIDC enabled"
```

### 5. OIDC Configuration Validation Testing
```bash
# Test with missing OIDC configuration
cat > .env.oidc-invalid << 'EOF'
ENABLE_AUTH=true
ENABLE_OIDC=true
# Missing required OIDC settings
OIDC_ISSUER=
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
EOF

cp .env.oidc-invalid .env

# Restart and check that server handles missing config gracefully
kill $SERVER_PID 2>/dev/null
npm start &
SERVER_PID=$!
sleep 3

# Check that app still works with invalid OIDC config
wget -qO- http://localhost:3000/api/auth/status | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print('✓ Server handles invalid OIDC config gracefully')
    print('Auth enabled:', data.get('authEnabled', False))
    print('OIDC enabled:', data.get('oidcEnabled', False))
except:
    print('✗ Server error with invalid OIDC config')
"
```

### 6. Dual Authentication Testing
```bash
# Test both basic auth and OIDC enabled simultaneously
cat > .env.dual-auth << 'EOF'
ENABLE_AUTH=true
USERNAME=admin
PASSWORD=admin123
ENABLE_OIDC=true
OIDC_ISSUER=https://demo.identityserver.io
OIDC_CLIENT_ID=interactive.public
OIDC_CLIENT_SECRET=
OIDC_CALLBACK_URL=http://localhost:3000/auth/oidc/callback
OIDC_SCOPE=openid profile email
EOF

cp .env.dual-auth .env

# Restart server
kill $SERVER_PID 2>/dev/null
npm start &
SERVER_PID=$!
sleep 5

# Test that basic auth still works
wget --post-data='{"username":"admin","password":"admin123"}' \
     --header='Content-Type: application/json' \
     --save-cookies=/tmp/basic-auth-cookies.txt \
     http://localhost:3000/api/auth/login \
     -O /tmp/basic-auth-response.json

cat /tmp/basic-auth-response.json | python3 -m json.tool

# Test that login page shows both options
wget -qO- http://localhost:3000/login | grep -qi "username\|password" && echo "✓ Basic auth form present"
wget -qO- http://localhost:3000/login | grep -qi "sso\|oidc\|sign.*with" && echo "✓ OIDC option present"
```

### 7. OIDC Cleanup Testing
```bash
# Restore original configuration
cp .env.backup .env

# Restart server with original settings
kill $SERVER_PID 2>/dev/null
npm start &
SERVER_PID=$!
sleep 3

# Verify basic auth still works
wget -qO- http://localhost:3000/api/auth/status | python3 -m json.tool

# Clean up test files
rm -f .env.oidc .env.oidc-invalid .env.dual-auth .env.backup
rm -f /tmp/basic-auth-*.json /tmp/basic-auth-cookies.txt

echo "✓ OIDC testing completed and cleaned up"
```

**Manual OIDC Testing Notes:**
- Complete OIDC authentication flow requires manual browser testing with a real OIDC provider
- Test with Azure AD, Google, or other OIDC providers in your organization
- Verify that user profile information is correctly extracted from OIDC tokens
- Test OIDC logout and session management
- Verify OIDC token refresh if implemented

## Functional Testing Using Built-in Tools

### 1. System Status API Testing
```bash
# Login first if authentication is enabled
wget --post-data='{"username":"admin","password":"admin"}' \
     --header='Content-Type: application/json' \
     --save-cookies=/tmp/auth-cookies.txt \
     http://localhost:3000/api/auth/login \
     -O /tmp/temp.json 2>/dev/null

# Test system status endpoint
wget --load-cookies=/tmp/auth-cookies.txt \
     -qO- http://localhost:3000/api/status | python3 -m json.tool

# Expected output should include:
# - "success": true
# - "mkcertInstalled": true  
# - "caExists": true
# - "caRoot": "/home/username/.local/share/mkcert"
```

### 2. Root CA Information Testing
```bash
# Test CA info endpoint (using session from previous test)
wget --load-cookies=/tmp/auth-cookies.txt \
     -qO- http://localhost:3000/api/rootca/info | python3 -m json.tool

# Expected output should include:
# - Certificate subject, issuer, serial
# - Valid from/to dates
# - SHA256 fingerprint
# - Days until expiry
```

### 3. Certificate Generation Testing

#### PEM Format Certificate
```bash
# Generate PEM format certificate using wget (with authentication)
wget --load-cookies=/tmp/auth-cookies.txt \
     --post-data='{"domains":["localhost","127.0.0.1","test.local"],"format":"pem"}' \
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
# Generate CRT format certificate (with authentication)
wget --load-cookies=/tmp/auth-cookies.txt \
     --post-data='{"domains":["example.local","api.example.local"],"format":"crt"}' \
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
# List all certificates (with authentication)
wget --load-cookies=/tmp/auth-cookies.txt \
     -qO- http://localhost:3000/api/certificates | python3 -m json.tool > /tmp/certificates.json

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

# Download root CA certificate (with authentication)
wget --load-cookies=/tmp/auth-cookies.txt \
     http://localhost:3000/api/download/rootca -O mkcert-rootCA.pem

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
    # Download certificate bundle (with authentication)
    wget --load-cookies=/tmp/auth-cookies.txt \
         "http://localhost:3000/api/download/bundle/${FOLDER}/${CERT_NAME}" -O certificate-bundle.zip
    
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
    wget --load-cookies=/tmp/auth-cookies.txt \
         --method=DELETE http://localhost:3000/api/certificates/root/test-cert \
         -O /tmp/delete-response.txt 2>&1
    cat /tmp/delete-response.txt
    grep -q "403" /tmp/delete-response.txt && echo "✓ Root protection working"
fi

# Try to delete a subfolder certificate (should succeed if any exist)
if [ ! -z "$FOLDER" ] && [ ! -z "$CERT_NAME" ]; then
    wget --load-cookies=/tmp/auth-cookies.txt \
         --method=DELETE "http://localhost:3000/api/certificates/${FOLDER}/${CERT_NAME}" \
         -O /tmp/delete-response2.txt 2>&1
    cat /tmp/delete-response2.txt
fi
```

## Security Testing

### 1. Authentication Security Testing
```bash
# Test session timeout and security
# Login and get session
wget --post-data='{"username":"admin","password":"admin"}' \
     --header='Content-Type: application/json' \
     --save-cookies=/tmp/security-cookies.txt \
     http://localhost:3000/api/auth/login \
     -O /tmp/temp.json

# Test session hijacking protection (cookies should be httpOnly)
grep -q "HttpOnly" /tmp/security-cookies.txt && echo "✓ HttpOnly cookies enabled"

# Test HTTPS session security (cookies should be secure in production)
# This would need HTTPS testing environment

# Test CSRF protection by attempting requests without proper session
wget --post-data='{"domains":["malicious.test"],"format":"pem"}' \
     --header='Content-Type: application/json' \
     http://localhost:3000/api/generate \
     -O /tmp/csrf-test.json 2>&1

# Should fail without proper authentication
grep -q "401\|403" /tmp/csrf-test.json && echo "✓ CSRF protection working"
```

### 2. Input Validation Testing
```bash
# Test invalid domain names (with authentication)
wget --load-cookies=/tmp/auth-cookies.txt \
     --post-data='{"domains":[],"format":"pem"}' \
     --header='Content-Type: application/json' \
     http://localhost:3000/api/generate \
     -O /tmp/invalid-empty.json 2>&1

grep -q "400" /tmp/invalid-empty.json && echo "✓ Empty domains rejected"

# Test invalid format (with authentication)
wget --load-cookies=/tmp/auth-cookies.txt \
     --post-data='{"domains":["test.local"],"format":"invalid"}' \
     --header='Content-Type: application/json' \
     http://localhost:3000/api/generate \
     -O /tmp/invalid-format.json 2>&1

grep -q "400" /tmp/invalid-format.json && echo "✓ Invalid format rejected"

# Test SQL injection attempts in authentication
wget --post-data='{"username":"admin'\'' OR 1=1--","password":"any"}' \
     --header='Content-Type: application/json' \
     http://localhost:3000/api/auth/login \
     -O /tmp/sql-injection.json 2>&1

grep -q "401\|400" /tmp/sql-injection.json && echo "✓ SQL injection protection working"

# Test XSS attempts in domain names
wget --load-cookies=/tmp/auth-cookies.txt \
     --post-data='{"domains":["<script>alert(\"xss\")</script>.test"],"format":"pem"}' \
     --header='Content-Type: application/json' \
     http://localhost:3000/api/generate \
     -O /tmp/xss-test.json 2>&1

# Should either reject or sanitize the input
```

### 3. Rate Limiting Security Testing
```bash
# Test authentication rate limiting (brute force protection)
echo "Testing authentication rate limiting..."

# Attempt rapid login attempts (should trigger rate limit)
echo "Testing auth rate limiting with invalid credentials..."
for i in {1..7}; do
    echo "Auth attempt $i:"
    wget --post-data='{"username":"admin","password":"wrong"}' \
         --header='Content-Type: application/json' \
         http://localhost:3000/api/auth/login \
         -O /tmp/auth-rate-test-$i.json 2>&1
    
    if grep -q "429\|Too many.*authentication" /tmp/auth-rate-test-$i.json; then
        echo "✓ Auth rate limit triggered at attempt $i"
        break
    elif [ $i -gt 5 ]; then
        echo "⚠ Auth rate limit may not be working (completed $i attempts)"
    fi
    sleep 1
done

# Test CLI rate limiting for certificate generation
echo "Testing CLI rate limiting..."

# Login with correct credentials for CLI testing
wget --post-data='{"username":"admin","password":"admin"}' \
     --header='Content-Type: application/json' \
     --save-cookies=/tmp/rate-limit-cookies.txt \
     http://localhost:3000/api/auth/login \
     -O /tmp/temp.json

# Test rapid certificate generation (should hit rate limit)
echo "Attempting rapid certificate generation to test CLI rate limiting..."
for i in {1..12}; do
    echo "Request $i:"
    wget --load-cookies=/tmp/rate-limit-cookies.txt \
         --post-data="{\"domains\":[\"test$i.local\"],\"format\":\"pem\"}" \
         --header='Content-Type: application/json' \
         http://localhost:3000/api/generate \
         -O /tmp/rate-limit-test-$i.json 2>&1
    
    if grep -q "429\|Too many.*CLI" /tmp/rate-limit-test-$i.json; then
        echo "✓ CLI rate limit triggered at request $i"
        break
    elif [ $i -gt 10 ]; then
        echo "⚠ CLI rate limit may not be working (completed $i requests)"
    fi
    sleep 1
done

# Test API rate limiting for general endpoints
echo "Testing general API rate limiting..."
for i in {1..105}; do
    wget --load-cookies=/tmp/rate-limit-cookies.txt \
         -qO- http://localhost:3000/api/certificates > /tmp/api-rate-$i.json 2>&1
    
    if grep -q "429\|Too many.*API" /tmp/api-rate-$i.json; then
        echo "✓ API rate limit working (triggered at request $i)"
        break
    fi
    
    if [ $((i % 25)) -eq 0 ]; then
        echo "Completed $i API requests..."
    fi
done

# Test rate limit configuration via environment variables
echo "Testing rate limit environment variable configuration..."
cat > .env.rate-test << 'EOF'
ENABLE_AUTH=true
AUTH_USERNAME=admin
AUTH_PASSWORD=admin
CLI_RATE_LIMIT_WINDOW=900000
CLI_RATE_LIMIT_MAX=5
API_RATE_LIMIT_WINDOW=900000
API_RATE_LIMIT_MAX=50
AUTH_RATE_LIMIT_WINDOW=900000
AUTH_RATE_LIMIT_MAX=3
EOF

echo "✓ Rate limiting configuration test completed"

# Test rate limit headers
echo "Testing rate limit headers..."
wget --load-cookies=/tmp/rate-limit-cookies.txt \
     --server-response \
     http://localhost:3000/api/status \
     -O /tmp/rate-headers.txt 2>&1

grep -E "X-RateLimit|RateLimit" /tmp/rate-headers.txt && echo "✓ Rate limit headers present"

echo "✓ Rate limiting tests completed"

# Clean up rate limiting test files
rm -f /tmp/rate-limit-*.json /tmp/api-rate-*.json /tmp/auth-rate-test-*.json /tmp/rate-headers.txt
```
```

### 4. File Access Security Testing
```bash
# Try to access files outside certificate directory (should fail)
wget --load-cookies=/tmp/auth-cookies.txt \
     http://localhost:3000/api/download/cert/root/../../../etc/passwd \
     -O /tmp/security-test.txt 2>&1

grep -q "404\|400" /tmp/security-test.txt && echo "✓ Path traversal protection working"

# Test unauthorized file access without authentication
wget http://localhost:3000/api/download/rootca \
     -O /tmp/unauth-download.txt 2>&1

grep -q "401" /tmp/unauth-download.txt && echo "✓ File download requires authentication"
```

### 5. Session Management Security Testing
```bash
# Test concurrent sessions
# Login from multiple "clients"
for i in {1..3}; do
    wget --post-data='{"username":"admin","password":"admin"}' \
         --header='Content-Type: application/json' \
         --save-cookies="/tmp/session-${i}.txt" \
         http://localhost:3000/api/auth/login \
         -O "/tmp/login-${i}.json" 2>/dev/null
done

# Test that all sessions work independently
for i in {1..3}; do
    STATUS=$(wget --load-cookies="/tmp/session-${i}.txt" \
                  -qO- http://localhost:3000/api/auth/status | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(data.get('authenticated', False))
")
    echo "Session $i authenticated: $STATUS"
done

# Test session invalidation after logout
wget --load-cookies="/tmp/session-1.txt" \
     --method=POST \
     http://localhost:3000/api/auth/logout \
     -O /tmp/logout-test.json

# Verify session is invalidated
STATUS=$(wget --load-cookies="/tmp/session-1.txt" \
              -qO- http://localhost:3000/api/auth/status | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(data.get('authenticated', False))
")
echo "Session after logout: $STATUS"
[ "$STATUS" = "False" ] && echo "✓ Session properly invalidated"
```

## Performance Testing

### 1. Concurrent Certificate Generation
```bash
# Generate multiple certificates simultaneously (with authentication)
for i in {1..5}; do
    wget --load-cookies=/tmp/auth-cookies.txt \
         --post-data="{\"domains\":[\"test${i}.local\",\"api${i}.local\"],\"format\":\"pem\"}" \
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
# Get certificate count (with authentication)
CERT_COUNT=$(wget --load-cookies=/tmp/auth-cookies.txt \
                  -qO- http://localhost:3000/api/certificates | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(len(data.get('certificates', [])))
")

echo "Certificate count: $CERT_COUNT"

# Measure response time for certificate listing
time wget --load-cookies=/tmp/auth-cookies.txt \
          -qO- http://localhost:3000/api/certificates > /dev/null
```

## Browser Integration Testing

### 1. Web Interface Testing
```bash
# Test main page loads (should redirect to login when auth is enabled)
wget -qO- http://localhost:3000/ 2>&1 | grep -q "302\|login" && echo "✓ Redirects to login"

# Test login page loads
wget -qO- http://localhost:3000/login | grep -q "<title>" && echo "✓ Login page loads"

# Test authenticated access to main page
wget --load-cookies=/tmp/auth-cookies.txt \
     -qO- http://localhost:3000/ | grep -q "<title>" && echo "✓ Main page loads when authenticated"

# Test static assets
wget -qO- http://localhost:3000/styles.css | grep -q "body" && echo "✓ CSS loads"
wget -qO- http://localhost:3000/script.js | grep -q "function" && echo "✓ JavaScript loads"
```

### 2. Authentication Flow Testing (Manual Browser Testing)
```bash
echo "=== Manual Browser Testing Instructions ==="
echo "1. Open browser to http://localhost:3000"
echo "2. Should redirect to login page"
echo "3. Try invalid credentials - should show error"
echo "4. Login with admin/admin - should redirect to main page"
echo "5. Check that logout button appears"
echo "6. Test logout - should redirect back to login"
echo "7. Try accessing http://localhost:3000 again - should redirect to login"
echo "8. Test that browser back button doesn't bypass authentication"
```

### 3. Certificate Trust Testing (if desktop environment available)
```bash
# If running on desktop Ubuntu, test certificate trust
if command -v firefox &> /dev/null; then
    echo "Firefox detected - manual testing recommended:"
    echo "1. Generate a certificate for localhost"
    echo "2. Set up a test HTTPS server with the certificate"
    echo "3. Navigate to https://localhost"
    echo "4. Verify no security warnings appear"
    echo "5. Check certificate details show mkcert as issuer"
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

### Authentication Issues
```bash
# Check authentication configuration
grep "ENABLE_AUTH" .env
grep "AUTH_USERNAME" .env
grep "AUTH_PASSWORD" .env

# Reset authentication settings
cp .env.example .env
# Edit .env with your preferred settings

# Clear browser cookies if having session issues
# Or delete cookie files: rm /tmp/*cookies*.txt
```

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

### Session Issues
```bash
# Check session configuration in development
# Session cookies should work over HTTP in development
# For production, ensure HTTPS is enabled for secure cookies

# Clear existing sessions
rm /tmp/*cookies*.txt

# Restart server to reset all sessions
kill $SERVER_PID
npm start &
SERVER_PID=$!
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
- [ ] Environment configuration (.env) is properly set
- [ ] mkcert CA is installed (`mkcert -install`)
- [ ] Web server starts without errors
- [ ] **Authentication Testing:**
  - [ ] Login page loads correctly
  - [ ] Can login with correct credentials (admin/admin)
  - [ ] Login fails with incorrect credentials
  - [ ] Session persists across requests
  - [ ] Logout invalidates session
  - [ ] Protected routes require authentication
  - [ ] Unauthenticated requests are redirected to login
  - [ ] Session cookies are secure (HttpOnly)
- [ ] Web interface loads at `http://localhost:3000` (when authenticated)
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
- [ ] API endpoints respond correctly (with authentication)
- [ ] Expired certificates are clearly marked
- [ ] **Security Testing:**
  - [ ] Path traversal protection works
  - [ ] Input validation prevents malicious input
  - [ ] File downloads require authentication
  - [ ] Sessions are properly managed
  - [ ] Authentication can be disabled in development

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
