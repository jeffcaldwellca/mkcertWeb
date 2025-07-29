# Docker Usage Guide

This document provides comprehensive instructions for running mkcert Web UI using Docker.

## Quick Start

### Option 1: Docker Run (Simple)

Run the application with default settings:

```bash
docker run -d \
  --name mkcert-web-ui \
  -p 3000:3000 \
  -v mkcert_certificates:/app/certificates \
  -v mkcert_data:/app/data \
  jeffcaldwellca/mkcert-web-ui:latest
```

### Option 2: Docker Compose (Recommended)

1. Download the docker-compose.yml file:
```bash
wget https://raw.githubusercontent.com/jeffcaldwellca/mkcertWeb/main/docker-compose.yml
```

2. Start the application:
```bash
docker-compose up -d
```

## Configuration Options

### Environment Variables

You can customize the application behavior using environment variables:

#### Basic Configuration
```bash
docker run -d \
  --name mkcert-web-ui \
  -p 3000:3000 \
  -e "DEFAULT_THEME=light" \
  -e "NODE_ENV=production" \
  -v mkcert_certificates:/app/certificates \
  jeffcaldwellca/mkcert-web-ui:latest
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
  jeffcaldwellca/mkcert-web-ui:latest
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
  jeffcaldwellca/mkcert-web-ui:latest
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

## Volume Mounts

### Required Volumes

- **Certificates**: `/app/certificates` - Stores generated SSL certificates
- **Data**: `/app/data` - Stores application data and configuration

### Example with Custom Directories
```bash
docker run -d \
  --name mkcert-web-ui \
  -p 3000:3000 \
  -v /host/path/to/certificates:/app/certificates \
  -v /host/path/to/data:/app/data \
  jeffcaldwellca/mkcert-web-ui:latest
```

## Production Deployment

### Recommended Production Setup

```bash
docker run -d \
  --name mkcert-web-ui \
  --restart unless-stopped \
  -p 3000:3000 \
  -p 3443:3443 \
  -e "NODE_ENV=production" \
  -e "ENABLE_HTTPS=true" \
  -e "FORCE_HTTPS=true" \
  -e "SSL_DOMAIN=your-domain.com" \
  -e "ENABLE_AUTH=true" \
  -e "AUTH_USERNAME=yourusername" \
  -e "AUTH_PASSWORD=yoursecurepassword" \
  -e "SESSION_SECRET=$(openssl rand -base64 32)" \
  -e "DEFAULT_THEME=light" \
  -v mkcert_certificates:/app/certificates \
  -v mkcert_data:/app/data \
  jeffcaldwellca/mkcert-web-ui:latest
```

### Using Docker Compose for Production

Create a `.env` file:
```bash
# Production Configuration
NODE_ENV=production
ENABLE_HTTPS=true
FORCE_HTTPS=true
SSL_DOMAIN=your-domain.com

# Authentication
ENABLE_AUTH=true
AUTH_USERNAME=yourusername
AUTH_PASSWORD=yoursecurepassword
SESSION_SECRET=your-very-long-random-secret-key

# Theme
DEFAULT_THEME=light
```

Then run:
```bash
docker-compose --env-file .env up -d
```

## Building from Source

If you want to build the Docker image yourself:

```bash
# Clone the repository
git clone https://github.com/jeffcaldwellca/mkcertWeb.git
cd mkcertWeb

# Build the image
docker build -t mkcert-web-ui .

# Run your custom build
docker run -d \
  --name mkcert-web-ui \
  -p 3000:3000 \
  -v mkcert_certificates:/app/certificates \
  mkcert-web-ui
```

## Troubleshooting

### Check Container Logs
```bash
docker logs mkcert-web-ui
```

### Access Container Shell
```bash
docker exec -it mkcert-web-ui /bin/sh
```

### Health Check
The container includes a health check that verifies the application is responding:
```bash
docker inspect --format='{{.State.Health.Status}}' mkcert-web-ui
```

### Port Conflicts
If port 3000 is already in use:
```bash
docker run -d \
  --name mkcert-web-ui \
  -p 8080:3000 \
  jeffcaldwellca/mkcert-web-ui:latest
```

### Persistence Issues
Ensure volumes are properly mounted to persist certificates and data:
```bash
# Check volume mounts
docker inspect mkcert-web-ui | grep -A 10 "Mounts"

# List volumes
docker volume ls | grep mkcert
```

## Security Considerations

1. **Change Default Credentials**: Always change `AUTH_USERNAME` and `AUTH_PASSWORD` in production
2. **Session Secret**: Use a strong, randomly generated `SESSION_SECRET`
3. **HTTPS**: Enable HTTPS for production deployments
4. **Network**: Consider using Docker networks for isolation
5. **Updates**: Regularly update the container image for security patches

## Examples

### Development Setup
```bash
docker run -d \
  --name mkcert-web-ui-dev \
  -p 3000:3000 \
  -e "NODE_ENV=development" \
  -e "DEFAULT_THEME=dark" \
  -v mkcert_certificates:/app/certificates \
  jeffcaldwellca/mkcert-web-ui:latest
```

### Reverse Proxy Setup (nginx)
```bash
docker run -d \
  --name mkcert-web-ui \
  --network nginx-proxy \
  -e "VIRTUAL_HOST=certs.yourdomain.com" \
  -e "LETSENCRYPT_HOST=certs.yourdomain.com" \
  -v mkcert_certificates:/app/certificates \
  jeffcaldwellca/mkcert-web-ui:latest
```

For more information, see the main [README.md](README.md) file.
