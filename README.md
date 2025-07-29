# mkcert Web UI

A modern web interface for managing SSL certificates using the mkcert CLI tool. This application provides an easy-to-use interface for generating, downloading, and managing local development certificates with organized storage and comprehensive certificate management features.

## Screenshot

![mkcert Web UI Screenshot](public/assets/screenshot.png)

*The mkcert Web UI featuring the new red/green terminal-style theme with certificate management, system status, and Root CA information.*

## Features

- **🔐 Certificate Generation**: Create SSL certificates for multiple domains and IP addresses
- **📁 Organized Storage**: Automatic timestamp-based folder organization (YYYY-MM-DD/YYYY-MM-DDTHH-MM-SS_domains/)
- **🔒 Optional Authentication**: Secure access with configurable user authentication (can be disabled)
- **🌐 HTTPS Support**: Auto-generated SSL certificates for secure web interface access
- **📋 Certificate Management**: View, download, and archive certificates with expiry tracking
- **📦 Bundle Downloads**: Download certificate and key files as ZIP bundles
- **🔑 Root CA Management**: Install, view, and download the mkcert root Certificate Authority
- **🎨 Terminal-Style UI**: Modern red/green color scheme with monospace fonts and glowing effects
- **🌙 Dark/Light Mode**: Switchable themes with persistent user preference storage
- **🔒 Security**: Root certificates are read-only protected, authenticated sessions, input validation
- **📊 Certificate Details**: View domains, expiry dates, file sizes, and certificate information
- **🔄 Dual Format Support**: Generate certificates in PEM (.pem/.key) or CRT (.crt/.key) formats

## Prerequisites

### Required Software
1. **Node.js** (version 16 or higher) - JavaScript runtime
2. **mkcert** - Local certificate authority tool
3. **OpenSSL** - Certificate analysis (usually pre-installed on Ubuntu)

### Ubuntu Installation (Recommended)

#### Install Node.js
```bash
# Install Node.js 18 LTS (recommended)
sudo apt update
sudo apt install -y nodejs npm

# Verify installation
node --version  # Should be v16+ 
npm --version
```

#### Install mkcert
```bash
# Install dependencies
sudo apt install -y libnss3-tools wget

# Download and install mkcert (latest version)
wget -O mkcert https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v1.4.4-linux-amd64
chmod +x mkcert
sudo mv mkcert /usr/local/bin/

# Verify installation
mkcert -version
```

#### Install OpenSSL (if not present)
```bash
# Usually pre-installed, but if needed:
sudo apt install -y openssl

# Verify installation
openssl version
```
## Installation

### Quick Start (Ubuntu)

1. **Clone the repository**:
```bash
git clone https://github.com/jeffcaldwellca/mkcertWeb.git
cd mkcertWeb
```

2. **Install dependencies**:
```bash
npm install
```

3. **Initialize mkcert** (first time only):
```bash
# Create and install the root CA
mkcert -install
```

4. **Start the application**:
```bash
npm start
```

5. **Access the web interface**:
   - Open your browser to `http://localhost:3000`
   - **If authentication is enabled**: You'll be redirected to the login page
     - Use credentials from your `.env` file (default: admin/admin123)
     - After successful login, you'll access the main interface
   - **If authentication is disabled**: You'll go directly to the certificate generation interface
   - The application will verify mkcert installation and CA status

## HTTPS Configuration

The application supports automatic HTTPS with self-signed certificates generated using mkcert. This provides a secure development environment without browser warnings.

### Quick HTTPS Setup

#### Option 1: HTTPS with HTTP Fallback (Recommended for Development)
```bash
# Start with both HTTP and HTTPS servers
npm run https

# Or with environment variables
ENABLE_HTTPS=true npm start

# Access via:
# HTTP:  http://localhost:3000
# HTTPS: https://localhost:3443
```

#### Option 2: HTTPS Only (Redirects HTTP to HTTPS)
```bash
# Start with HTTPS only (HTTP redirects to HTTPS)
npm run https-only

# Or with environment variables
ENABLE_HTTPS=true FORCE_HTTPS=true npm start

# All requests redirect to: https://localhost:3443
```

#### Option 3: Custom Domain HTTPS
```bash
# Generate certificate for custom domain
SSL_DOMAIN=myapp.local ENABLE_HTTPS=true npm start

# Access via: https://myapp.local:3443
# (Add "127.0.0.1 myapp.local" to /etc/hosts)
```

### Environment Variables for HTTPS

Create a `.env` file (see `.env.example`) or set environment variables:

```bash
# Basic HTTPS configuration
ENABLE_HTTPS=true             # Enable HTTPS server
HTTPS_PORT=3443              # HTTPS server port (default: 3443)
SSL_DOMAIN=localhost         # Domain for SSL certificate (default: localhost)

# Advanced options
FORCE_HTTPS=true             # Redirect all HTTP to HTTPS
PORT=3000                    # HTTP server port (default: 3000)
```

### SSL Certificate Management

The application automatically:
1. **Generates SSL certificates** on first HTTPS startup using mkcert
2. **Stores certificates** in `./ssl/` directory
3. **Reuses existing certificates** on subsequent startups
4. **Includes multiple domains**: localhost, 127.0.0.1, ::1, and custom domain

Certificate files:
```
ssl/
├── {domain}.pem          # SSL certificate
└── {domain}-key.pem      # Private key
```

### Browser Trust Setup

Since the certificates are generated by mkcert, they are automatically trusted if you have:
1. **Installed mkcert**: `mkcert -install` (done during setup)
2. **Root CA installed**: The mkcert root CA should be in your system trust store

If you see browser warnings:
```bash
# Verify mkcert installation
mkcert -install

# Check CA location
mkcert -CAROOT

# Regenerate SSL certificates
rm -rf ssl/
npm run https
```

### Production Deployment (Ubuntu)

#### Option 1: Simple Service User Deployment
```bash
# Create dedicated user
sudo adduser --system --group --home /opt/mkcertui mkcertui

# Install application
sudo cp -r mkcertWeb /opt/mkcertui/
sudo chown -R mkcertui:mkcertui /opt/mkcertui/

# Switch to service user and install dependencies
sudo su - mkcertui
cd mkcertWeb
npm install

# Initialize mkcert for this user
mkcert -install

# Start application
npm start
```

#### Option 2: Systemd Service
```bash
# Create systemd service file
sudo tee /etc/systemd/system/mkcertui.service << 'EOF'
[Unit]
Description=mkcert Web UI
After=network.target
Wants=network.target

[Service]
Type=simple
User=mkcertui
Group=mkcertui
WorkingDirectory=/opt/mkcertui/mkcertWeb
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=3000

# Security settings
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/opt/mkcertui
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable mkcertui
sudo systemctl start mkcertui

# Check status
sudo systemctl status mkcertui
```

### Environment Configuration

#### Environment Variables
```bash
# Server Configuration
PORT=3000                    # HTTP server port (default: 3000)
HTTPS_PORT=3443             # HTTPS server port (default: 3443)

# SSL/HTTPS Configuration  
ENABLE_HTTPS=true           # Enable HTTPS server (default: false)
SSL_DOMAIN=localhost        # Domain name for SSL certificate (default: localhost)
FORCE_HTTPS=true            # Redirect HTTP to HTTPS (default: false)

# Application Configuration
NODE_ENV=production         # Environment mode
CERT_DIR=/custom/path       # Custom certificate storage (optional)
```

#### Reverse Proxy (Nginx)
```bash
# Install nginx
sudo apt install -y nginx

# Create nginx configuration
sudo tee /etc/nginx/sites-available/mkcertui << 'EOF'
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

# Enable site
sudo ln -s /etc/nginx/sites-available/mkcertui /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## Usage

### First Time Setup

1. **Verify Prerequisites**: The web interface will check if mkcert and OpenSSL are installed
2. **Install Root CA**: If not already installed, the app will prompt you to install the mkcert root CA
3. **Download Root CA**: Use the Root CA section to download the certificate for other systems

### Certificate Generation

1. **Access the Web Interface**: Navigate to `http://localhost:3000`
2. **Enter Domains**: In the generation form, enter domain names (one per line):
   ```
   localhost
   127.0.0.1
   *.example.com
   example.com
   myapp.local
   ```
3. **Select Format**:
   - **PEM Format**: Standard format (.pem certificate, -key.pem private key)
   - **CRT Format**: Common for web servers (.crt certificate, .key private key)
4. **Generate**: Click "Generate Certificate"

### Certificate Organization

Certificates are automatically organized in a hierarchical structure:
```
certificates/
├── root/                           # Legacy certificates (read-only)
│   ├── example.pem
│   └── example-key.pem
└── 2025-07-25/                     # Date-based folders
    ├── 2025-07-25T10-30-45_localhost_127-0-0-1/
    │   ├── localhost_127-0-0-1.pem
    │   └── localhost_127-0-0-1-key.pem
    └── 2025-07-25T14-15-20_example_com/
        ├── example_com.crt
        └── example_com.key
```

### Certificate Management

#### Viewing Certificates
- **Certificate List**: Shows all certificates with details:
  - Domain names covered
  - Expiry date and status
  - File format (PEM/CRT)
  - Creation date and file size
  - Storage location

#### Downloading Certificates
- **Individual Files**: Download certificate or key files separately
- **Bundle Download**: Download both files as a ZIP archive
- **Root CA**: Download the mkcert root certificate for system installation

#### Certificate Deletion
- **Subfolder Certificates**: Can be deleted (includes automatic cleanup of empty folders)
- **Root Certificates**: Protected from deletion (read-only)

### Root CA Management

#### Viewing CA Information
The Root CA section displays:
- Certificate subject and issuer
- Validity period and expiry status
- SHA256 fingerprint for verification
- File system path
- Installation status

#### Installing Root CA on Other Systems

**Linux (Ubuntu/Debian)**:
```bash
# Download the root CA from the web interface, then:
sudo cp mkcert-rootCA.pem /usr/local/share/ca-certificates/mkcert-rootCA.crt
sudo update-ca-certificates
```

**Windows**:
1. Download root CA from web interface
2. Double-click the .pem file
3. Install to "Trusted Root Certification Authorities"

**macOS**:
1. Download root CA from web interface
2. Double-click to add to Keychain
3. Set trust settings to "Always Trust"
**Browser Trust**:
1. Import the root CA into browser security settings
2. Add to "Authorities" or "Certificate Authorities" section

## API Documentation

### REST API Endpoints

The application provides a comprehensive REST API for programmatic access.

**🔒 Authentication Note**: When authentication is enabled, API endpoints require valid session cookies. For programmatic access, you may need to:
1. Disable authentication by setting `DISABLE_AUTH=true` in your `.env` file, or
2. First authenticate via `POST /login` to establish a session before making API calls

#### Authentication
- `POST /login` - Authenticate user and establish session
- `POST /logout` - Destroy current session

#### System Status  
- `GET /api/status` - Get mkcert installation and CA status
- `POST /api/install-ca` - Install the mkcert root CA (requires user confirmation)

#### Root CA Management
- `GET /api/rootca/info` - Get detailed root CA certificate information
- `GET /api/download/rootca` - Download root CA certificate file

#### Certificate Management
- `POST /api/generate` - Generate new certificates
- `GET /api/certificates` - List all certificates with metadata
- `DELETE /api/certificates/:folder/:certname` - Delete specific certificate

#### File Downloads
- `GET /api/download/cert/:folder/:filename` - Download certificate file
- `GET /api/download/key/:folder/:filename` - Download private key file
- `GET /api/download/bundle/:folder/:certname` - Download certificate bundle (ZIP)

### API Usage Examples

#### Generate Certificate (using wget - built into Ubuntu)
```bash
# Generate PEM format certificate
wget --post-data='{"domains":["localhost","127.0.0.1","*.local.dev"],"format":"pem"}' \
     --header='Content-Type: application/json' \
     http://localhost:3000/api/generate \
     -O /tmp/cert-response.json

# Generate CRT format certificate
wget --post-data='{"domains":["example.local","api.example.local"],"format":"crt"}' \
     --header='Content-Type: application/json' \
     http://localhost:3000/api/generate \
     -O /tmp/cert-response.json
```

#### Download Certificate Bundle
```bash
# Download as bundle (no external tools needed)
wget http://localhost:3000/api/download/bundle/2025-07-25_2025-07-25T10-30-45_localhost/localhost_127-0-0-1 \
     -O certificate-bundle.zip
```

#### Check System Status
```bash
# Check if mkcert is installed and CA exists
wget -qO- http://localhost:3000/api/status | python3 -m json.tool
```

#### List All Certificates
```bash
# Get certificate inventory
wget -qO- http://localhost:3000/api/certificates | python3 -m json.tool
```

## File Structure

```
mkcertWeb/
├── server.js                 # Express server and API routes
├── package.json             # Node.js dependencies and scripts  
├── public/                  # Frontend static assets
│   ├── index.html          # Main web interface
│   ├── login.html          # Authentication login page
│   ├── styles.css          # Terminal-style CSS with red/green theme
│   ├── script.js           # Frontend JavaScript functionality
│   └── assets/             # Static assets (screenshots, etc.)
├── certificates/            # Certificate storage (organized by date)
│   ├── root/               # Legacy certificates (read-only)
│   └── YYYY-MM-DD/         # Date-based organization
│       └── YYYY-MM-DDTHH-MM-SS_domains/  # Timestamped folders
├── .env.example            # Environment configuration template
├── README.md               # Comprehensive documentation
├── CHANGELOG.md            # Version history and release notes
├── TESTING.md              # Testing procedures and validation
└── package-lock.json       # Dependency lock file
```

## Security & Best Practices

### Security Model
- **Development Focus**: Designed for local development environments
- **Optional Authentication**: Configurable user authentication with session management
- **Regular User Execution**: Runs without root privileges (except for `mkcert -install`)
- **Read-Only Protection**: Root directory certificates cannot be deleted
- **Session Security**: HTTP-only cookies with CSRF protection
- **Organized Storage**: Timestamp-based folders prevent conflicts

### Network Security
- **HTTP Only**: Suitable for localhost development (consider HTTPS proxy for production)
- **Local Binding**: Binds to localhost by default (configurable)
- **No External Dependencies**: No outbound network calls required during operation

### File Permissions
```bash
# Recommended permissions for production deployment
find /opt/mkcertui -type f -name "*.pem" -exec chmod 600 {} \;  # Private keys
find /opt/mkcertui -type f -name "*.crt" -exec chmod 644 {} \;  # Certificates
find /opt/mkcertui -type d -exec chmod 755 {} \;               # Directories
```

## Development

### Local Development
```bash
# Clone and setup
git clone https://github.com/jeffcaldwellca/mkcertWeb.git
cd mkcertWeb
npm install

# Development modes
npm start                    # HTTP only (http://localhost:3000)
npm run https               # HTTP + HTTPS (http://localhost:3000 & https://localhost:3443)
npm run https-only          # HTTPS only with HTTP redirect (https://localhost:3443)
npm run dev                 # HTTP with auto-restart (nodemon)
npm run https-dev          # HTTPS with auto-restart (nodemon)

# Custom domain HTTPS
SSL_DOMAIN=myapp.local npm run https
```

### Testing
See `TESTING.md` for comprehensive testing procedures including:
- Installation verification
- Certificate generation testing
- API endpoint validation
- Security testing
- Browser integration testing

## Configuration

### Environment Variables
```bash
# Server Configuration
PORT=3000                    # Server port (default: 3000)
HTTPS_PORT=3443             # HTTPS server port (default: 3443)
NODE_ENV=production          # Environment mode (development/production)
CERT_DIR=/custom/path        # Custom certificate storage directory

# HTTPS Configuration
ENABLE_HTTPS=true           # Enable HTTPS server (true/false)
SSL_DOMAIN=localhost        # Domain name for SSL certificate
FORCE_HTTPS=false           # Redirect HTTP to HTTPS (true/false)

# Authentication Configuration
ENABLE_AUTH=false           # Enable user authentication (true/false)
AUTH_USERNAME=admin         # Username for authentication (when ENABLE_AUTH=true)
AUTH_PASSWORD=admin         # Password for authentication (when ENABLE_AUTH=true)
SESSION_SECRET=your-secret  # Session secret key - CHANGE IN PRODUCTION!

# UI Configuration
DEFAULT_THEME=dark          # Default theme mode for new users (dark/light)
```

### Authentication Setup

To enable user authentication and secure access to the web interface:

1. **Copy the example configuration:**
   ```bash
   cp .env.example .env
   ```

2. **Enable authentication in `.env`:**
   ```bash
   ENABLE_AUTH=true
   AUTH_USERNAME=your-username
   AUTH_PASSWORD=your-secure-password
   SESSION_SECRET=your-very-long-random-secret-key
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

4. **Access the application:**
   - Visit http://localhost:3000 (or your configured URL)
   - You'll be redirected to a login page
   - Enter your configured username and password

**Security Notes:**
- When `ENABLE_AUTH=false`, authentication is completely disabled and users have direct access
- When `ENABLE_AUTH=true`, all API routes are protected and require valid session authentication
- Always use a strong, unique `SESSION_SECRET` in production environments
- Consider using HTTPS when authentication is enabled for additional security

### Theme Configuration

The application supports both dark and light themes with a toggle button. You can set the default theme for new users:

```bash
# Set default theme in .env
DEFAULT_THEME=light  # Start with light mode for new users
DEFAULT_THEME=dark   # Start with dark mode for new users (default)
```

**Theme Behavior:**
- Users can toggle between themes using the button in the header
- Theme preference is saved in browser localStorage
- If no stored preference exists, the server's `DEFAULT_THEME` setting is used
- Supports both the main application and login page
- Available via API endpoint: `GET /api/config/theme`

### Customization
```bash
# Custom certificate storage location
export CERT_DIR=/var/lib/mkcertui/certificates
mkdir -p $CERT_DIR
chown mkcertui:mkcertui $CERT_DIR
```

## Troubleshooting

### Common Issues

#### mkcert not found
```bash
# Verify installation
which mkcert
mkcert -version

# Check PATH
echo $PATH
```

#### Permission Denied
```bash
# Check file permissions
ls -la certificates/
# Ensure proper ownership
sudo chown -R $(whoami):$(whoami) certificates/
```

#### Port Already in Use
```bash
# Check what's using port 3000
sudo netstat -tlnp | grep :3000
# Use different port
PORT=3001 npm start
```

#### CA Installation Issues
```bash
# Manual CA installation
mkcert -install
# Verify CA location
mkcert -CAROOT
# Check CA files exist
ls -la $(mkcert -CAROOT)
```

#### Browser Trust Issues
1. Clear browser cache and cookies
2. Restart browser after CA installation
3. Check browser certificate settings
4. Verify system certificate store

### Log Analysis
```bash
# Check application logs
journalctl -u mkcertui -f

# Check nginx logs (if using reverse proxy)
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

## Contributing

### Development Setup
1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Install dependencies: `npm install`
4. Make changes and test thoroughly
5. Run tests: `npm test` (see TESTING.md)
6. Submit a pull request

### Code Style
- ESLint configuration for consistent code style
- Comprehensive error handling
- Clear API documentation
- Responsive UI design

## Resources

- **mkcert**: [GitHub Repository](https://github.com/FiloSottile/mkcert)
- **Node.js**: [Official Documentation](https://nodejs.org/docs/)
- **Express.js**: [Framework Documentation](https://expressjs.com/)
- **SSL/TLS**: [Mozilla SSL Configuration](https://ssl-config.mozilla.org/)
