# Contributing

Bug reports and pull requests are welcome at
<https://github.com/jeffcaldwellca/mkcertWeb>. Report security problems privately
(see [SECURITY.md](SECURITY.md)).

## Development setup

You need Node.js 22 or later, [mkcert](https://github.com/FiloSottile/mkcert)
and openssl.

```bash
git clone https://github.com/jeffcaldwellca/mkcertWeb.git
cd mkcertWeb
npm install
npm run dev        # nodemon, http://localhost:3000
npm test
```

Use a scratch CA while developing so you don't touch your real one, and pass
settings on the command line instead of saving them:

```bash
mkdir -p /tmp/mkcert-scratch-ca
CAROOT=/tmp/mkcert-scratch-ca ENABLE_AUTH=true AUTH_USERNAME=demo AUTH_PASSWORD=demo-pass-123 npm run dev
```

Don't press generate or install on the root-ca page against your own machine;
both run `mkcert -install`. [docs/TESTING.md](docs/TESTING.md) explains how to
test them safely and has the manual smoke test.

`certificates/`, `config/settings.json`, `data/` and `ssl/` are runtime state.
They are git-ignored; never commit them.

## Architecture

**Server.** `server.js` wires Express: helmet (CSP), sessions, passport (OIDC),
CSRF, rate limiters, then the routers in `src/routes/` and a final `/api/*` 404.

| Path | Contents |
|---|---|
| `src/config/` | `index.js` merges defaults, `config/settings.json` and environment variables; `securityHeaders.js` holds the helmet/CSP options |
| `src/middleware/` | CSRF (`csrf.js`) and rate limiters (`rateLimiting.js`) |
| `src/routes/` | `certificates`, `files` (upload), `notifications`, `scep`, `settings`, `system` |
| `src/security/` | `runTool` (execFile with a per-tool argument allowlist; mkcert and openssl only), path and filename validation |
| `src/services/` | email, ntfy, webhook, expiry monitor, notes store |
| `src/utils/` | certificate parsing and grouping, PKCS#7/SCEP, enterprise CA, response helpers |

API responses are `{ success: true, ...data }` or `{ success: false, error }`
(`src/utils/responses.js`). **Never put `error.message`, stderr, a stack or a
command line in a response** — use
`apiResponse.serverError(res, 'Fixed message', err[, { reason: publicReason(err) }])`,
which logs the full error under a reference ID and returns the fixed message
with that `ref`. Add `reason` only where it helps an admin act (notification
tests, CA install/uninstall/generate), never for generate, file or download
errors. `test/error-leak-guard.test.js` enforces this for `src/routes/` and
`server.js`. New routes must also be added to the `GET /api`
index in `src/routes/system.js`; `test/api-index.test.js` fails otherwise. The
full route list is in [docs/API.md](docs/API.md).

**Frontend.** Plain HTML, CSS and JavaScript in `public/`, with **no build step**
and no frontend dependencies.

- One page per file: `index.html` (certificates), `root-ca.html`, `scep.html`,
  `notifications.html`, `settings.html`, `login.html`. All styles are in
  `public/css/app.css`.
- One controller per page in `public/js/` (`certificates.js`, `root-ca.js`,
  `scep.js`, `notifications.js`, `settings.js`, `login.js`). Controllers are
  IIFEs and export nothing.
- Shared and testable code lives in UMD modules on `window.MK`, which also load
  in Node for tests:

  ```js
  (function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else { root.MK = root.MK || {}; root.MK.<name> = api; }
  })(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    // ...
    return { /* exports */ };
  });
  ```

  | Module | Provides |
  |---|---|
  | `core.js` → `MK.core` | `escapeHtml`, `createApiClient`, `initTheme`, `toggleTheme`, `toast` |
  | `shell.js` → `MK.shell` | `renderShell` (pure) and `mountShell` (top bar: tabs, status dots, user, theme, logout) |
  | `cert-model.js` → `MK.certModel` | certificate grouping, expiry states, location rules, selection hash |
  | `scep-model.js`, `settings-model.js` | page-specific pure logic |

- Script order on every page: `core.js`, `shell.js` (not on login), any models,
  then the controller last. Each page has `<header id="shell"></header>` and a
  `<main>`, and links the favicons and manifest in `<head>`. The page-skeleton
  guard test checks all of this.
- A controller creates the API client, wires its handlers, then calls
  `MK.shell.mountShell('<page id>', { api })` and loads its data alongside it,
  so the shell and the page share one client and one CSRF token.
- `createApiClient()` prefixes `/api`, fetches a CSRF token before the first
  mutating request, sends it as `X-CSRF-Token`, retries once on a 403 with
  `code: 'CSRF_INVALID'`, follows `redirectTo` on a 401, and throws an `Error`
  with `status` and `body` for any other failure.
- Theme: `data-theme` on `<html>`, stored in `localStorage['theme']`; the server
  default comes from `GET /api/config/theme`.

## Design language

The dashboard (`public/`) and the landing page (`docs/`) share one visual
language. The shared tokens are a `:root` block that is duplicated, byte for
byte, between the `SHARED DESIGN LANGUAGE` markers in `public/css/app.css` and
`docs/assets/styles.css`. There is no build step to share one file, so change
both copies together; `test/frontend-guards.test.js` fails if they differ.
This section is the reference for that block.

### Shared tokens

| Token | Value | Use |
|---|---|---|
| `--accent` | `#2cf5b8` | the signature aqua: links, selection, primary buttons |
| `--accent-soft` | `#8cf5d4` | secondary emphasis, link hover |
| `--accent-contrast` | `#04140f` | text on an accent-filled control |
| `--accent-glow` | `rgba(44, 245, 184, 0.40)` | used in `--glow` and 45% outlines |
| `--glow` | `0 0 8px var(--accent-glow)` | primary action and focus only |
| `--font-mono` | `ui-monospace, 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', 'Courier New', monospace` | all text |
| `--radius` / `--radius-lg` | `4px` / `8px` | controls and cards / large containers |
| `--border-width` | `1px` | |
| `--muted` | `#7d8590` | neutral grey |
| `--success` / `--warning` / `--error` | `#4ade80` / `#fbbf24` / `#f87171` | status |

The dashboard adds surface tokens after the shared block (`--bg`, `--bg-pane`,
`--bg-raised`, `--bg-inset`, `--border`, `--border-strong`, `--text`,
`--text-strong`, `--text-muted`, `--info`, `--prompt`, `--hover`,
`--accent-wash`) with a dark default and a `[data-theme="light"]` override.
Light mode also overrides the accent (`#0a7c61`), its contrast (`#fff`), glow and
the status colours so text meets WCAG AA. Every surface token needs a light
value (a guard test checks this). The landing page has its own near-black
surface tokens and no light mode.

### Rules

- **Use tokens.** No hard-coded colours, radii or fonts in components.
- **System monospace only.** No web fonts and nothing loaded from another origin.
- **Copy.** Navigation tabs, sub-tabs and buttons are lowercase (`archive`,
  `↓ bundle`). Section labels are uppercase with letter-spacing
  (`SUBJECT ALT NAMES`). Each page's `h1` starts with a `$` in `--prompt`; the
  brand uses `>`. `--prompt` coral appears nowhere else.
- **Icons** are text glyphs (`↓ ↑ ⟳ ↵ ×`); there is no icon font.
- **No side-stripe accents.** Cards, list items, toasts, banners, alerts and
  code blocks never get a coloured `border-left`/`border-right`
  (`border-inline-*`) bar or an inset side shadow. Show state with a full 1px
  outline tinted at about 45% plus a tinted fill, coloured text, a status dot, a
  pill, or an uppercase `OK`/`ERR`/`INFO` tag. A selected list item is a raised
  background, a 45% accent outline and accent text. Enforced by `findSideStripes`
  in `test/frontend-guards.test.js`.
- **Buttons.** Primary: accent fill, `--accent-contrast` text, `--glow`.
  Secondary: 1px border, no glow. Every control has a visible `:focus-visible`
  outline.
- **Layout.** A top bar, then a list pane on the left and a detail pane on the
  right. The panes stack below about 900px, and nothing may scroll sideways at
  360px wide.
- **Accessibility.** Colour never carries state alone (dots have text), status
  changes go through `role="status"` or the toast live regions, and focus is put
  back somewhere sensible after a re-render.

## Security rules for frontend code

The CSP is `script-src 'self'; style-src 'self'` with `script-src-attr 'none'`
(`src/config/securityHeaders.js`). Therefore:

- **No inline code.** No `on*=` attributes, `<script>` blocks, `<style>` blocks or
  `style=""` attributes. Wire events with `addEventListener`; set dynamic sizes
  through the CSSOM (`el.style.width = …`), which the CSP allows.
- **No external resources.** Pages load only same-origin files.
- **Escape every server string.** Anything from the API goes through
  `MK.core.escapeHtml` before it reaches `innerHTML`, or is set with
  `textContent`. That includes certificate names, notes, error messages and
  config values.
- **Use the API client** for every request, so CSRF tokens and 401 redirects
  are handled. Downloads that need a blob fetch the token from
  `/api/csrf-token` the same way.
- **Only offer what the server allows.** If a route rejects a folder or state,
  hide or disable the control and say why.

## Tests

`npm test` runs every `test/*.test.js` with Node's test runner. Add tests with
your change: route tests mount a router on a throwaway app (`test/helpers.js`),
and frontend logic belongs in a UMD module so it can be tested in Node. The
guards are listed in [docs/TESTING.md](docs/TESTING.md).

## Commits and pull requests

- Conventional commit subjects: `feat(ui): …`, `fix(certs): …`, `docs: …`,
  `chore(deps): …`, `test: …`; `!` marks a breaking change
  (`refactor!: …`). The body says what changed and why.
- `npm test` passes before each commit.
- Keep runtime state and secrets out of commits.
- User-visible changes get a line in `CHANGELOG.md` under an unreleased or new
  version heading.

## Landing page

The project site is static files in `docs/`, served by GitHub Pages:

- `docs/index.html`: the page (CRT-terminal style, boot sequence, console
  easter egg);
- `docs/assets/`: `styles.css`, `main.js`, `console-commands.js` (tested by
  `test/console-commands.test.js`), icons and `screenshot.png`;
- `docs/.nojekyll`: serve the files as they are.

To publish: repository **Settings → Pages → Deploy from a branch →** `main`,
folder `/docs`. Pushing changes under `docs/` to `main` redeploys it. To preview
locally:

```bash
python3 -m http.server 8080 --directory docs   # http://localhost:8080/
```

The landing page uses the shared design-language block above and the same
"no side-stripe" rule.

## Releasing

1. Bump the version: `npm version X.Y.Z --no-git-tag-version` (updates
   `package.json` and `package-lock.json`; `/api/health` and `GET /api` read it
   from `package.json`).
2. Update the version shown on the landing page: `docs/index.html`,
   `docs/assets/main.js`, `docs/assets/console-commands.js` and its test.
3. Add a `## [X.Y.Z] - YYYY-MM-DD` section at the top of `CHANGELOG.md`
   ([Keep a Changelog](https://keepachangelog.com/en/1.0.0/)), and update the
   supported versions in `SECURITY.md` for a new major.
4. Commit (`release: X.Y.Z`), then tag `vX.Y.Z` and push. Pushing the tag makes
   CI publish `ghcr.io/jeffcaldwellca/mkcertweb:vX.Y.Z`.
5. Publish to Docker Hub with `./docker-build-push.sh` (needs a clean working
   tree, `docker login` and buildx). It builds linux/amd64 and linux/arm64 and
   tags `X.Y.Z`, `X.Y`, `X` and `latest`. `--dry-run` builds without pushing.
   After the push it updates the Docker Hub page (the short description in the
   script and the overview in `docs/DOCKERHUB.md`). To change only the page,
   edit `docs/DOCKERHUB.md`, commit, and run
   `./docker-build-push.sh --overview-only`.
