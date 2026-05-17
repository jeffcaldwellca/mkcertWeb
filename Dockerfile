# Use Node.js 20 LTS Alpine for smaller image size
FROM node:20-alpine

# Pin mkcert to a known good release. mkcert hasn't published since 2022, so
# v1.4.4 is the only released version anyway, but pinning makes the build
# reproducible if a v1.5.0 lands.
ARG MKCERT_VERSION=v1.4.4

# Install mkcert and other required tools
RUN apk add --no-cache \
    ca-certificates \
    openssl \
    wget \
    && ARCH=$(uname -m) \
    && if [ "$ARCH" = "x86_64" ]; then MKCERT_ARCH="amd64"; elif [ "$ARCH" = "aarch64" ]; then MKCERT_ARCH="arm64"; else echo "Unsupported architecture: $ARCH" && exit 1; fi \
    && wget -O /usr/local/bin/mkcert "https://github.com/FiloSottile/mkcert/releases/download/${MKCERT_VERSION}/mkcert-${MKCERT_VERSION}-linux-${MKCERT_ARCH}" \
    && chmod +x /usr/local/bin/mkcert

# Create app directory
WORKDIR /app

# Create a non-root user for security
RUN addgroup -g 1001 -S nodejs \
    && adduser -S nodejs -u 1001

# SECURITY: do NOT pre-generate the CA inside the image. Doing so would bake
# the same rootCA-key.pem into every pulled image — meaning every operator
# who runs this image shares an attacker-knowable private key. Anyone who
# pulls the public image could extract the key and forge certs accepted by
# any user who installed this CA. Instead, the CA is generated per-container
# on first run (via POST /api/generate-ca or the host operator running
# `mkcert -install` once inside the running container).

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy application code (.dockerignore prevents .env, .git, node_modules, etc.
# from leaking into image layers)
COPY . .

# Create the runtime directory tree owned by the unprivileged user. The
# /home/nodejs/.local/share/mkcert path is where mkcert stores rootCA{,key}.pem;
# operators should mount a volume here to persist the CA across container
# restarts (see docker-compose.yml).
RUN mkdir -p /app/certificates /app/data /app/config \
    && mkdir -p /home/nodejs/.local/share/mkcert \
    && chown -R nodejs:nodejs /app /home/nodejs/.local

# Switch to non-root user
USER nodejs

# Expose ports
EXPOSE 3000 3443

# Set default environment variables.
# SECURITY: do not bake in credentials or session secrets. The app will:
#  - mint a per-process random SESSION_SECRET if none is provided
#  - generate (and log) a random AUTH_PASSWORD if ENABLE_AUTH=true and the
#    password is unset or still "admin"
# Operators should set AUTH_PASSWORD/AUTH_PASSWORD_HASH and SESSION_SECRET
# explicitly for production use.
ENV NODE_ENV=production
ENV PORT=3000
ENV HTTPS_PORT=3443
ENV ENABLE_HTTPS=false
ENV SSL_DOMAIN=localhost
ENV FORCE_HTTPS=false
ENV THEME_MODE=dark
ENV ENABLE_AUTH=false
ENV AUTH_USERNAME=admin

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

# Start the application
CMD ["npm", "start"]
