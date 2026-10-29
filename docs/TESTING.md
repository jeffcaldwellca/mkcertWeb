# Testing

## Automated tests

```bash
npm test                                   # node --test 'test/*.test.js'
node --test test/certificate-twins.test.js # one file
```

The suite uses Node's built-in test runner (Node.js 22 or later) and needs no
extra packages. `openssl` must be on the `PATH` (one test makes a real
certificate). Route tests that would run mkcert use a stubbed command runner.
Node runs each test file in its own process. A run can leave an empty
`certificates/` directory behind; it is git-ignored.

Run `npm test` before every commit.

### What the suites cover

**Server routes and services**

| Area | Files |
|---|---|
| Certificate routes: listing, notes, archive/restore/delete, twins (`TWIN_EXISTS`, `?swap`, `?archived`, `SWAP_INCOMPLETE`, rollback), upload staging | `certificate-*.test.js`, `archive-validation`, `upload-staging`, `upload-prototype-pollution`, `execute-route` |
| Root CA generation | `generate-ca-route` |
| Removed 5.0 endpoints stay 404; `GET /api` lists exactly the declared routes | `removed-endpoints`, `api-index` |
| Security: CSRF, CSP and headers, input hardening, settings masking and allowlist, rate-limit status | `csrf`, `security-headers`, `input-hardening`, `settings-security`, `rate-limit-status` |
| Auth: session state for basic and OIDC logins, OIDC logout URL, HTTPS redirect (301/308, startup log), `TRUST_PROXY` parsing | `auth-state`, `oidc-logout`, `https-redirect`, `trust-proxy` |
| SCEP: GetCACaps, enrollment authorisation, CSR name checks, enterprise CA calls and identity checks | `scep-*`, `enterprise-ca-*` |
| Monitoring, notes store, response helpers, health version | `monitoring-*`, `notes-store`, `responses`, `health-version` |
| 5xx bodies: fixed message + `ref`, sanitised `reason`, full error in the log (archive, SMTP, CA install/uninstall/generate with a stubbed `runTool`, settings, upload); 4xx for bad JSON, oversized and malformed multipart bodies | `error-leak-guard`, `pfx-error-leak`, `upload-staging` |
| No server internals in success bodies: public `/api/status` (no paths, pid, memory, versions), `/api/system`, execute generate, the certificate list, generate-ca | `response-internals`, `generate-ca-route` |
| Landing page console | `console-commands` |

**Frontend modules.** The UMD modules in `public/js/` load in Node, so their
logic is tested directly: `frontend-core` (escaping, API client with CSRF retry,
theme), `frontend-shell` (top bar), `frontend-cert-model` (grouping, expiry
states, selection, twins), `frontend-scep-model` and
`frontend-settings-model` (diff, filter).

**Guards** (`frontend-guards.test.js`, `security-headers.test.js`). Source-level
checks that keep the frontend inside the rules in
[CONTRIBUTING.md](../CONTRIBUTING.md):

- no inline event-handler attributes anywhere under `public/` (the CSP blocks them);
- no external URLs, CDN links or Font Awesome in any page;
- no side-stripe accents (coloured `border-left`/`border-right`/`border-inline-*`
  bars or inset side shadows) in CSS, HTML or JS;
- every page's skeleton: icon and manifest links in `<head>`, `core.js` first,
  then `shell.js` (except login), the page controller last, `<header id="shell">`
  and `<main>`;
- the shared design-language block is byte-identical in `public/css/app.css` and
  `docs/assets/styles.css`;
- light-theme overrides exist for every surface token;
- delete, archive and restore reload the list on a stale-list 404;
- `/favicon.ico` and the web manifest point at files that exist.

**Server guard** (`error-leak-guard.test.js`): no `serverError(…)` or
`res.status(5xx).json|send(…)` in `src/routes/*.js` or `server.js` builds its
body from an error object (`err.message`, `.stderr`, `.stack`, `${err}`, …);
the optional `reason` must come from `publicReason(err)`. It has a self-test
with positive and negative samples. Two more checks in the same file: every
JSON 5xx goes through `serverError` (so it has a `ref`), and no
`console.error` sits right before a `serverError` call (pass the error
instead). `frontend-guards.test.js` also keeps page controllers from building
error text out of `body.error` (use `core.formatApiError`).

**Env-file guard** (`env-file-comments.test.js`): no variable line in
`.env.example` or `examples/*.env` (commented out or not) has an inline
`# comment`, which `docker run --env-file` would read as part of the value.

## Running a throwaway server

For manual checks, start a server with a temporary CA directory so nothing
touches your real mkcert CA:

```bash
mkdir -p /tmp/mkcert-scratch-ca
CAROOT=/tmp/mkcert-scratch-ca PORT=3999 ENABLE_HTTPS=false node server.js
```

For pages that need a login (settings), add the credentials on the command line
rather than saving them:
`ENABLE_AUTH=true AUTH_USERNAME=demo AUTH_PASSWORD=demo-pass-123`.

Stop the server afterwards and delete what it created: `certificates/`,
`config/settings.json`, `data/` and `ssl/` are runtime state and are
git-ignored.

**Don't press generate or install on the root-ca page, or call
`/api/generate-ca` or `/api/install-ca`, against your own machine casually.**
Both run `mkcert -install`, which adds a CA to the system trust store (and
generate creates a new CA when `CAROOT` is empty). Use a temporary `CAROOT`, a
container or a VM, and remove the CA from the trust store afterwards
(`mkcert -uninstall` with the same `CAROOT`). To test the root-ca page with a
CA present, put a throwaway `rootCA.pem` / `rootCA-key.pem` made with openssl
into the temporary `CAROOT`.

## Manual smoke test

Run through this on a throwaway server before a release, in both themes and at
phone width (about 390 px; nothing should scroll sideways). Watch the browser
console for CSP violations.

**certificates**
- Quick generate `app.dev.local 127.0.0.1` in each format (`pem`, `crt`, `p12`,
  `p12-client`); the new certificate is selected.
- The list groups NEEDS ATTENTION / HEALTHY / READ-ONLY / ARCHIVED; `/` focuses
  the filter, and the filter matches names and SANs.
- overview, files and notes tabs; add, edit and clear a note.
- `↓ bundle`, file downloads, and `pfx` without a password.
- archive, then restore; archive again, generate the same name, and check that
  archive is disabled with a hint, restore asks to swap, and delete removes only
  the archived copy.
- Upload a `.pem` + `-key.pem` pair; it appears under READ-ONLY.
- Reloading keeps the selection (`#cert=…` in the URL).

**root-ca**
- With a CA present: summary, details, `↓ rootCA.pem`. Don't press install.
- With an empty `CAROOT`: the generate button shows (see the warning above).

**scep**
- Service URLs copy; create a challenge (the password shows once), and it
  appears in the list with its time left.
- manual enroll with the `Computer` template; mdm setup shows the URL.

**notifications**
- Each channel shows the right state; actions are disabled when a channel isn't
  ready. With monitoring enabled, `check now` works and the expiring list shows.

**settings** (auth server)
- Section list, `find setting…`, changing a field counts as unsaved and marks the
  section `edited`; `discard` reverts it; `save changes`, `reload`, `view running
  config` (copy, download json) work. Delete `config/settings.json` afterwards.

**login** (auth server)
- Wrong password shows an error; the right one opens certificates; logout returns
  to login.
