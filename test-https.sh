#!/bin/bash
# HTTPS Auto-Trust Test Script for Ubuntu

echo "🔐 Testing mkcert Web UI HTTPS Auto-Trust on Ubuntu"
echo "=================================================="

# Check if mkcert is installed
if ! command -v mkcert &> /dev/null; then
    echo "❌ mkcert not found. Please install mkcert first."
    exit 1
fi

# Check if CA is installed
if [ ! -f "$(mkcert -CAROOT)/rootCA.pem" ]; then
    echo "⚠️  mkcert CA not installed. Installing..."
    mkcert -install
fi

echo "✅ mkcert CA location: $(mkcert -CAROOT)"

# Start the server with HTTPS in background
echo "🚀 Starting server with HTTPS..."
ENABLE_HTTPS=true npm start &
SERVER_PID=$!

# Wait for server to start
sleep 5

# Test HTTP
echo "🌐 Testing HTTP endpoint..."
if curl -s http://localhost:3000/api/status | grep -q "success"; then
    echo "✅ HTTP endpoint working"
else
    echo "❌ HTTP endpoint failed"
fi

# Test HTTPS
echo "🔒 Testing HTTPS endpoint..."
if curl -s https://localhost:3443/api/status | grep -q "success"; then
    echo "✅ HTTPS endpoint working (certificate trusted!)"
else
    echo "⚠️  HTTPS endpoint failed - checking certificate..."
    curl -k https://localhost:3443/api/status >/dev/null 2>&1 && echo "✅ HTTPS works with certificate bypass"
fi

# Check SSL certificate
echo "🔍 Checking auto-generated SSL certificate..."
if [ -f "ssl/localhost.pem" ]; then
    echo "✅ SSL certificate found: ssl/localhost.pem"
    echo "📋 Certificate details:"
    openssl x509 -in ssl/localhost.pem -noout -subject -issuer -dates
else
    echo "❌ SSL certificate not found"
fi

# Test certificate validation
echo "🔐 Testing certificate validation..."
if openssl verify -CAfile "$(mkcert -CAROOT)/rootCA.pem" ssl/localhost.pem >/dev/null 2>&1; then
    echo "✅ Certificate validates against mkcert CA"
else
    echo "❌ Certificate validation failed"
fi

# Cleanup
echo "🧹 Cleaning up..."
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null

echo ""
echo "🎉 Test complete! Access your HTTPS mkcert Web UI at:"
echo "   https://localhost:3443"
echo ""
echo "To start with HTTPS permanently:"
echo "   ENABLE_HTTPS=true npm start"
