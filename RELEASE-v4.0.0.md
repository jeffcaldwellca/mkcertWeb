# Release Notes — Version 4.0.0

**Release Date:** 2026-05-17
**Type:** Security Release (breaking)
**Severity:** **High**
**Upgrade priority:** **Urgent**

---

## TL;DR — what you must do on upgrade

This is a security release that closes vulnerabilities exploitable from any
device on the same network the server is reachable from. There are also two
**hard cleanup actions** that prior versions made necessary:

1. **Rotate any credentials that were in `.env` on the machine that built or
   published older Docker images.** Until v4.0.0 there was no `.dockerignore`,
   so `.env` was copied into image layers and shipped to anyone who pulled
   the image. Anything in there should be assumed leaked. (Includes:
   `AUTH_PASSWORD`, `SESSION_SECRET`, `SMTP_PASSWORD`, `OIDC_CLIENT_SECRET`,
   `NTFY_TOKEN`, `WEBHOOK_URL`, etc.)
2. **Revoke and reissue any certificates chained from the baked-in CA** that
   shipped in the public `jeffcaldwellca/mkcertweb:<= 3.2.0` image. Every
   pulled image of older versions used the *same* `rootCA-key.pem` — anyone
   who pulled the image holds that key. After upgrading, generate a fresh
   per-container CA via the UI ("Generate Root CA" button) or
   `POST /api/generate-ca`, then re-install it into your trust stores.

If you cannot upgrade immediately and run with `ENABLE_AUTH=false` (the old
default), an attacker on the same LAN can rewrite credentials, repoint OIDC
to their IdP, exfiltrate stored SMTP credentials, and execute arbitrary
shell commands via the legacy `/api/generate` route. Either upgrade or
firewall the listening ports until you do.

---

## Why this is v4 and not v3.3

The CA-key issue and the credentials-in-image-layers issue both require
operator action that can't be done silently by the upgrade. Adding any of
the following without a major-version bump would be surprising:

- the published image no longer ships a working CA on first boot
- `AUTH_PASSWORD=admin` is now refused (treated as "unset")
- `SESSION_SECRET=mkcert-web-ui-secret-key-change-in-production` is refused
- legacy single-segment download URLs are gone
- `/api/settings/*` returns 403 when auth is disabled

A clean major bump puts everyone on notice.

---

## Security fixes (highlights)

The full list is in [CHANGELOG.md](./CHANGELOG.md). The exploitable items
that this release closes:

| Severity | Issue |
|---|---|
| **CRITICAL** | Public Docker image shipped with a known `rootCA-key.pem`. Anyone who pulled `jeffcaldwellca/mkcertweb:<= 3.2.0` could forge browser-trusted certificates for any user of this CA. |
| **CRITICAL** | `.env` (and `.git`) were copied into image layers; secrets in either were silently published to Docker Hub. |
| **CRITICAL** | `/api/settings/*` skipped its auth gate when `ENABLE_AUTH=false`. Unauthenticated network callers could rewrite credentials, change `SESSION_SECRET`, repoint OIDC, or download stored SMTP/OIDC secrets via `/api/settings/export`. |
| **CRITICAL** | Command injection via PFX `password` body parameter (newline in the password split a shell command). |
| **CRITICAL** | Plaintext password compare (`===`) + timing leak on login. |
| **CRITICAL** | CSRF tokens were minted but never validated. Combined with `cors()` allowing all origins, every state-changing endpoint was open to cross-site forgery. |
| **CRITICAL** | Default credentials `admin` / `admin` plus the published `SESSION_SECRET` were baked into the Dockerfile and docker-compose. |
| **HIGH** | Command injection via the `domains` body parameter in the legacy inline `/api/generate` route. |
| **HIGH** | Path traversal in legacy inline `/api/download/cert/:folder/:filename` (and siblings) — no path validation on `folder`. |
| **HIGH** | Frontend XSS via certificate metadata, filenames, and `error.message` rendered into HTML and `onclick=""` attributes without escaping. |
| **HIGH** | `mkcert -uninstall` exposed with no confirmation gate. |
| **HIGH** | OIDC URLs were hand-built (`${issuer}/auth`, `/token`, `/userinfo`); only worked with one provider shape. Now uses discovery + PKCE. |

---

## What changes for you operationally

### Authentication
- `ENABLE_AUTH=true` is strongly recommended even on LAN. Settings UI now
  returns 403 when both `ENABLE_AUTH=false` and `ENABLE_OIDC=false`.
- `AUTH_PASSWORD=admin` and `SESSION_SECRET=mkcert-web-ui-secret-key-change-in-production`
  are treated as "unset." If you don't set real values:
  - the server prints a random one-time `AUTH_PASSWORD` to the container
    logs on first boot
  - `SESSION_SECRET` is regenerated on every process start (sessions don't
    survive restarts)
- `AUTH_PASSWORD_HASH` is a new optional env var. Pre-hash the password with
  bcrypt and set this instead of `AUTH_PASSWORD` if you'd rather not put
  the plaintext in env.

### Docker
- Image no longer pre-bakes a Root CA. After first start, click "Generate
  Root CA" in the UI (or call `POST /api/generate-ca` with auth + CSRF).
- A new volume — `mkcert_ca:/home/nodejs/.local/share/mkcert` — persists
  the per-container CA across restarts. It's declared automatically in the
  shipped `docker-compose.yml`; bare `docker run` users need to add
  `-v mkcert_ca:/home/nodejs/.local/share/mkcert`.
- Image base bumped to `node:20-alpine` (Node 18 LTS approaching EOL).
- `.dockerignore` added. `.env`, `.git`, `node_modules`, tests, docs,
  locally-issued certs no longer ship inside the image.

### CSRF / cookies
- Every mutating request (POST/PUT/DELETE) now needs `X-CSRF-Token` (or
  `_csrf` body field). The bundled frontend handles this automatically;
  external API clients must fetch `GET /api/csrf-token` first and pass
  the value back.
- Session cookies are now `SameSite=Lax`, `HttpOnly`, `Secure='auto'`
  (true when the connection is TLS), named `mkcertweb.sid`.
- `cors()` is no longer registered by default. Set `ALLOWED_ORIGINS` (comma-
  separated) only if you need cross-origin access.

### URLs that changed or are gone
- Removed: `/api/download/cert/:filename`, `/api/download/key/:filename`,
  `/api/download/bundle/:certname` (single-segment legacy variants).
  Use the `:folder/:filename` forms.
- Added: `POST /api/install-ca`, `POST /api/generate-ca`,
  `POST /api/uninstall-ca` in `src/routes/system.js`.
  `/api/uninstall-ca` requires `{"confirm": true}` body and is refused when
  auth is disabled.
- `GET /scep?operation=GetCACert` now returns DER (RFC 8894 §3.1) instead
  of PEM.
- `POST /scep?operation=PKIOperation` now actually works (was returning a
  placeholder string). See "SCEP" below.

### SCEP
- The PKIOperation endpoint now decrypts the inner EnvelopedData using the
  mkcert CA private key, extracts the PKCS#10 CSR, signs it via
  `openssl x509 -req`, and returns a properly signed PKCS#7 response.
- The previous placeholder cert (`... (would contain actual certificate) ...`)
  is gone. Failure paths now return a signed CertRep with the correct
  `pkiStatus` and `failInfo` attributes.
- The `challenge.password` vs `challenge.challengePassword` field-name
  mismatch that meant *no* challenge password ever matched is fixed.
- Real-world client testing (Intune, JAMF, NetworkManager, `sscep`) is
  recommended before relying on this in production; the implementation is
  structurally correct per RFC 8894 but has not been interoperated against
  a real client in this environment.

---

## Upgrade procedure

### From Docker Compose

```sh
# 1. Stop the running container
docker compose down

# 2. Pull the new image
docker compose pull

# 3. Add the new mkcert_ca volume to your local docker-compose.yml if you
#    customized it (the shipped one already has it). Look for the existing
#    'volumes:' section under the service and add:
#       - mkcert_ca:/home/nodejs/.local/share/mkcert
#    and under the top-level 'volumes:' list:
#       mkcert_ca:
#         driver: local

# 4. (RECOMMENDED) set AUTH_PASSWORD and SESSION_SECRET explicitly. The
#    container will run without them but will print a random password on
#    every restart and won't preserve sessions:
echo "AUTH_PASSWORD=$(openssl rand -base64 24)"   >> .env
echo "SESSION_SECRET=$(openssl rand -hex 48)"     >> .env

# 5. Start
docker compose up -d

# 6. The first boot has no Root CA yet. Either click "Generate Root CA" in
#    the UI, or:
TOKEN=$(curl -s -c /tmp/jar http://localhost:3000/api/csrf-token | jq -r .csrfToken)
curl -b /tmp/jar -X POST -H "X-CSRF-Token: $TOKEN" http://localhost:3000/api/generate-ca

# 7. Re-install the new CA into your trust stores (the rootCA.pem is at
#    /home/nodejs/.local/share/mkcert/rootCA.pem inside the container, or
#    download it via the UI's "Download Root CA" button).
```

### From `docker run`

```sh
docker run -d --name mkcert-web-ui \
  -p 3000:3000 -p 3443:3443 \
  -e ENABLE_AUTH=true \
  -e AUTH_PASSWORD='your-real-password-here' \
  -e SESSION_SECRET="$(openssl rand -hex 48)" \
  -v mkcert_certificates:/app/certificates \
  -v mkcert_data:/app/data \
  -v mkcert_ca:/home/nodejs/.local/share/mkcert \
  jeffcaldwellca/mkcertweb:4
```

### From source (`git pull`)

```sh
git pull
npm install                  # new deps: helmet
node -p "require('bcryptjs').hashSync('your-password', 12)" \
  > /dev/null  # generate AUTH_PASSWORD_HASH if you prefer pre-hashing
npm start
```

---

## Cleanup actions (don't skip)

1. **Rotate every secret that has ever been in `.env`** on a machine that
   built/published older images. Anything in those env vars was embedded
   in image layers and pulled by every user of those tags. If you only ever
   ran the official image and never built your own, this doesn't apply.
2. **Re-issue any cert that chained from the baked-in CA.** The private key
   of that CA is held by everyone who pulled `:<= 3.2.0`. After upgrade,
   the new per-container CA is yours alone.
3. **Tell any user who installed the old `mkcert-rootCA.pem` into their
   trust store to remove it** (and install the new one if they still use
   your service). The old CA is effectively a known-compromised root.
4. **Reset `SESSION_SECRET`.** If you ever ran with the documented default
   value, an attacker who knows the value can forge sessions.

---

## Rollback

**Not recommended.** Rolling back reintroduces every fixed vulnerability,
plus you'd need to revert the CA cleanup. If you have to roll back because
the new behavior breaks something:

```sh
docker compose down
# Edit docker-compose.yml: change image: jeffcaldwellca/mkcertweb:latest
# back to image: jeffcaldwellca/mkcertweb:3.2.0
docker compose pull
docker compose up -d
```

Then file an issue describing what broke so we can fix it forward instead.

---

## Verified compatibility / known gaps

**Verified:**
- HTTP serving, auth (basic + AUTH_PASSWORD_HASH), CSRF, settings UI,
  certificate listing/download/archive/restore/delete, SCEP GetCACaps,
  SCEP failure-response signing, frontend XSS hardening, helmet headers
  (CSP / X-Frame-Options / nosniff / Referrer-Policy), Docker build (no
  baked CA, no leaked `.env`), config volume mounts.

**Requires real-world testing (works in isolation; not interoperated):**
- SCEP `/scep?operation=PKIOperation` against an actual client
  (Intune / JAMF / NetworkManager / sscep) — implementation is RFC 8894
  compliant per `openssl asn1parse` but no live client run was possible
  in the development environment.
- OIDC discovery against a real IdP (Azure AD, Google, Okta) — the
  discovery + PKCE wiring is correct against the spec but hasn't been
  pointed at a live tenant.
- HTTPS server boot with mkcert-generated SSL certs — code is rewritten
  to use the safe `runTool` API but only HTTP was exercised in the
  release test pass.

If you hit issues in any of these, please file an issue with the
`v4.0.0-regression` label.
