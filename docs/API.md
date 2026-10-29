# API reference

Every route the server mounts, taken from `server.js` and `src/routes/*.js`.
`GET /api` returns the same list at runtime, and `test/api-index.test.js`
checks that the index matches the routes in the source.

## Conventions

**Base URL.** `http://localhost:3000` by default (`PORT`), or
`https://localhost:3443` when `ENABLE_HTTPS=true` (`HTTPS_PORT`).

**Response envelope.** JSON routes answer with the data spread at the top level:

```json
{ "success": true, "message": "optional text", "...": "route-specific fields" }
```

Errors use `{ "success": false, "error": "<message>" }`. Some errors add a
machine-readable `code` (`CSRF_INVALID`, `TWIN_EXISTS`, `SWAP_INCOMPLETE`).

A `500` carries a fixed message and a reference ID, never the underlying error
(no paths, stderr, command lines or stack traces, whatever `NODE_ENV` is):

```json
{ "success": false, "error": "Failed to archive certificate", "ref": "3f9c1a0e" }
```

The server log has the full error on a line that starts with the same
`[ref 3f9c1a0e]`, plus the method and path. Where the cause helps an admin
act (the email, ntfy and webhook tests and SMTP verify; root CA install,
uninstall and generate), the body also has a short `reason`: an error code
such as `ECONNREFUSED`, `EAUTH`, `ETIMEDOUT` or `ENOENT`, or else one line of
the error with absolute paths replaced by `<path>` (at most 120 characters).
Download routes (`/api/download/*`, `/api/generate/pfx/*`,
`/api/settings/export`, `GET /scep`) send a file instead.

**Authentication.** With `ENABLE_AUTH=true`, routes marked "auth" in the tables
need a logged-in session (cookie `mkcertweb.sid`). Without one they return
`401 { success: false, error: "Authentication required", redirectTo: "/login" }`.

<a id="what-is-protected-without-enable_auth"></a>
**What is protected without `ENABLE_AUTH`.** Authentication is on only when
`ENABLE_AUTH=true`. `ENABLE_OIDC` alone turns nothing on: the OIDC routes are
mounted only when `ENABLE_AUTH=true`. With auth off, every "auth" route is open
to anyone who can reach the server, including generate, upload, archive,
delete, `POST /api/generate-ca` and `POST /api/install-ca` (which only add
trust; generate is how a new container gets its CA). Two things refuse instead:

- the whole settings API (`/api/settings*`) returns 403 (see [Settings](#settings));
- `mkcert -uninstall` (`POST /api/uninstall-ca` and `uninstall-ca` in
  `POST /api/execute`) returns 403.

```bash
# log in and keep the session cookie
curl -c jar -H 'Content-Type: application/json' \
  -d '{"username":"demo","password":"demo-pass-123"}' \
  http://localhost:3000/api/auth/login
```

**CSRF.** Every request that isn't `GET`, `HEAD` or `OPTIONS` needs a CSRF
token bound to the session. Fetch one, then send it in the `X-CSRF-Token`
header (a `_csrf` field in the body also works):

```bash
TOKEN=$(curl -s -b jar -c jar http://localhost:3000/api/csrf-token | node -pe 'JSON.parse(require("fs").readFileSync(0)).csrfToken')
curl -b jar -H "X-CSRF-Token: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"command":"generate","input":"app.dev.local 127.0.0.1","format":"pem"}' \
  http://localhost:3000/api/execute
```

A missing or invalid token returns `403 { success: false, error: "Invalid CSRF token", code: "CSRF_INVALID" }`.
The token is tied to the session, so keep the cookie jar between the two calls.
Exempt paths: `POST /api/auth/login`, `POST /login`, `POST /api/auth/logout`,
`/auth/oidc`, `/auth/oidc/callback` and `POST /scep`.

**Rate-limit tiers.** Each route uses one limiter (express-rate-limit, in-memory,
`RateLimit-*` headers). Over the limit the response is `429` with
`{ error, retryAfter }`.

| Tier | Default | Keyed by | Configure with |
|---|---|---|---|
| `cli` | 10 per 15 min | IP + user | `CLI_RATE_LIMIT_WINDOW`, `CLI_RATE_LIMIT_MAX` |
| `api` | 100 per 15 min | IP + user | `API_RATE_LIMIT_WINDOW`, `API_RATE_LIMIT_MAX` |
| `auth` | 5 per 15 min | IP | `AUTH_RATE_LIMIT_WINDOW`, `AUTH_RATE_LIMIT_MAX` |
| `general` | 200 per 15 min | IP | fixed |

Windows are in milliseconds. Static files under `public/` are not rate-limited.

**Folder identifiers.** Per-certificate routes take a `:folder` that names where
the files live under `certificates/`:

| `:folder` | Directory |
|---|---|
| `YYYY-MM-DD` | `certificates/YYYY-MM-DD/` (where generated certificates go) |
| `interface-ssl`, `legacy` | `certificates/` itself |
| `root-ca` | notes only (`PUT …/notes`) |

Any other folder (`uploaded`, `scep`, …) is rejected with 400. Archived copies
live in `<folder>/archive/`.

## Authentication

| Method | Path | Auth | Tier | Notes |
|---|---|---|---|---|
| GET | `/api/auth/status` | — | general | `{ authenticated, username, authEnabled }` (no `success` field) |
| GET | `/api/auth/methods` | — | general | `{ basic: bool, oidc: { enabled: bool } }` |
| POST | `/api/auth/login` | — | auth | Body `{ username, password }`. 200 `{ success, message, redirectTo: "/" }`; 400 if a field is missing; 401 on bad credentials. Only mounted when `ENABLE_AUTH=true`. |
| POST | `/api/auth/logout` | — | general | Destroys the session. `{ success, message, redirectTo }`; for OIDC users `redirectTo` is the provider's end-session URL when it advertises one. Only mounted when `ENABLE_AUTH=true`. |
| GET | `/api/csrf-token` | — | general | `{ success, csrfToken }` |
| POST | `/login` | — | auth | HTML form login (`username`, `password`), redirects to `/` or `/login?error=…` |
| GET | `/auth/oidc`, `/auth/oidc/callback` | — | general | OIDC sign-in and callback. Mounted only when `ENABLE_AUTH=true`, `ENABLE_OIDC=true` and the issuer, client ID and secret are set. |

## Certificates

| Method | Path | Auth | Tier | Request | Response |
|---|---|---|---|---|---|
| GET | `/api/certificates` | auth | general | — | `{ certificates: [...], total }` |
| POST | `/api/execute` | auth | cli | `{ command, input?, format?, confirm? }` | see below |
| POST | `/api/upload` | auth | api | multipart, field `certificates` (one or more files) | see below |
| POST | `/api/certificates/:folder/:certname/archive` | auth | cli | — | `{ message }` |
| POST | `/api/certificates/:folder/:certname/restore` | auth | cli | query `swap=true\|false` | `{ message, swapped }` |
| DELETE | `/api/certificates/:folder/:certname` | auth | cli | query `archived=true\|false` | `{ message, deletedFiles, scope }` |
| PUT | `/api/certificates/:folder/:certname/notes` | auth | general | `{ note }` (string, ≤ 2000 chars; empty clears it) | `{ note }` |
| POST | `/api/generate/pfx/:folder/:certname` | auth | cli | `{ password? }` | `<certname>.pfx` file |
| GET | `/api/download/cert/:folder/:filename` | auth | general | — | the file |
| GET | `/api/download/key/:folder/:filename` | auth | general | — | the file |
| GET | `/api/download/bundle/:folder/:certname` | auth | general | — | `<certname>.zip` with the cert (`.pem` or `.crt`) and key (`-key.pem` or `.key`) |

**`GET /api/certificates`.** Scans `certificates/` recursively for `.pem`,
`.crt`, `.key`, `.p12` and `.pfx` files and groups each certificate with its key.
Each entry has `name`, `cert` and `key` (file objects with `filename`, `size`,
`modified`, `relativePath`, …; no absolute paths), `domains` (DNS SANs and CN), `expiry`, `fingerprint` (SHA-256),
`format` (`pem`, `crt` or `p12`), `folder`, `folderDate`, `isArchived`,
`isInterfaceSSL`, `canEdit`, and `note` when one is saved. Files named
`.swap-*` are never listed.

**`POST /api/execute`.** `command` is one of:

| `command` | What it runs | Response fields |
|---|---|---|
| `generate` | `mkcert` in `certificates/<today>/`. `input` is the space-separated names (the first one names the files). `format`: `pem` (default, `<name>.pem` + `<name>-key.pem`), `crt` (`.crt` + `.key`), `p12`, or `p12-client` (`-pkcs12 -client`). | `output`, `format` |
| `caroot` | `mkcert -CAROOT` | `output`, `command` |
| `install-ca` | Returns a note without running anything when the CA files already exist; otherwise `mkcert -install`. | `output`, `command`, `warning?` |
| `uninstall-ca` | `mkcert -uninstall`. Needs `ENABLE_AUTH=true` (403 otherwise, even with OIDC configured) and `"confirm": true` (400 otherwise). | `output`, `command` |

Any other value, including the removed `list`, gets `400 Invalid command`.

**`POST /api/upload`.** Accepts `.pem`, `.crt`, `.key`, `.p12` and `.pfx`, up to
10 MB each, and saves them to `certificates/uploaded/` (`UPLOADED_CERTS_DIR`).
Files are staged in a private directory under the OS temp dir first. Response:
`{ success, message, completePairs, incompletePairs: [{ certName, missing, hasFile }], errors: [], files: [{ name, size, type }] }`.
Bad file types, bad names and oversized files return 400. Uploaded certificates
are listed but the per-certificate routes above reject the `uploaded` folder.

**`POST …/generate/pfx`.** Exports `<certname>.pem` + `<certname>-key.pem` from
the active (not archived) folder. Without a password the PFX has an empty one. A failure returns `500` with the generic error `failed to generate PFX`; the details are logged on the server only.
Known issue: a non-empty password currently fails with 500.

### Archived and active copies ("twins")

An active `<folder>/<name>.pem` and an archived `<folder>/archive/<name>.pem` can
exist at the same time. No route overwrites one with the other or deletes both:

| Route | Behaviour |
|---|---|
| `POST …/archive` | 409 `TWIN_EXISTS` if an archived copy of the name already exists. 404 if there are no active files. |
| `POST …/restore` | 404 if there is no archived copy. 409 `TWIN_EXISTS` if an active copy exists, unless `?swap=true`, which exchanges the two pairs (with rollback if a rename fails) and returns `swapped: true`. 409 `SWAP_INCOMPLETE` while a leftover from an interrupted swap is present (see below). A swap whose temporary name would be too long returns 400. |
| `DELETE …` | Deletes exactly one copy: `?archived=true` the archived copy, `?archived=false` the active copy, no parameter the active copy if it exists, else the archived one. `scope` in the response says which (`active` or `archived`). The note is removed only when neither copy remains. 404 if the chosen copy has no files. |

`?swap` and `?archived` accept only `true` or `false`; any other value is a 400.
A name that decodes to a path (for example a double-encoded `archive%252Fname`)
is a 400.

### Recovering from an interrupted swap

A swap renames, per file: active → temporary, archived → active, temporary →
archived. The temporary files sit in the archive folder and are named
`.swap-<16 hex digits>-<name>.pem` and `.swap-<16 hex digits>-<name>-key.pem`.
If a rename fails the server undoes the earlier ones. If the undo also fails,
the restore returns 500 ("…check its archive folder for .swap-* files") and the
temporary files stay behind. Until they are gone, every restore of that name
returns 409 `SWAP_INCOMPLETE`. The listing hides them and the server log names
each one.

To recover by hand:

1. Stop making changes to that certificate and look in
   `certificates/<folder>/archive/` (or `certificates/archive/` for
   `interface-ssl`/`legacy`).
2. Each `.swap-…` file holds what was the **active** copy before the swap.
   Check which copy is where with
   `openssl x509 -noout -fingerprint -sha256 -enddate -in <file>`.
3. Move each temporary file to the slot that is empty: back to
   `certificates/<folder>/<name>.pem` (and `-key.pem`) if the active slot is
   empty, or to `archive/<name>.pem` if the archived slot is empty. Never
   overwrite an existing file; if both slots are full, keep the `.swap-` file
   under a new name outside `certificates/` until you know which copy you want.
4. Once no `.swap-…-<name>…` file is left in the archive folder, restore works
   again.

## Root CA

| Method | Path | Auth | Tier | Notes |
|---|---|---|---|---|
| GET | `/api/rootca/info` | auth | general | `{ caRoot, subject, issuer, expiry, daysUntilExpiry, fingerprint, path }`; 404 when `rootCA.pem` is missing |
| GET | `/api/download/rootca` | auth | general | `mkcert-rootCA.pem` |
| POST | `/api/install-ca` | auth | cli | Runs `mkcert -install` (adds the CA to **this server's** trust store; needs root). `{ output }` |
| POST | `/api/generate-ca` | auth | cli | If the CA exists: `action: "none"`. Otherwise runs `mkcert -install`, which creates the CA and then tries the trust store. Succeeds when the CA files exist afterwards: `{ caRoot, caExists, action: "generated", trustStoreInstalled, caCopiedToPublic, output }`. Copies the CA certificate to `certificates/mkcert-rootCA.pem`. |
| POST | `/api/uninstall-ca` | auth | cli | Runs `mkcert -uninstall`. 403 unless `ENABLE_AUTH=true` (OIDC alone is not enough); 400 unless the body is `{ "confirm": true }`. |

`generate-ca` and `install-ca` change the trust store of the machine running the
server. Don't call them against your workstation casually.

## Notifications and monitoring

| Method | Path | Auth | Tier | Notes |
|---|---|---|---|---|
| GET | `/api/email/status` | auth | api | `{ enabled, configured, smtp: { host, port, secure, user }, from, to }` (`user` is masked) |
| POST | `/api/email/verify` | auth | cli | Checks the SMTP connection. 400 if email is disabled or incomplete. |
| POST | `/api/email/test` | auth | cli | Verifies SMTP, then sends a test email. |
| GET | `/api/ntfy/status` | auth | api | `{ enabled, configured, url, topic, priority, authMethod }` |
| POST | `/api/ntfy/test` | auth | cli | Sends a test notification. |
| GET | `/api/webhook/status` | auth | api | `{ enabled, configured, url, hasCustomHeaders }` |
| POST | `/api/webhook/test` | auth | cli | Sends a test payload. |
| GET | `/api/monitoring/status` | auth | api | `{ enabled, running, schedule, warningDays, criticalDays, includeUploaded, emailEnabled, ntfyEnabled, webhookEnabled }` |
| GET | `/api/monitoring/expiring` | auth | api | `{ total, critical, warning, certificates: [{ path, expiry, daysUntilExpiry, domains, priority }] }` for certificates expiring within the warning window. Sends nothing. |
| POST | `/api/monitoring/check` | auth | cli | Runs an expiry check now (and sends alerts). 400 if monitoring is disabled. |
| POST | `/api/monitoring/start` | auth | cli | Starts the scheduler. 400 if monitoring is disabled. |
| POST | `/api/monitoring/stop` | auth | cli | Stops the scheduler. |
| PUT | `/api/monitoring/config` | auth | cli | Body: any of `warningDays`, `criticalDays` (numbers 1–365), `checkInterval` (valid cron), `includeUploaded` (boolean). Applies to the running process only; not saved. |

## SCEP

| Method | Path | Auth | Tier | Notes |
|---|---|---|---|---|
| GET | `/scep?operation=GetCACaps` | — | api | `text/plain`: `Renewal`, `SHA-256`, `AES` |
| GET | `/scep?operation=GetCACert` | — | api | The mkcert root CA, DER-encoded (`application/x-x509-ca-cert`) |
| POST | `/scep?operation=PKIOperation` | — | cli | PKCS#7 request as a raw body (`application/x-pki-message` or `application/octet-stream`) or a multipart field `message`, up to 10 MB. Responds with a PKCS#7 `CertRep`. |
| POST | `/api/scep/challenge` | auth | api | `{ identifier, expiresIn? }` (seconds, default 3600) → `{ identifier, challengePassword, expiresAt }` |
| GET | `/api/scep/challenges` | auth | api | `{ challenges: [{ identifier, expiresAt, used, expired }] }` (passwords are not returned) |
| POST | `/api/scep/certificate` | auth | cli | `{ commonName, template?, upn?, subjectAltNames?, challengePassword? }` → `{ commonName, template, upn, certificatePath, method, enterpriseMode, message }` |
| GET | `/api/scep/certificates` | auth | api | `{ certificates: [{ commonName, path, created, modified }] }` from `certificates/scep/` |
| GET | `/api/scep/certificates/:commonName` | auth | api | `{ commonName, certPath, keyPath, info }` (`openssl x509 -text` output); 404 if missing |
| GET | `/api/scep/config` | auth | api | Service URLs, supported operations and capabilities |
| GET | `/api/scep/enterprise-ca/status` | auth | api | Enterprise CA configuration status |
| GET | `/api/scep/templates` | auth | api | `User`, `M365User`, `Computer`, `WiFi` with their key usages |
| POST | `/api/scep/validate-upn` | auth | api | `{ upn }` → `{ upn, valid, message }` |

Challenge passwords are kept in memory, so a restart clears them. See
[SCEP.md](SCEP.md).

## Settings

All settings routes return **403 unless `ENABLE_AUTH=true`** (`ENABLE_OIDC`
alone is not enough), and otherwise need a session (401 without one). They use
the `api` tier.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/settings` | Saved settings merged over the running config. Secrets are masked (`********`; the basic-auth password comes back empty). |
| GET | `/api/settings/running` | The configuration this process loaded at startup, masked. |
| POST | `/api/settings` | Body: a nested object of the editable keys (for example `{ "email": { "smtp": { "host": "smtp.dev.local" } } }`). Unknown keys are dropped; masked placeholders leave the stored secret unchanged. Merged into `config/settings.json`. |
| DELETE | `/api/settings` | Deletes `config/settings.json`. |
| GET | `/api/settings/export` | `config/settings.json` as a download, secrets masked. |
| POST | `/api/settings/import` | Same body and rules as `POST /api/settings`. |

Saved settings take effect after a restart. See [SETTINGS.md](SETTINGS.md).

## System

| Method | Path | Auth | Tier | Notes |
|---|---|---|---|---|
| GET | `/api` | — | general | `{ name, version, description, endpoints }` (see below) |
| GET | `/api/health` | — | general | `{ status: "ok", timestamp, uptime, version }` |
| GET | `/api/status` | — | general | Public, even with `ENABLE_AUTH=true`: `mkcertInstalled`, `opensslAvailable`, `caExists`, plus `server` (`running`, `uptime`), `ca` (`exists`), `features` (booleans) and `environment` (`nodeEnv`, `platform`, `arch`). No paths, pid, memory or versions |
| GET | `/api/config/theme` | — | general | `{ defaultTheme: "dark" \| "light" }` from `THEME_MODE` (no `success` field) |
| GET | `/api/rate-limit/status` | — | general | The configured limits as text |
| GET | `/api/system` | auth | general | Platform, memory, CPU count, Node version |
| GET | `/api/config` | auth | general | Server port and host, auth/OIDC flags, theme |

Unknown paths under `/api/` return `404 { success: false, error: "API endpoint not found" }`.

**`GET /api` format (changed in 5.0).** `endpoints` is grouped by area
(`authentication`, `certificates`, `rootCA`, `notifications`, `scep`,
`settings`, `system`). Each key is `"METHOD /path"` and each value is a short
description:

```json
{
  "success": true,
  "name": "mkcert Web UI API",
  "version": "5.0.0",
  "endpoints": {
    "certificates": {
      "GET /api/certificates": "List all certificates",
      "POST /api/certificates/:folder/:certname/restore": "Restore an archived certificate (?swap=true|false)"
    }
  }
}
```

Before 5.0 the keys were paths and the values started with the method
(`"/api/certificates": "GET - …"`).

## Removed in 5.0

These return 404: `GET /api/files`, `GET /api/file/:filename/content`,
`GET /download/:filename`, `GET /api/certificate/:filename`,
`DELETE /api/certificate/:filename` and `GET /api/commands`. Use the
folder-aware `/api/download/*` and `/api/certificates/:folder/:certname` routes.
