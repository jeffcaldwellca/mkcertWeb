# ── Dependency stage ──────────────────────────────────────────────────────────
# Runs on the BUILD host's native architecture so that npm ci never runs under
# QEMU emulation (which causes exit code 132 / SIGILL on cross-platform buildx
# runs).  node_modules are then copied into the final target-platform image.
FROM --platform=$BUILDPLATFORM node:24-alpine AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force \
    && tar -czf /tmp/deps.tar.gz node_modules

# ── mkcert stage ──────────────────────────────────────────────────────────────
# mkcert hasn't published a release since v1.4.4 (2022), and that prebuilt
# binary was compiled with Go 1.18 and 2022-era golang.org/x modules — over a
# hundred scanner findings, including the critical ones in issue #46. Rebuild
# the same tagged source with a current Go toolchain and bumped x/ modules.
# Cross-compiled on the build host (pure Go, CGO off), so no QEMU here either.
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS mkcert

ARG MKCERT_VERSION=v1.4.4
ARG TARGETOS
ARG TARGETARCH
ENV GOTOOLCHAIN=local CGO_ENABLED=0

RUN apk add --no-cache git
WORKDIR /src
RUN git clone --depth 1 --branch "${MKCERT_VERSION}" https://github.com/FiloSottile/mkcert.git . \
    && go get golang.org/x/crypto@v0.58.0 golang.org/x/net@v0.61.0 golang.org/x/text@v0.43.0 \
    && go mod tidy \
    && GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" \
       go build -trimpath -ldflags "-s -w -X main.Version=${MKCERT_VERSION}" -o /out/mkcert .

# ── Final image ───────────────────────────────────────────────────────────────
# Node.js 24 LTS (Node 20 reached end-of-life on 2026-04-30)
FROM node:24-alpine

# - apk upgrade pulls Alpine security fixes (e.g. openssl/libssl3) newer than
#   the base image snapshot.
# - wget stays: docker-compose.yml's healthcheck uses GNU wget flags that
#   busybox wget doesn't support.
# - npm/npx/corepack/yarn are removed: the app never needs them at runtime,
#   and npm's bundled deps (tar, cross-spawn, glob, sigstore, ...) were a
#   large share of the scanner findings.
RUN apk upgrade --no-cache \
    && apk add --no-cache \
    ca-certificates \
    openssl \
    wget \
    && rm -rf /usr/local/lib/node_modules \
              /usr/local/bin/npm /usr/local/bin/npx \
              /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg \
              /opt/yarn-*

COPY --from=mkcert /out/mkcert /usr/local/bin/mkcert

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

# Copy pre-built node_modules from the native deps stage (no QEMU involved).
# Packed as a tarball to avoid the dockerfile-language-server false positive
# that mis-parses `COPY --from=<stage> <dir>` as a multi-source COPY.
COPY --from=deps /tmp/deps.tar.gz /tmp/deps.tar.gz
RUN tar -xzf /tmp/deps.tar.gz && rm /tmp/deps.tar.gz

# Copy application code (.dockerignore prevents .env, .git, node_modules, etc.
# from leaking into image layers)
COPY . ./

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
# Pin mkcert's CA directory instead of deriving it from $HOME. When the
# container runs as a UID with no passwd entry (e.g. `user: "2000:2000"`),
# Docker sets HOME=/ and mkcert would try to create /.local/share/mkcert,
# failing with EACCES (issue #54). This is the path the mkcert_ca volume
# mounts, so it's unchanged for the default nodejs user.
ENV CAROOT=/home/nodejs/.local/share/mkcert
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
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start the application (node directly — npm isn't in the image)
CMD ["node", "server.js"]
