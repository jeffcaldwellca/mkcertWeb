# Docker Usage Guide

This document provides comprehensive instructions for running mkcert Web UI using Docker.

## Quick Start

### Recommended Method: Docker Compose

The repository includes a pre-configured `docker-compose.yml` file for easy deployment:

```bash
# Clone the repository
git clone https://github.com/jeffcaldwellca/mkcertWeb.git
cd mkcertWeb

# Start the application using the included docker-compose.yml
docker-compose up -d
```

That's it! The application will be available at:
- **HTTP**: http://localhost:3000
- **HTTPS**: http://localhost:3443 (if enabled)

### Alternative: Manual Docker Run

If you prefer to run Docker commands manually:

```bash
# Clone the repository
git clone https://github.com/jeffcaldwellca/mkcertWeb.git
cd mkcertWeb

# Build the image
docker build -t mkcert-web-ui .

# Run the application
docker run -d \
  --name mkcert-web-ui \
  -p 3000:3000 \
  -v mkcert_certificates:/app/certificates \
  -v mkcert_data:/app/data \
  mkcert-web-ui
```

## Configuration Options

The included `docker-compose.yml` file provides sensible defaults and can be customized for your needs.

### Using the Included Docker Compose File

#### Default Configuration
The included configuration provides:
- HTTP server on port 3000
- HTTPS server on port 3443 (disabled by default)
- Dark theme as default
- Authentication disabled (for easy development)
- Persistent volumes for certificates and data
- Automatic restart on failure
- Health monitoring

#### Customizing Environment Variables

You can override any environment variable by creating a `.env` file in the repository root:

```bash
# Create a .env file to customize settings
cat > .env << EOF
ENABLE_AUTH=true
AUTH_USERNAME=myuser
AUTH_PASSWORD=mysecurepassword
DEFAULT_THEME=light
ENABLE_HTTPS=true
SSL_DOMAIN=myapp.local
EOF

# Start with custom configuration
docker-compose up -d
```

#### Direct Environment Variable Override

You can also override environment variables directly:

```bash
# Override specific settings
ENABLE_AUTH=true AUTH_USERNAME=admin docker-compose up -d
```

### Manual Docker Run Examples

If you prefer not to use the included docker-compose.yml file:

#### Basic Configuration
```bash
docker run -d \
  --name mkcert-web-ui \
  -p 3000:3000 \
  -e "DEFAULT_THEME=light" \
  -e "NODE_ENV=production" \
  -v mkcert_certificates:/app/certificates \
  mkcert-web-ui
```

#### With Authentication
```bash
docker run -d \
  --name mkcert-web-ui \
  -p 3000:3000 \
  -e "ENABLE_AUTH=true" \
  -e "AUTH_USERNAME=myuser" \
  -e "AUTH_PASSWORD=mysecurepassword" \
  -e "SESSION_SECRET=your-very-long-random-secret-key" \
  -v mkcert_certificates:/app/certificates \
  mkcert-web-ui
```

#### With HTTPS
```bash
docker run -d \
  --name mkcert-web-ui \
  -p 3000:3000 \
  -p 3443:3443 \
  -e "ENABLE_HTTPS=true" \
  -e "SSL_DOMAIN=your-domain.com" \
  -v mkcert_certificates:/app/certificates \
  mkcert-web-ui
```

### Available Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `HTTPS_PORT` | `3443` | HTTPS server port |
| `ENABLE_HTTPS` | `false` | Enable HTTPS server |
| `SSL_DOMAIN` | `localhost` | Domain name for SSL certificate |
| `FORCE_HTTPS` | `false` | Redirect HTTP to HTTPS |
| `NODE_ENV` | `production` | Environment mode |
| `DEFAULT_THEME` | `dark` | Default theme (dark/light) |
| `ENABLE_AUTH` | `false` | Enable user authentication |
| `AUTH_USERNAME` | `admin` | Username for authentication |
| `AUTH_PASSWORD` | `admin` | Password for authentication |
| `SESSION_SECRET` | `mkcert-web-ui-secret-key-change-in-production` | Session secret |

## Docker Compose Management

### Basic Commands

```bash
# Start the application
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the application
docker-compose down

# Restart the application
docker-compose restart

# Update and rebuild
docker-compose down
docker-compose up -d --build

# View status
docker-compose ps
```

### Data Persistence

The included docker-compose.yml automatically creates and manages:
- **mkcert_certificates**: Stores all generated SSL certificates
- **mkcert_data**: Stores application data and configuration

```bash
# View volume information
docker volume ls | grep mkcert

# Backup certificates
docker run --rm -v mkcert_certificates:/data -v $(pwd):/backup alpine tar czf /backup/certificates-backup.tar.gz -C /data .

# Restore certificates
docker run --rm -v mkcert_certificates:/data -v $(pwd):/backup alpine tar xzf /backup/certificates-backup.tar.gz -C /data
```

## Production Deployment

### Using Docker Compose for Production

The included docker-compose.yml can be easily configured for production:

```bash
# Create a production .env file
cat > .env << EOF
NODE_ENV=production
ENABLE_HTTPS=true
FORCE_HTTPS=true
SSL_DOMAIN=your-domain.com
ENABLE_AUTH=true
AUTH_USERNAME=yourusername
AUTH_PASSWORD=yoursecurepassword
SESSION_SECRET=$(openssl rand -base64 32)
DEFAULT_THEME=light
EOF

# Deploy to production
docker-compose up -d
```

### Production Checklist

- ✅ Set strong `AUTH_USERNAME` and `AUTH_PASSWORD`
- ✅ Generate secure `SESSION_SECRET`
- ✅ Enable HTTPS with your domain
- ✅ Configure proper SSL_DOMAIN
- ✅ Set NODE_ENV=production
- ✅ Enable authentication
- ✅ Configure reverse proxy if needed

## Building and Running

### Using the Included Docker Compose (Recommended)

The repository includes everything needed:

```bash
git clone https://github.com/jeffcaldwellca/mkcertWeb.git
cd mkcertWeb
docker-compose up -d
```

### Manual Build Process

If you need to build manually:

```bash
# Clone the repository
git clone https://github.com/jeffcaldwellca/mkcertWeb.git
cd mkcertWeb

# Build the image
docker build -t mkcert-web-ui .

# Run your build
docker run -d \
  --name mkcert-web-ui \
  -p 3000:3000 \
  -v mkcert_certificates:/app/certificates \
  mkcert-web-ui
```

## Troubleshooting

### Docker Compose Commands

```bash
# Check container status
docker-compose ps

# View application logs
docker-compose logs -f mkcert-web-ui

# Access container shell
docker-compose exec mkcert-web-ui /bin/sh

# Restart the service
docker-compose restart mkcert-web-ui

# Stop and remove everything
docker-compose down
```

### Manual Docker Commands

```bash
# Check container logs
docker logs mkcert-web-ui

# Access container shell
docker exec -it mkcert-web-ui /bin/sh
```

### Health Check
The included docker-compose.yml has health monitoring built-in:
```bash
# Check health status
docker-compose ps

# View detailed health information
docker inspect mkcertWeb_mkcert-web-ui_1 | grep -A 5 Health
```

### Port Conflicts
If port 3000 is already in use, modify the docker-compose.yml or use environment override:
```bash
# Edit docker-compose.yml ports section, or:
# Override ports with environment variable
PORT=8080 docker-compose up -d

# Or edit the docker-compose.yml file to change:
# ports:
#   - "8080:3000"    # HTTP port
```

For manual docker run:
```bash
docker run -d \
  --name mkcert-web-ui \
  -p 8080:3000 \
  mkcert-web-ui
```

### Persistence Issues
The docker-compose.yml automatically handles volume persistence. To verify:
```bash
# Check volume mounts
docker-compose config

# List volumes
docker volume ls | grep mkcert

# Inspect volume details
docker volume inspect mkcertWeb_mkcert_certificates
docker volume inspect mkcertWeb_mkcert_data
```

### Missing Dependencies
The Docker image includes all required dependencies:
- **mkcert**: Pre-installed for certificate generation
- **OpenSSL**: Included for certificate analysis and operations
- **Node.js**: Runtime environment
- **Alpine Linux**: Minimal base image

If you encounter issues, verify the container has the required tools:
```bash
# Check mkcert (using docker-compose)
docker-compose exec mkcert-web-ui mkcert -help

# Check OpenSSL (using docker-compose)
docker-compose exec mkcert-web-ui openssl version

# For manual docker run:
docker exec mkcert-web-ui mkcert -help
docker exec mkcert-web-ui openssl version
```

## Security Considerations

1. **Change Default Credentials**: Always change `AUTH_USERNAME` and `AUTH_PASSWORD` in production
2. **Session Secret**: Use a strong, randomly generated `SESSION_SECRET`
3. **HTTPS**: Enable HTTPS for production deployments
4. **Network**: Consider using Docker networks for isolation
5. **Updates**: Regularly update the container image for security patches

## Examples

### Quick Development Setup
```bash
git clone https://github.com/jeffcaldwellca/mkcertWeb.git
cd mkcertWeb
docker-compose up -d
```

### Production Setup with Authentication
```bash
git clone https://github.com/jeffcaldwellca/mkcertWeb.git
cd mkcertWeb

# Create production configuration
cat > .env << EOF
ENABLE_AUTH=true
AUTH_USERNAME=admin
AUTH_PASSWORD=$(openssl rand -base64 12)
SESSION_SECRET=$(openssl rand -base64 32)
DEFAULT_THEME=light
NODE_ENV=production
EOF

docker-compose up -d
```

### Development with Custom Theme
```bash
# Override just the theme
DEFAULT_THEME=light docker-compose up -d
```

### Reverse Proxy Setup (nginx)
```bash
# For use with nginx-proxy, modify docker-compose.yml or create override:
version: '3.8'
services:
  mkcert-web-ui:
    extends:
      file: docker-compose.yml
      service: mkcert-web-ui
    networks:
      - nginx-proxy
    environment:
      - VIRTUAL_HOST=certs.yourdomain.com
      - LETSENCRYPT_HOST=certs.yourdomain.com

networks:
  nginx-proxy:
    external: true
```

For more information, see the main [README.md](README.md) file.
