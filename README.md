# mkcert Web UI

A secure, modern web interface for managing SSL certificates using the mkcert CLI tool. Generate, download, and manage local development certificates with enterprise-grade security and an intuitive web interface.

## ✨ Key Features

- **🔐 SSL Certificate Generation**: Create certificates for multiple domains and IP addresses
- **🛡️ Enterprise Security**: Command injection protection, path traversal prevention, and comprehensive rate limiting
- **📋 Multiple Formats**: Generate PEM, CRT, and PFX (PKCS#12) certificates
- **🔒 Flexible Authentication**: Basic auth and enterprise SSO with OpenID Connect
- **📧 Email Notifications**: Automated SMTP alerts for expiring certificates
- **📊 Certificate Monitoring**: Automatic monitoring with configurable warning periods
- **🏗️ Modular Architecture**: Clean, maintainable codebase with utility-based design
- **🌐 HTTPS Support**: Auto-generated SSL certificates for secure access
- **📊 Certificate Management**: View, download, archive, and restore certificates
- **🎨 Modern UI**: Dark/light themes with responsive design
- **🐳 Docker Ready**: Complete containerization with docker-compose
- **📈 Monitoring Ready**: Standardized logging and structured API responses

## 📷 Screenshots

![mkcert Web UI Interface](public/assets/screenshot.png)

*Modern web interface showing certificate generation and management features*

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

# OpenID Connect SSO (Optional)
ENABLE_OIDC=false            # Enable OIDC SSO authentication
OIDC_ISSUER=                 # OIDC provider URL
OIDC_CLIENT_ID=              # OIDC client ID
OIDC_CLIENT_SECRET=          # OIDC client secret

# Email Notifications
EMAIL_NOTIFICATIONS_ENABLED=true
SMTP_HOST=smtp.gmail.com                # Your SMTP server
SMTP_PORT=587                           # SMTP port (587 for TLS, 465 for SSL)
SMTP_SECURE=false                       # Use SSL (true for port 465)
SMTP_USER=your-email@domain.com         # SMTP username
SMTP_PASSWORD=your-app-password         # SMTP password
EMAIL_FROM=mkcert@yourcompany.com       # From address for notifications
EMAIL_TO=admin@company.com,ops@company.com  # Comma-separated recipients

# Certificate Monitoring
CERT_MONITORING_ENABLED=true
CERT_CHECK_INTERVAL=0 8 * * *           # Cron schedule (daily at 8 AM)
CERT_WARNING_DAYS=30                    # Days before expiry to send warnings
CERT_CRITICAL_DAYS=7                    # Days before expiry for critical alerts
```

### Supported Email Providers

**Gmail:**
```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
# Note: Use App Passwords instead of your regular password
```

**Outlook/Office 365:**
```bash
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_SECURE=false
```

**Corporate Exchange:**
```bash
SMTP_HOST=mail.yourcompany.com
SMTP_PORT=587
SMTP_SECURE=false
```

For complete configuration options including rate limiting and advanced settings, see the `.env.example` file.

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
curl -X POST http://localhost:3000/api/execute \
  -H "Content-Type: application/json" \
  -d '{"command":"generate","input":"localhost example.com"}'

# List certificates
curl http://localhost:3000/api/certificates

# Download certificate file
wget http://localhost:3000/download/localhost.pem -O localhost.pem

# Email and monitoring API endpoints
curl http://localhost:3000/api/email/status
curl http://localhost:3000/api/monitoring/status
curl http://localhost:3000/api/monitoring/expiring
```

## 🔒 Security Features

### Enterprise-Grade Security
- **🛡️ Command Injection Protection**: Strict allowlist-based command validation prevents malicious shell injection
- **🔐 Path Traversal Prevention**: Comprehensive file access validation prevents directory traversal attacks
- **📝 Input Sanitization**: All user inputs validated and sanitized before processing
- **🚫 Filename Validation**: Prevents malicious filename patterns and null byte attacks

### Multi-Tier Rate Limiting
- **CLI Operations**: 10 per 15 minutes (prevents command abuse)
- **API Requests**: 100 per 15 minutes (prevents API flooding)  
- **Authentication**: 5 attempts per 15 minutes (prevents brute force)
- **General Access**: 200 requests per 15 minutes (overall protection)

### Additional Security
- **🔑 Enterprise SSO**: OpenID Connect integration with role-based access
- **🌐 HTTPS Support**: Auto-generated trusted certificates with secure headers
- **📊 Audit Logging**: Comprehensive logging of security events and blocked attempts
- **🔄 Auto-Recovery**: Graceful error handling prevents service disruption

## 🔗 API Reference

### Key Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/status` | System status and mkcert installation |
| `POST` | `/api/generate` | Generate new certificates |
| `GET` | `/api/certificates` | List all certificates |
| `GET` | `/download/:filename` | Download certificate files |
| `GET` | `/api/email/status` | Email configuration status |
| `POST` | `/api/email/test` | Send test email |
| `GET` | `/api/monitoring/status` | Certificate monitoring status |
| `GET` | `/api/monitoring/expiring` | List expiring certificates |

### Example Certificate Generation
```bash
curl -X POST http://localhost:3000/api/generate 
  -H "Content-Type: application/json" 
  -d '{"domains":["localhost","127.0.0.1"],"format":"pem"}'
```

## 📁 Project Structure

```
mkcertWeb/
├── server.js                 # Main application entry point
├── package.json             # Dependencies and scripts  
├── src/                     # Modular application source
│   ├── config/             # Configuration management
│   ├── security/           # Security utilities
│   ├── middleware/         # Express middleware
│   ├── routes/             # Route handlers
│   ├── services/           # Email and monitoring services
│   └── utils/              # Utility functions
├── public/                  # Frontend static assets
├── certificates/            # Certificate storage
├── .env.example            # Environment configuration template
└── DOCKER.md               # Docker deployment guide
```
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
## 🛠️ Development

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
```

### Authentication Setup

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

3. **Start the server and access at http://localhost:3000**

**Security Notes:**
- When `ENABLE_AUTH=false`, authentication is completely disabled
- When `ENABLE_AUTH=true`, all API routes are protected and require valid session authentication
- Always use a strong, unique `SESSION_SECRET` in production environments
- Consider using HTTPS when authentication is enabled for additional security

### Testing
See `TESTING.md` for comprehensive testing procedures including installation verification, certificate generation testing, authentication testing, API endpoint validation, and security testing.

## 🐛 Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| mkcert not found | `which mkcert && mkcert -version` |
| Permission Denied | `sudo chown -R $(whoami):$(whoami) certificates/` |
| Port Already in Use | `PORT=3001 npm start` |
| CA Installation Issues | `mkcert -install && ls -la $(mkcert -CAROOT)` |
| Browser Trust Issues | Clear cache, restart browser after CA installation |

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Install dependencies: `npm install`
4. Make changes and test thoroughly (see `TESTING.md`)
5. Commit changes: `git commit -am 'Add new feature'`
6. Push to branch: `git push origin feature/new-feature`
7. Submit a pull request

## 📞 Support

- 🐛 **Issues**: [GitHub Issues](https://github.com/jeffcaldwellca/mkcertWeb/issues)
- 📖 **Documentation**: [DOCKER.md](DOCKER.md) and [TESTING.md](TESTING.md)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/jeffcaldwellca/mkcertWeb/discussions)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [mkcert](https://github.com/FiloSottile/mkcert) - Simple tool for making locally-trusted development certificates
- [Express.js](https://expressjs.com/) - Web application framework
- [Node.js](https://nodejs.org/) - JavaScript runtime
