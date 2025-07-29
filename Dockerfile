# Use Node.js 18 LTS Alpine for smaller image size
FROM node:18-alpine

# Install mkcert and other required tools
RUN apk add --no-cache \
    ca-certificates \
    wget \
    && wget -O /usr/local/bin/mkcert https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v1.4.4-linux-amd64 \
    && chmod +x /usr/local/bin/mkcert

# Create app directory
WORKDIR /app

# Create a non-root user for security
RUN addgroup -g 1001 -S nodejs \
    && adduser -S nodejs -u 1001

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY . .

# Create necessary directories with proper permissions
RUN mkdir -p /app/certificates /app/data \
    && chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose ports
EXPOSE 3000 3443

# Set default environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HTTPS_PORT=3443
ENV ENABLE_HTTPS=false
ENV SSL_DOMAIN=localhost
ENV FORCE_HTTPS=false
ENV DEFAULT_THEME=dark
ENV ENABLE_AUTH=false
ENV AUTH_USERNAME=admin
ENV AUTH_PASSWORD=admin
ENV SESSION_SECRET=mkcert-web-ui-secret-key-change-in-production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

# Start the application
CMD ["npm", "start"]
