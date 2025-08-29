#!/bin/bash

# Demo script for mkcert Web UI Email Notifications & Certificate Monitoring

echo "🔒 mkcert Web UI - Email & Monitoring Demo Setup"
echo "=============================================="

# Check if mkcert is installed
if ! command -v mkcert &> /dev/null; then
    echo "❌ mkcert is not installed. Please install it first:"
    echo "   macOS: brew install mkcert"
    echo "   Linux: See https://github.com/FiloSottile/mkcert#installation"
    exit 1
fi

# Create certificates directory if it doesn't exist
mkdir -p certificates/demo

echo ""
echo "📁 Creating demo certificates..."

# Generate some test certificates
cd certificates/demo

# Demo certificates with different domains
echo "   🔸 Generating certificate for demo1.local..."
mkcert -cert-file demo1.local.pem -key-file demo1.local-key.pem demo1.local

echo "   🔸 Generating certificate for demo2.local..."
mkcert -cert-file demo2.local.pem -key-file demo2.local-key.pem demo2.local

echo "   🔸 Generating certificate for *.demo.local..."
mkcert -cert-file wildcard.demo.local.pem -key-file wildcard.demo.local-key.pem "*.demo.local"

echo "   🔸 Generating certificate for multiple domains..."
mkcert -cert-file multi-domain.pem -key-file multi-domain-key.pem \
    api.demo.local web.demo.local admin.demo.local

cd ../..

echo ""
echo "✅ Demo certificates created!"
echo ""

# List created certificates
echo "📋 Created certificates:"
find certificates/demo -name "*.pem" | grep -v key | while read cert; do
    echo "   📄 $cert"
    # Try to get expiry date
    if command -v openssl &> /dev/null; then
        expiry=$(openssl x509 -in "$cert" -noout -enddate 2>/dev/null | sed 's/notAfter=//')
        if [ ! -z "$expiry" ]; then
            echo "      ⏰ Expires: $expiry"
        fi
    fi
done

echo ""
echo "🚀 Next Steps:"
echo "1. Configure email settings in .env file (see examples/ folder)"
echo "2. Set CERT_WARNING_DAYS=3650 to detect these certificates"
echo "3. Set CERT_MONITORING_ENABLED=true"
echo "4. Start the server: npm start"
echo "5. Visit http://localhost:3000 and test the notification features"
echo ""
echo "📧 Example .env configuration:"
echo "EMAIL_NOTIFICATIONS_ENABLED=true"
echo "SMTP_HOST=smtp.gmail.com"
echo "SMTP_PORT=587"
echo "SMTP_USER=your-email@gmail.com"
echo "SMTP_PASSWORD=your-app-password"
echo "EMAIL_TO=your-email@gmail.com"
echo "CERT_MONITORING_ENABLED=true"
echo "CERT_WARNING_DAYS=3650"
echo ""
echo "Happy testing! 🎉"
