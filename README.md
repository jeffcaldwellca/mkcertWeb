# mkcert Web UI

A modern web interface for managing SSL certificates using the mkcert CLI tool. Generate, download, and manage local development certificates with an intuitive web interface.

## ✨ Key Features

- **🔐 SSL Certificate Generation**: Create certificates for multiple domains and IP addresses
- **📋 Multiple Formats**: Generate PEM, CRT, and PFX (PKCS#12) certificates
- **🔒 Flexible Authentication**: Basic auth and enterprise SSO with OpenID Connect
- **🛡️ Security**: Built-in rate limiting and command injection protection
- **🌐 HTTPS Support**: Auto-generated SSL certificates for secure access
- **� Certificate Management**: View, download, archive, and restore certificates
- **🎨 Modern UI**: Dark/light themes with responsive design
- **🐳 Docker Ready**: Complete containerization with docker-compose

## 🚀 Quick Start

### Using Docker (Recommended)

```bash
# Clone and start
git clone https://github.com/jeffcaldwellca/mkcertWeb.git
cd mkcertWeb
docker-compose up -d

# Access at http://localhost:3000
```

### Local Installation

```bash
# Prerequisites: Node.js 16+, mkcert, OpenSSL
npm install
mkcert -install    # First time only
npm start
```

**For detailed setup instructions, see [DOCKER.md](DOCKER.md)**

## ⚙️ Configuration

### Essential Environment Variables

```bash
# Server Configuration
PORT=3000                    # HTTP server port
ENABLE_HTTPS=true            # Enable HTTPS server
HTTPS_PORT=3443              # HTTPS server port

# Authentication 
ENABLE_AUTH=true             # Enable user authentication
AUTH_USERNAME=admin          # Username for basic authentication
AUTH_PASSWORD=admin123       # Password for basic authentication

# Rate Limiting Security
CLI_RATE_LIMIT_MAX=10        # Max CLI operations per 15min window
API_RATE_LIMIT_MAX=100       # Max API requests per 15min window  
AUTH_RATE_LIMIT_MAX=5        # Max auth attempts per 15min window

# OpenID Connect SSO (Optional)
ENABLE_OIDC=false            # Enable OIDC SSO authentication
OIDC_ISSUER=                 # OIDC provider URL
OIDC_CLIENT_ID=              # OIDC client ID
OIDC_CLIENT_SECRET=          # OIDC client secret
```

### Advanced Configuration

For complete configuration options including rate limiting windows, SSL domains, and OIDC scopes, see the `.env.example` file or [DOCKER.md](DOCKER.md).

## 📚 Usage

### Getting Started

1. **Access**: Navigate to `http://localhost:3000`
2. **Login**: Use configured credentials (default: admin/admin)
3. **Generate**: Enter domains (one per line) and select format
4. **Download**: Get certificates in PEM, CRT, or PFX format
5. **Manage**: View, archive, or restore certificates

### API Usage

```bash
# Generate certificate
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"domains":["localhost","127.0.0.1"],"format":"pem"}'

# Download bundle
wget http://localhost:3000/api/download/bundle/folder/certname -O bundle.zip
```

## 🔒 Security Features

- **Rate Limiting**: Comprehensive protection against abuse
  - CLI Operations: 10 per 15 minutes
  - API Requests: 100 per 15 minutes
  - Auth Attempts: 5 per 15 minutes
- **Command Injection Protection**: Validated shell execution
- **Enterprise SSO**: OpenID Connect integration
- **HTTPS Support**: Auto-generated trusted certificates

## � Support

- 🐛 **Issues**: [GitHub Issues](https://github.com/jeffcaldwellca/mkcertWeb/issues)
- 📖 **Documentation**: Complete docs in [DOCKER.md](DOCKER.md)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/jeffcaldwellca/mkcertWeb/discussions)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
└── 2025-01-20/                     # Date-based organization
    ├── 2025-01-20T10-30-45_localhost/
    │   ├── localhost.pem
    │   ├── localhost-key.pem
    │   └── localhost.pfx           # Generated on-demand
    └── 2025-01-20T14-15-20_example/
        ├── example.crt
        └── example.key
```

### 🔧 Certificate Management

- **📋 View Details**: Domain coverage, expiry dates, file sizes
- **⬇️ Download**: Individual files, ZIP bundles, or PFX format  
- **🔑 PFX Generation**: Create password-protected PKCS#12 files on-demand
- **🗑️ Delete**: Remove certificates (root certificates are protected)
- **📊 System Status**: View Root CA information and installation status

### 🌐 Advanced Usage

For production deployments, reverse proxy configurations, and advanced Docker setups, see [DOCKER.md](DOCKER.md).

## 🔗 API Reference

The application provides REST API endpoints for programmatic access. When authentication is enabled, establish a session first via `POST /login`.

### Key Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/status` | System status and mkcert installation |
| `POST` | `/api/generate` | Generate new certificates |
| `GET` | `/api/certificates` | List all certificates |
| `GET` | `/api/download/bundle/:folder/:certname` | Download certificate bundle |
| `POST` | `/api/generate/pfx/*` | Generate PFX file on-demand |

Example certificate generation:
```bash
# Generate certificate via API
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"domains":["localhost","127.0.0.1"],"format":"pem"}'
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Commit changes: `git commit -am 'Add new feature'`
4. Push to branch: `git push origin feature/new-feature`
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [mkcert](https://github.com/FiloSottile/mkcert) - Simple tool for making locally-trusted development certificates
- [Express.js](https://expressjs.com/) - Web application framework
- [Node.js](https://nodejs.org/) - JavaScript runtime

## 📞 Support

- 🐛 **Issues**: [GitHub Issues](https://github.com/jeffcaldwellca/mkcertWeb/issues)
- 📖 **Documentation**: [README.md](README.md) and [DOCKER.md](DOCKER.md)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/jeffcaldwellca/mkcertWeb/discussions)
4. Push to branch: `git push origin feature/new-feature`
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [mkcert](https://github.com/FiloSottile/mkcert) - Simple tool for making locally-trusted development certificates
- [Express.js](https://expressjs.com/) - Web application framework
- [Node.js](https://nodejs.org/) - JavaScript runtime

## 📞 Support

- 🐛 **Issues**: [GitHub Issues](https://github.com/jeffcaldwellca/mkcertWeb/issues)
- 📖 **Documentation**: [README.md](README.md) and [DOCKER.md](DOCKER.md)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/jeffcaldwellca/mkcertWeb/discussions)
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

## Security & Best Practices

### Security Model
- **Development Focus**: Designed for local development environments
- **Flexible Authentication**: Basic authentication and enterprise SSO with OpenID Connect
- **Enterprise SSO**: Secure OIDC integration with proper token validation and session management
- **Rate Limiting Protection**: Built-in protection against CLI command abuse and automated attacks
  - **CLI Operations**: Limited to 10 operations per 15-minute window (certificate generation, CA management)
  - **API Requests**: Limited to 100 requests per 15-minute window (general API endpoints)
  - **Per-User Limiting**: Rate limits applied per IP address and authenticated user
  - **Configurable Limits**: All rate limits can be adjusted via environment variables
- **Regular User Execution**: Runs without root privileges (except for `mkcert -install`)
- **Read-Only Protection**: Root directory certificates cannot be deleted
- **Session Security**: HTTP-only cookies with CSRF protection and secure OIDC flows
- **Organized Storage**: Timestamp-based folders prevent conflicts
- **Provider Security**: OIDC callback validation and secure provider configuration

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
- Authentication testing (both basic and OIDC)
- API endpoint validation
- Security testing
- OIDC SSO integration testing
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
