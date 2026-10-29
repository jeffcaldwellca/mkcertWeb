# Docker Usage Guide

Comprehensive instructions for running mkcert Web UI using Docker.

## Docker Hub
[https://hub.docker.com/r/jeffcaldwellca/mkcertweb](https://hub.docker.com/r/jeffcaldwellca/mkcertweb)

## Quick Start

```bash
git clone https://github.com/jeffcaldwellca/mkcertWeb.git
cd mkcertWeb
docker-compose up -d
```

Access the application:
- **HTTP**: http://localhost:3000
- **HTTPS**: https://localhost:3443 (if enabled)

## Manual Docker Run

```bash
# Build and run
docker build -t mkcert-web-ui .
docker run -d \
  --name mkcert-web-ui \
  -p 3000:3000 \
  -v mkcert_certificates:/app/certificates \
  -v mkcert_data:/app/data \
  -v mkcert_config:/app/config \
  -v mkcert_ca:/home/nodejs/.local/share/mkcert \
  mkcert-web-ui
```

> **Persistence:** all four volumes matter. `/app/config` holds settings
> saved from the web UI (webhook/notification config, theme, ...) and
> `/home/nodejs/.local/share/mkcert` holds the root CA — without them,
> both are lost every time the container is recreated.

## Running as a Custom UID

The image runs as `nodejs` (UID/GID 1001) by default. To run it as another
user (e.g. `user: "2000:2000"` in compose, or `--user 2000:2000`), bind-mount
all four data directories from host paths owned by that UID — the
directories baked into the image belong to UID 1001 and aren't writable by
anyone else:

```yaml
services:
  mkcert-web-ui:
    image: jeffcaldwellca/mkcertweb:latest
    user: "2000:2000"
    volumes:
      - /etc/mkcert/certificates:/app/certificates
      - /etc/mkcert/data:/app/data
      - /etc/mkcert/config:/app/config
      - /etc/mkcert/ca:/home/nodejs/.local/share/mkcert
```

```bash
sudo mkdir -p /etc/mkcert/{certificates,data,config,ca}
sudo chown -R 2000:2000 /etc/mkcert
```

The image sets `CAROOT=/home/nodejs/.local/share/mkcert`, so mkcert finds the
CA directory regardless of `HOME`. (Before v4.4.3, a UID with no passwd
entry got `HOME=/` and CA generation failed with a permission error; the
workaround was to set `HOME=/home/nodejs`.)

## Configuration

### Using .env File

```bash
cat > .env << EOF
ENABLE_AUTH=true
AUTH_USERNAME=myuser
AUTH_PASSWORD=mysecurepassword
THEME_MODE=light
ENABLE_HTTPS=true
SSL_DOMAIN=myapp.local
EOF

docker-compose up -d
```

### Direct Override

```bash
ENABLE_AUTH=true AUTH_USERNAME=admin docker-compose up -d
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `HTTPS_PORT` | `3443` | HTTPS server port |
| `ENABLE_HTTPS` | `false` | Enable HTTPS server |
| `SSL_DOMAIN` | `localhost` | Domain for SSL certificate |
| `FORCE_HTTPS` | `false` | Redirect HTTP to HTTPS |
| `NODE_ENV` | `production` | Environment mode |
| `THEME_MODE` | `dark` | UI theme (dark/light) |
| `ENABLE_AUTH` | `false` | Enable authentication |
| `AUTH_USERNAME` | `admin` | Username |
| `AUTH_PASSWORD` | `admin` | Password |
| `SESSION_SECRET` | auto-generated | Session secret |

### Notification Variables

Certificate-expiry notifications can be configured entirely via environment
variables (or from the Settings UI — explicitly-set env vars win):

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBHOOK_ENABLED` | `false` | Enable generic HTTP webhook notifications |
| `WEBHOOK_URL` | — | Webhook target URL (custom headers: Settings UI only) |
| `NTFY_ENABLED` | `false` | Enable ntfy push notifications |
| `NTFY_URL` | `https://ntfy.sh` | ntfy server URL |
| `NTFY_TOPIC` | — | ntfy topic |
| `NTFY_TOKEN` | — | ntfy access token (or `NTFY_USERNAME`/`NTFY_PASSWORD`) |
| `EMAIL_NOTIFICATIONS_ENABLED` | `false` | Enable email notifications |
| `CERT_MONITORING_ENABLED` | `false` | Enable the expiry monitoring schedule |
| `CERT_CHECK_INTERVAL` | `0 8 * * *` | Cron schedule for expiry checks |
| `CERT_WARNING_DAYS` | `30` | Days before expiry to warn |
| `CERT_CRITICAL_DAYS` | `7` | Days before expiry for critical alerts |

See [EMAIL_MONITORING_GUIDE.md](EMAIL_MONITORING_GUIDE.md) for the full list
of SMTP variables.

## Management

### Basic Commands

```bash
docker-compose up -d          # Start
docker-compose logs -f        # View logs
docker-compose down           # Stop
docker-compose restart        # Restart
docker-compose up -d --build  # Rebuild
docker-compose ps             # Status
```

### Data Backup & Restore

```bash
# Backup
docker run --rm -v mkcert_certificates:/data -v $(pwd):/backup alpine \
  tar czf /backup/certificates-backup.tar.gz -C /data .

# Restore
docker run --rm -v mkcert_certificates:/data -v $(pwd):/backup alpine \
  tar xzf /backup/certificates-backup.tar.gz -C /data

# Same pattern for the other volumes: mkcert_data, mkcert_config
# (UI-saved settings), and mkcert_ca (root CA)
```

## Production Deployment

```bash
# Create production .env file
cat > .env << EOF
NODE_ENV=production
ENABLE_HTTPS=true
FORCE_HTTPS=true
SSL_DOMAIN=your-domain.com
ENABLE_AUTH=true
AUTH_USERNAME=yourusername
AUTH_PASSWORD=yoursecurepassword
SESSION_SECRET=$(openssl rand -base64 32)
EOF

docker-compose up -d
```

### Production Checklist

- ✅ Set strong credentials
- ✅ Generate secure `SESSION_SECRET`
- ✅ Enable HTTPS with valid domain
- ✅ Set `NODE_ENV=production`
- ✅ Enable authentication
- ✅ Configure reverse proxy if needed
- ✅ Regular container updates

## Troubleshooting

```bash
# View logs
docker-compose logs -f

# Access container shell
docker-compose exec mkcert-web-ui /bin/sh

# Check health
docker-compose ps

# Verify dependencies
docker-compose exec mkcert-web-ui mkcert -help
docker-compose exec mkcert-web-ui openssl version
```

### Port Conflicts

```bash
# Edit docker-compose.yml ports or use:
PORT=8080 docker-compose up -d
```

### Volume Issues

```bash
# Check volumes
docker volume ls | grep mkcert
docker volume inspect mkcertWeb_mkcert_certificates
```

## Security

### Built-in Features
- Command injection protection
- Path traversal prevention  
- Multi-tier rate limiting
- Input validation
- Secure headers

### Production Security
1. Change default credentials
2. Use strong `SESSION_SECRET`
3. Enable HTTPS
4. Enable authentication
5. Regular container updates
6. Consider reverse proxy (nginx)

## Examples

### Quick Dev Setup
```bash
git clone https://github.com/jeffcaldwellca/mkcertWeb.git
cd mkcertWeb
docker-compose up -d
```

### Nginx Reverse Proxy
```yaml
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

For more information, see [README.md](../README.md).
