# Release Notes — Version 4.1.0

**Release Date:** 2026-06-11
**Type:** Security + bugfix release
**Severity:** **High** (SCEP)
**Upgrade priority:** **Recommended** (urgent if the SCEP endpoint is exposed)

---

## TL;DR — what you must do on upgrade

1. **If you run the SCEP endpoint**, upgrade promptly. Before this release,
   `PKIOperation` enrollment was unauthenticated whenever no challenge password
   had been issued (the state at every boot), so any client that could reach
   `/scep` could obtain a certificate signed by your local CA, for any hostname.
   After upgrading, enrollment requires a challenge password by default. To keep
   the old open-enrollment behavior, set `SCEP_ALLOW_OPEN_ENROLLMENT=true`
   (not recommended); to restrict which names the CA will sign, set
   `SCEP_ALLOWED_DOMAINS` (comma-separated domain suffixes).
2. **No data migration is required.** All other changes are backward compatible.

---

## Security fixes

- **SCEP enrollment fails closed.** A valid challenge password is now always
  required unless `SCEP_ALLOW_OPEN_ENROLLMENT` is explicitly enabled.
- **SCEP CSR identity validation.** Every CN/SAN must be a valid hostname or IP,
  and `SCEP_ALLOWED_DOMAINS` can restrict issuance to configured domain
  suffixes. The CA no longer signs for arbitrary subjects.
- **All settings secrets are masked** in `GET /api/settings`, `/running`, and
  `/export` (previously `ntfy.token`, `ntfy.password`, and `webhook.headers`
  leaked).
- **Settings writes are allowlisted** to the settings-form schema, blocking
  prototype pollution and arbitrary-key injection via `POST /api/settings` and
  `/import`.
- **`/api/execute` `uninstall-ca`** now requires `confirm: true` and enabled
  authentication, matching `/api/uninstall-ca`.
- **Enterprise CA OpenSSL config injection** via newline/metacharacters in
  CN/UPN/SAN is rejected.
- **SCEP `GetCACaps`** no longer advertises weak SHA-1 / DES3.

## Bug fixes

- `/api/execute` no longer throws `ReferenceError` for `install-ca`,
  `uninstall-ca`, `caroot`, and `list`, and returns the real command output.
- SCEP certificate generation no longer always throws (enterprise CA call
  signature fixed).
- Test Email, Verify SMTP, Check Expiry, and Start/Stop Monitoring buttons now
  issue POST instead of GET and work again.
- `GET /api/certificates` no longer merges same-named certificates from
  different folders into one entry.
- `GET /api/rate-limit/status` no longer returns 500.
- The `FORCE_HTTPS` redirect builds a correct target instead of string-replacing
  the port, and answers 400 (instead of crashing) on a missing Host header.
- Certificate monitoring reports a real failure for an invalid cron expression
  instead of falsely reporting success; `PUT /api/monitoring/config` validates
  the cron expression before applying it.
- `validateRequest` returns 400 (not 500) for non-string values; async route
  errors flow through the centralized error handler; the settings UI shows the
  real error message.

## Added

- A `node:test` suite (`npm test`) with 63 tests covering the fixes above.
- `SCEP_ALLOW_OPEN_ENROLLMENT` and `SCEP_ALLOWED_DOMAINS` configuration.

---

## Images

- **GHCR:** `ghcr.io/jeffcaldwellca/mkcertweb:4.1.0` (built automatically by CI on
  the `v4.1.0` tag).
- **Docker Hub:** `jeffcaldwellca/mkcertweb:4.1.0` (published via
  `./docker-build-push.sh`).
