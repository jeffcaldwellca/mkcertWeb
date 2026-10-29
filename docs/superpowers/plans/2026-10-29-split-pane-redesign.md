# Split-Pane Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `public/` dashboard in the "Direction B" split-pane layout, page by page, with no API changes.

**Architecture:** One new stylesheet (`public/css/app.css`) and a small set of plain-script modules under `public/js/`. Pure logic (API client, shell markup, certificate classification, settings diff) is written UMD-style so `node --test` can `require()` it and the browser gets it on `window.MK`. Each page is one HTML file plus one page script that wires DOM events with `addEventListener` only. Old `styles.css` / `script.js` stay in place until the last page stops using them.

**Tech Stack:** Vanilla HTML/CSS/JS (no build), Express static serving, `node:test` + `node:assert`.

**Spec:** `docs/superpowers/specs/2026-10-29-split-pane-redesign-design.md` (reference mockups in `docs/superpowers/specs/2026-10-29-split-pane-redesign/`). Also governed by `docs/superpowers/specs/2026-06-21-unified-design-language-design.md`.

## Global Constraints

- No inline event-handler attributes (`on*="…"`) in any `public/` file — CSP has `script-src-attr 'none'`; `test/security-headers.test.js` enforces this for files directly in `public/`, and Task 1 extends it to subfolders.
- No external requests from any page: no CDN `<link>`/`<script>`, no web fonts. Font is `var(--font-mono)` only.
- The `SHARED DESIGN LANGUAGE` `:root` block in `public/css/app.css` must be byte-identical to the one in `docs/assets/styles.css`.
- Every server-supplied string goes through `MK.core.escapeHtml` before reaching `innerHTML` (or use `textContent`).
- Mutating requests carry `X-CSRF-Token` and retry once on `403` with body `code: 'CSRF_INVALID'`.
- API responses are `{ success: true, ...data }` (data spread at top level) or `{ success: false, error }`; `401` bodies carry `redirectTo`.
- Expiry thresholds: expired `< 0` days, attention `≤ 30` days.
- Copy: nav tabs, sub-tabs and buttons lowercase; section labels uppercase with letter-spacing; page `h1` prefixed with `$` in `--prompt` colour.
- Theme: `data-theme` on `<html>`, `localStorage['theme']`, server default from `GET /api/config/theme` (`defaultTheme`).
- Layout stacks below 900px; no horizontal page scroll at 360px width.

## Review Focus

- A certificate with `expiry: null` (P12-only folder, unreadable cert) must still list and open, shown as state `unknown`, not crash grouping → Task 4 test `classify returns unknown when expiry missing`.
- Names/SANs containing HTML (`<img src=x>`) from an uploaded cert must render as text in list, heading, chips and hash → Task 4 `matchesQuery` test plus Task 5 step 6 manual check; Task 3 test `renderShell escapes username`.
- Session expiry mid-use (`401` with `redirectTo`) must send the user to `/login`, not show a raw error → Task 2 test `api client follows 401 redirectTo`.
- A URL hash pointing at a certificate that no longer exists (deleted elsewhere) must fall back to the first item, not a blank pane → Task 4 test `resolveSelection falls back when key missing`.
- Quick generate with stray commas/extra spaces or a pasted `mkcert` prefix (`mkcert a.test, b.test`) must produce clean domains → Task 4 test `parseQuickGenerate strips prefix and separators`.

---

## File Structure

| File | Responsibility |
|---|---|
| `public/css/app.css` | Tokens (shared block + surface tokens, dark/light), shell, panes, list items, tabs, cards, buttons, inputs, pills, command bar, dialog, toast, responsive rules. |
| `public/js/core.js` | `MK.core`: `escapeHtml`, `createApiClient`, `resolveInitialTheme`, `initTheme`, `toast`. |
| `public/js/shell.js` | `MK.shell`: `renderShell` (pure) and `mountShell` (fetches status/auth, injects header, wires theme + logout). |
| `public/js/cert-model.js` | `MK.certModel`: pure certificate logic. |
| `public/js/certificates.js` | Certificates page controller. |
| `public/js/root-ca.js`, `notifications.js`, `scep.js`, `settings.js`, `login.js` | One controller per page. |
| `public/js/settings-model.js` | `MK.settingsModel`: section groups, diff, filter. |
| `public/index.html`, `root-ca.html`, `notifications.html`, `scep.html`, `settings.html`, `login.html` | Page markup. |
| `test/frontend-*.test.js` | Tests for the pure modules and source-level guards. |

**UMD wrapper** used by every `public/js/*.js` module that exports (page controllers don't export):

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

Pages load scripts in this order: `core.js`, `shell.js`, any model, then the page controller.

---

### Task 1: Stylesheet foundation and source guards

**Files:**
- Create: `public/css/app.css`
- Create: `test/frontend-guards.test.js`
- Create: `public/styleguide.html` (temporary visual check page; deleted in Task 11)

**Interfaces:**
- Produces CSS classes later tasks use (names are fixed; look and spacing come from the mockups):
  `.app` (page root, flex column, `min-height: 100vh`), `.topbar`, `.brand`, `.brand .prompt`, `.nav-tabs`, `.nav-tab[aria-current="page"]`, `.status-dots`, `.dot` + modifiers `.dot--ok|--warn|--err|--off`,
  `.panes` (flex-wrap row), `.pane-list` (`flex: 1 1 340px`), `.pane-detail` (`flex: 999 1 560px; min-width: 0`),
  `.section-label`, `.cmdbar` (bordered input row with glow), `.list-group`, `.list-item`, `.list-item[aria-current="true"]` (inset 2px accent bar),
  `.detail-head`, `.page-title` (with `.prompt` child), `.pill` + `.pill--ok|--warn|--err|--muted`, `.subtabs`, `.subtab[aria-selected="true"]`,
  `.card`, `.card-grid` (`repeat(auto-fit, minmax(320px, 1fr))`), `.chip`, `.kv` (dl grid), `.meter` + `.meter > span`,
  `.btn`, `.btn--primary`, `.btn--danger`, `.btn--ghost`, `.input`, `.select`, `.field`, `.field-key` (config-key hint), `.switch`,
  `.codeblock` (always dark), `.log` (mono activity lines), `.banner` + `.banner--ok|--warn|--err`, `.empty`, `.dialog` (for `<dialog>`), `.toast-stack`, `.toast` + `--ok|--err|--info`, `.sticky-footer`, `.sr-only`.
- Token names: shared block as-is; surface tokens `--bg`, `--bg-pane`, `--bg-raised`, `--bg-inset`, `--border`, `--border-strong`, `--text`, `--text-strong`, `--text-muted`, `--info` (`#8cc8ff` dark / `#0550ae` light), `--prompt` (`#ff6b6b` / `#c8323f`). Light values under `[data-theme="light"]`, using the palette in `BLight.dc.html`.

- [ ] **Step 1: Write the failing guard tests** in `test/frontend-guards.test.js`

```js
// helper: walk public/ recursively, return [{ rel, src }] for .html/.js/.css
test('shared design-language block is identical in app.css and docs styles', () => {
  const block = (s) => s.slice(s.indexOf('/* ===== SHARED DESIGN LANGUAGE'), s.indexOf('/* ===== END SHARED DESIGN LANGUAGE ===== */'));
  const a = block(read('public/css/app.css'));
  assert.ok(a.length > 100);
  assert.strictEqual(a, block(read('docs/assets/styles.css')));
});
test('no inline event handlers anywhere under public/ (including subfolders)', () => {
  for (const f of walk('public')) assert.doesNotMatch(f.src, /\son[a-z]+\s*=\s*["']/i, f.rel);
});
test('no external URLs in redesigned pages', () => {
  // pages listed in REDESIGNED; each task adds its page here
  for (const rel of REDESIGNED) assert.doesNotMatch(read(rel), /(src|href)=["']https?:\/\//i, rel);
});
test('app.css defines light-theme overrides for every surface token', () => {
  const css = read('public/css/app.css');
  for (const t of ['--bg', '--bg-pane', '--text', '--border', '--info', '--prompt', '--accent'])
    assert.match(css, new RegExp(`\\[data-theme="light"\\][^}]*${t}:`, 's'), t);
});
```
`REDESIGNED` starts as `['public/styleguide.html']`.

- [ ] **Step 2: Run** `node --test test/frontend-guards.test.js` — Expected: FAIL (app.css and styleguide.html missing).

- [ ] **Step 3: Write `public/css/app.css`** with the shared block copied verbatim from `docs/assets/styles.css` lines 6–23 (banner comments included), the surface tokens above, and every class in the Interfaces list. Breakpoint `@media (max-width: 900px)`: `.pane-list` loses its right border and gets a bottom border. Focus: `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`. `prefers-reduced-motion` disables transitions.

- [ ] **Step 4: Write `public/styleguide.html`** linking only `css/app.css`, showing one of each class, with a static theme-switch link `?theme=light` handled by a 3-line inline `<script>` block (inline blocks are allowed; attributes are not).

- [ ] **Step 5: Run** `npm test` — Expected: all PASS. Open `/styleguide.html` in both themes and compare against `SplitPane.dc.html` / `BLight.dc.html`.

- [ ] **Step 6: Commit** `git add public/css/app.css public/styleguide.html test/frontend-guards.test.js && git commit -m "feat(ui): split-pane design tokens and component styles"`

---

### Task 2: Core module (API client, escaping, theme, toast)

**Files:**
- Create: `public/js/core.js`
- Create: `test/frontend-core.test.js`

**Interfaces:**
- Produces `MK.core`:
  - `escapeHtml(value: any) -> string` (same mapping as `public/script.js:11`; `null`/`undefined` → `''`).
  - `createApiClient({ fetchImpl = fetch, base = '/api', onRedirect = (url) => { location.href = url } }) -> { get(path), post(path, body?), put(path, body?), del(path), upload(path, formData) }`. Each returns the parsed JSON body (data is spread at top level). Non-OK → throws `Error(body.error || body.message || 'HTTP <status>')` with `.status` and `.body`. `401` with `redirectTo` → calls `onRedirect(redirectTo)` and throws. CSRF token fetched lazily from `GET /api/csrf-token` (`csrfToken` field) before the first mutating call; one retry after refetch on `403` + `code === 'CSRF_INVALID'`. `upload` sends `FormData` without a `Content-Type` header. All requests use `credentials: 'include'`.
  - `resolveInitialTheme({ stored: string|null, serverDefault: string|null }) -> 'dark'|'light'` (stored wins; invalid values ignored; fallback `'dark'`).
  - `initTheme(api) -> Promise<void>` (reads storage, calls `GET /api/config/theme` only when nothing stored, sets `data-theme`).
  - `toggleTheme() -> 'dark'|'light'` (flips attribute, writes storage).
  - `toast(message: string, type: 'ok'|'err'|'info' = 'info', { timeout = 5000 } = {}) -> void` (appends to a lazily created `.toast-stack`, `role="status"`, text via `textContent`).

- [ ] **Step 1: Write failing tests** using a fake `fetchImpl` that records calls and returns queued `{ status, body }` responses:
  - `escapeHtml escapes all five characters and blanks null`: `escapeHtml('<a href="x">\'&') === '&lt;a href=&quot;x&quot;&gt;&#39;&amp;'`; `escapeHtml(null) === ''`.
  - `get returns parsed body`: `/api/certificates` → `{ success:true, certificates:[1] }` → result `.certificates` deep-equals `[1]`; no csrf call made.
  - `post fetches csrf once and sends header`: two posts → exactly one `/api/csrf-token` call; both posts carry `X-CSRF-Token: t1`.
  - `post retries once on CSRF_INVALID`: first `403 {code:'CSRF_INVALID'}`, refetch returns `t2`, retry `200` → resolves; retry carries `t2`; total post attempts 2.
  - `api client follows 401 redirectTo`: `401 {redirectTo:'/login'}` → `onRedirect` called with `'/login'` and promise rejects.
  - `error message comes from body.error`: `400 {success:false,error:'Identifier is required'}` → rejects with that message and `.status === 400`.
  - `resolveInitialTheme`: `({stored:'light'})→'light'`, `({stored:null,serverDefault:'light'})→'light'`, `({stored:'neon',serverDefault:null})→'dark'`.

- [ ] **Step 2: Run** `node --test test/frontend-core.test.js` — Expected: FAIL (`Cannot find module '../public/js/core.js'`).
- [ ] **Step 3: Implement `public/js/core.js`** with the UMD wrapper. `initTheme`/`toggleTheme`/`toast` touch `document`/`localStorage` only inside the function body so `require()` works in Node.
- [ ] **Step 4: Run** `node --test test/frontend-core.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(ui): shared core module with CSRF-aware API client"` (add both files).

---

### Task 3: App shell (top bar)

**Files:**
- Create: `public/js/shell.js`
- Create: `test/frontend-shell.test.js`

**Interfaces:**
- Consumes: `MK.core.escapeHtml`, `MK.core.createApiClient`, `MK.core.initTheme`, `MK.core.toggleTheme`.
- Produces `MK.shell`:
  - `NAV = [{ id:'certificates', href:'/' }, { id:'root-ca', href:'/root-ca.html' }, { id:'scep', href:'/scep.html' }, { id:'notifications', href:'/notifications.html' }, { id:'settings', href:'/settings.html' }]`
  - `renderShell({ active: string, status: { mkcertInstalled?, caExists?, opensslAvailable? } | null, auth: { authEnabled: boolean, authenticated?: boolean, username?: string } | null }) -> string` — header HTML per spec: brand `<span class="prompt">&gt;</span> mkcert<span>_web</span>`, `<nav aria-label="Primary">` with one `<a class="nav-tab">` per `NAV` entry (label = id), `aria-current="page"` on the active one; three `.dot` items (`--ok` true, `--err` false, `--off` when status is null); username (escaped) and `<button data-shell="logout">logout</button>` only when `auth.authEnabled`; `<button data-shell="theme" aria-label="Toggle theme">`.
  - `mountShell(active: string) -> Promise<{ api, auth, status }>` — renders immediately with nulls, then fetches `GET /api/status` and `GET /api/auth/status` in parallel and re-renders; wires theme toggle and logout (`POST /api/auth/logout`, then `location.href = body.redirectTo || '/login'`). Pages call this first and reuse the returned `api`.

Field names are verified: `GET /api/status` returns top-level `mkcertInstalled`, `opensslAvailable`, `caExists` (`src/routes/system.js:89`). `GET /api/auth/status` returns `{ authenticated, username, authEnabled }` (`server.js:424`).

- [ ] **Step 1: Write failing tests:**
  - `renderShell marks the active tab`: `active:'scep'` → exactly one `aria-current="page"` and it is on the `href="/scep.html"` link.
  - `renderShell escapes username`: username `<b>x</b>` → output contains `&lt;b&gt;x&lt;/b&gt;` and not `<b>`.
  - `renderShell hides logout when auth disabled`: `auth:{authEnabled:false}` → no `data-shell="logout"`.
  - `renderShell shows unknown dots while loading`: `status:null` → three `dot--off`.
- [ ] **Step 2: Run** `node --test test/frontend-shell.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement `public/js/shell.js`.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(ui): shared top-bar shell"`

---

### Task 4: Certificate model

**Files:**
- Create: `public/js/cert-model.js`
- Create: `test/frontend-cert-model.test.js`

**Interfaces:**
- Consumes: the `GET /api/certificates` item shape (`name`, `folder`, `isArchived`, `isInterfaceSSL`, `canEdit`, `format`, `expiry`, `domains`, `fingerprint`, `note`, `cert {filename,size,modified}`, `key {filename}`).
- Produces `MK.certModel`:
  - `ATTENTION_DAYS = 30`
  - `locationOf(cert) -> { folderParam: string, label: string, readOnly: boolean, isRootCA: boolean }` — the exact branching now in `public/script.js:670-694` (interface-ssl / dated folder / root-ca / legacy), moved here unchanged.
  - `certKey(cert) -> string` = `locationOf(cert).folderParam + '/' + cert.name`.
  - `classify(cert, now: Date) -> { state: 'valid'|'attention'|'expired'|'unknown', daysLeft: number|null }` — `daysLeft = Math.ceil((expiry - now) / 86400000)` (same formula as `script.js:647`).
  - `groupCertificates(certs, now) -> Array<{ id: 'attention'|'healthy'|'readonly'|'archived', label: string, items: cert[] }>` — order attention, healthy, readonly, archived; archived wins over everything, then read-only, then state (`expired`/`attention` → attention, `valid`/`unknown` → healthy); empty groups omitted; inside a group sort by `daysLeft` ascending, `null` last, then by name. Labels: `NEEDS ATTENTION`, `HEALTHY`, `READ-ONLY`, `ARCHIVED`.
  - `metaLine(cert, now) -> string` — `expired 17d ago` / `expires in 20d` / `442d left` / `expiry unknown`, then ` · N SANs` (`1 SAN` singular).
  - `matchesQuery(cert, query: string) -> boolean` — case-insensitive substring over name, domains, format, folder label; empty query matches.
  - `parseQuickGenerate(text: string) -> string[]` — trims, drops a leading `mkcert` token, splits on whitespace and commas, drops empties and duplicates (keeps first-seen order).
  - `resolveSelection(groups, hashKey: string|null) -> string|null` — `hashKey` if any item has that key, else the first item's key, else `null`.
  - `parseHash(hash: string) -> string|null` / `formatHash(key: string) -> string` for `#cert=<encodeURIComponent(key)>`.

- [ ] **Step 1: Write failing tests** with `now = new Date('2026-10-29T12:00:00Z')`:
  - `classify buckets by days`: expiry `+20d` → `{state:'attention', daysLeft:20}`; `-17d` → `expired`; `+400d` → `valid`; `+30d` → `attention`; `+31d` → `valid`.
  - `classify returns unknown when expiry missing`: `{expiry:null}` → `{state:'unknown', daysLeft:null}`.
  - `groupCertificates orders groups and items`: fixture of an archived-expired cert, an interface-ssl cert, a 7d cert, a -29d cert, a 442d cert → group ids `['attention','healthy','readonly','archived']`; attention order `[-29d, 7d]`.
  - `locationOf matches existing folder rules`: `{folder:'2026-01-02'}` → `{folderParam:'2026-01-02', readOnly:false}`; `{isInterfaceSSL:true}` → `{folderParam:'interface-ssl', readOnly:true}`; `{name:'mkcert-rootCA'}` → `{folderParam:'root-ca', isRootCA:true}`; `{canEdit:false}` → `{folderParam:'legacy', readOnly:true}`.
  - `parseQuickGenerate strips prefix and separators`: `'mkcert  a.test, *.a.test,,a.test 10.0.0.1 '` → `['a.test','*.a.test','10.0.0.1']`; `''` → `[]`.
  - `matchesQuery`: matches on SAN `'*.api.dev.local'` with query `'API.dev'`; a name of `'<img src=x>'` matches query `'img'` (string, not markup).
  - `metaLine`: `'expires in 20d · 2 SANs'`, `'expired 17d ago · 1 SAN'`, `'expiry unknown · 0 SANs'`.
  - `resolveSelection falls back when key missing`: hash `'2026-01-02/gone'` → first item's key; empty groups → `null`.
  - `hash round-trip`: `parseHash(formatHash('2026-01-02/a b')) === '2026-01-02/a b'`; `parseHash('#other=1') === null`.
- [ ] **Step 2: Run** `node --test test/frontend-cert-model.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement `public/js/cert-model.js`.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(ui): certificate classification and grouping model"`

---

### Task 5: Certificates page

**Files:**
- Modify (rewrite): `public/index.html`
- Create: `public/js/certificates.js`
- Modify: `test/frontend-guards.test.js` (add `public/index.html` to `REDESIGNED`)
- Delete: `public/script.js` — only after Step 5's audit shows every action has moved here, to Task 6 (Root CA) or Task 7 (Notifications). `index.html` stops loading it in this task, so Root CA and notification functions are copied out to `public/js/legacy/root-ca-actions.js` and `public/js/legacy/notification-actions.js` for Tasks 6–7 to adopt, then deleted in those tasks.

**Interfaces:**
- Consumes: `MK.shell.mountShell('certificates')`, `MK.core.*`, all of `MK.certModel`.
- Endpoints (unchanged): `GET /api/certificates`; `POST /api/execute` `{ command:'generate', input: domains.join(' '), format }`; `POST /api/upload` (multipart field name as in `script.js:1315-1360`); `GET /api/download/cert/:folder/:filename`, `/key/:folder/:filename`, `/bundle/:folder/:certname`; `POST /api/generate/pfx/:folder/:certname` (password prompt flow from `script.js:1620-1745`, moved into a `<dialog>`); `POST …/archive`, `POST …/restore`, `DELETE /api/certificates/:folder/:certname`; `PUT …/notes`.

- [ ] **Step 1: Write the page markup** per spec "Certificates" and `SplitPane.dc.html`: `<header id="shell">`, `.panes` → `.pane-list` (QUICK GENERATE `form#quick-gen` with `input#quick-gen-domains` and `select#quick-gen-format` with `pem|crt|p12|p12-client` values, labels as in spec; `input#cert-filter` with `.sr-only` label; `button#open-upload`; `div#cert-groups`) and `.pane-detail` (`div#cert-detail`). `<dialog id="upload-dialog">` holding the dropzone + file list + progress markup (ids from current `index.html` upload section, so the moved upload code works unchanged). `<dialog id="pfx-dialog">` with password + confirm inputs. `<div id="cert-empty" hidden>` empty state. Scripts: `js/core.js`, `js/shell.js`, `js/cert-model.js`, `js/certificates.js`. Stylesheet: `css/app.css` only.

- [ ] **Step 2: Implement `public/js/certificates.js`** as an IIFE with these internal functions (names fixed so reviewers can find them):
  - `load()` — fetch, store `state.certs`, `render()`.
  - `render()` — filters with `matchesQuery`, groups, resolves selection from `location.hash`, calls `renderList(groups, selectedKey)` and `renderDetail(cert)`; shows `#cert-empty` when there are no certificates at all.
  - `renderList` — builds `.list-group` blocks; each item is `<a class="list-item" href="#cert=…">` with `aria-current="true"` when selected. Clicking only changes the hash; a `hashchange` listener calls `render()`.
  - `renderDetail(cert)` — heading, status pill (`pill--ok|--warn|--err|--muted` from state), meta row, actions with `data-action` attributes (`bundle`, `pfx`, `archive`, `restore`, `delete`, `download-cert`, `download-key`), sub-tabs `overview|files|notes` (selected tab kept in `state.tab`, `role="tablist"`/`tab`/`tabpanel` with `aria-controls`). One delegated `click` listener on `#cert-detail` dispatches on `data-action`. Show `pfx` only when there is a key and the cert isn't read-only; `archive` only for editable non-archived; `restore` and `delete` only for archived (current rules in `script.js:752-772`).
  - `onQuickGenerate(e)` — `parseQuickGenerate`; empty → `toast('enter at least one domain','err')`; else POST, `toast('generated: …','ok')`, `load()`, then select the newest cert whose domains include the first input domain.
  - Notes: move `renderNoteContent`/`openNoteEditor`/`saveNote` from `script.js:288-335` into the notes tab.
  - Upload: move `setupUploadEventListeners` … `displayUploadResults` (`script.js:1164-1532`) as-is, switching to `api.upload`, and call `load()` on success.
  - Keyboard: `/` (when focus isn't in an input) focuses `#cert-filter`; `Escape` in the filter clears it.
- [ ] **Step 3: Run** `npm test` — Expected: PASS (guards include `index.html`).
- [ ] **Step 4: Manual check** with `npm run dev`, auth disabled, at least one generated, one uploaded, one archived and one expired cert (the uploaded one can be any expired PEM):
  - Groups and order match the spec; selecting updates the hash; reloading keeps the selection; a stale hash falls back to the first item.
  - Quick generate creates a cert and selects it; every format in the select works.
  - Each `data-action` works and the right buttons show for editable, read-only and archived certs.
  - Notes save and persist after reload. Upload dialog: drag-drop and browse both work, and the list refreshes.
  - At 360px wide the panes stack and nothing scrolls sideways. Both themes are readable.
- [ ] **Step 5: Parity audit.** Run `grep -nE "^(async )?function " public/script.js` and record each function's new home in the commit body (a function in this task, `legacy/root-ca-actions.js`, `legacy/notification-actions.js`, or "dropped: <reason>"). Then delete `public/script.js`.
- [ ] **Step 6: Escaping check.** Upload a cert whose CN/SAN contains `<img src=x onerror=alert(1)>` (create it with `openssl req -x509 -subj '/CN=<img src=x>' …`). The name must show as literal text in the list, heading and chips, and nothing should run.
- [ ] **Step 7: Commit** `git commit -m "feat(ui): split-pane certificates page"` (body: parity table from Step 5).

---

### Task 6: Root CA page

**Files:**
- Create: `public/root-ca.html`, `public/js/root-ca.js`
- Delete: `public/js/legacy/root-ca-actions.js`
- Modify: `test/frontend-guards.test.js` (add page)

**Interfaces:**
- Consumes: `mountShell('root-ca')`. Endpoints: `GET /api/rootca/info`, `GET /api/status` (`caExists`, `caRoot`, `autoGenerated`), `GET /api/download/rootca`, `POST /api/install-ca`, `POST /api/generate-ca`. The behaviour of `loadRootCAInfo`, `showRootCA`, `showManualCAGeneration`, `handleGenerateCA`, `handleInstallCA`, `waitForCAInstallation` is kept and their markup is replaced.

- [ ] **Step 1: Markup**: `.pane-list` shows CA SUMMARY (subject, expiry pill using `classify` on `{expiry}`, trusted/installed dot) and an INSTALL GUIDE (per-OS steps as a `.log` list, copied from the existing root CA description text). `.pane-detail` shows `$ root-ca`, actions `↓ rootCA.pem`, `install`, `generate` (shown only when `caExists` is false, as today), a `.kv` details card, and a result area for generate/install output.
- [ ] **Step 2: Implement `root-ca.js`** by moving the functions listed above out of `legacy/root-ca-actions.js` and switching to `api` and `toast`.
- [ ] **Step 3: Run** `npm test` — Expected: PASS.
- [ ] **Step 4: Manual check**: with an existing CA, info and download work. With `CAROOT` pointed at an empty temp dir, generate then install succeed and the page refreshes into the "CA exists" state.
- [ ] **Step 5: Commit** `git commit -m "feat(ui): root-ca page"`

---

### Task 7: Notifications page

**Files:**
- Create: `public/notifications.html`, `public/js/notifications.js`
- Delete: `public/js/legacy/notification-actions.js`
- Modify: `test/frontend-guards.test.js`

**Interfaces:**
- Consumes: `mountShell('notifications')`, `MK.certModel.metaLine`. Endpoints: `GET /api/email/status`, `POST /api/email/test`, `POST /api/email/verify`, `GET /api/ntfy/status`, `POST /api/ntfy/test`, `GET /api/webhook/status`, `POST /api/webhook/test`, `GET /api/monitoring/status`, `POST /api/monitoring/check|start|stop`, `GET /api/monitoring/expiring`.

- [ ] **Step 1: Markup**: `.pane-list` with four `.list-item` links `#channel=email|ntfy|webhook|monitoring`, each with an on/off `.dot`. `.pane-detail` shows the selected channel. Email: status `.kv`, `verify smtp`, `send test`. Ntfy and webhook: status `.kv` and `send test`. Monitoring: schedule, thresholds, running state, `check now`, then `start` or `stop`, and an EXPIRING list. Every channel has a `configure →` link to `/settings.html#section=<id>`. Test and verify results go into a `.log` block (`ok` or `err` lines with timestamp) as well as a toast.
- [ ] **Step 2: Implement `notifications.js`**: load all four statuses in parallel at startup (they feed the dots), and route on `hashchange`.
- [ ] **Step 3: Run** `npm test` — Expected: PASS.
- [ ] **Step 4: Manual check**: with email disabled, then with a bad SMTP host, both show readable errors. Start/stop toggles the buttons. The expiring list matches the certificates page's NEEDS ATTENTION group.
- [ ] **Step 5: Commit** `git commit -m "feat(ui): notifications page"`

---

### Task 8: SCEP page

**Files:**
- Modify (rewrite): `public/scep.html` (drop the inline `<script>` block at lines 467–1016)
- Create: `public/js/scep.js`
- Modify: `test/frontend-guards.test.js`

**Interfaces:**
- Consumes: `mountShell('scep')`. Endpoints: `GET /api/scep/config`, `GET /api/scep/enterprise-ca/status`, `GET /api/scep/templates`, `POST /api/scep/challenge` `{ identifier, expiresIn }` → `{ identifier, challengePassword, expiresAt }`, `GET /api/scep/challenges` → `{ challenges: [{ identifier, expiresAt, used, expired }] }`, `POST /api/scep/certificate`, `POST /api/scep/validate-upn`, `GET /api/scep/certificates`.

- [ ] **Step 1: Markup** per `BScep.dc.html`, with three changes. Drop the revoke column. Drop the masked-password column (the list endpoint returns no passwords). The challenge state pill reads `used` / `expired` / `pending`. The `--ttl` select values are `3600|7200|86400|604800`, labelled `1h|2h|24h|7d`. Sub-tab panels:
  - challenges: command bar, a one-time password banner (`.banner--ok` with a copy button and "shown once"), and the active table.
  - issued: SCEP certificates table.
  - manual enroll: the existing form fields and ids from current `scep.html:358-405`, keeping the UPN field shown only for `M365User`.
  - mdm setup: the existing integration guide content.
  Keep the "simplified SCEP for dev & test" note in the left pane.
- [ ] **Step 2: Implement `scep.js`** by moving the inline functions (`setupTemplateHandling` … `loadSCEPCertificates`) and replacing their local `authedFetch`, `checkAuth`, theme and `showAlert` with `MK.core` / `mountShell`. Copy buttons use `navigator.clipboard.writeText`, falling back to selecting the text when it's unavailable (plain HTTP).
- [ ] **Step 3: Run** `npm test` — Expected: PASS.
- [ ] **Step 4: Manual check**: create a challenge (the banner shows the password, and it is absent after reload). The table updates and expiry shows. Manual enroll works with the `User` and `M365User` templates, including the UPN validation message. Copy works over plain `http://localhost`.
- [ ] **Step 5: Commit** `git commit -m "feat(ui): split-pane SCEP page"`

---

### Task 9: Settings page

**Files:**
- Create: `public/js/settings-model.js`, `test/frontend-settings-model.test.js`
- Modify (rewrite): `public/settings.html` (keep every `<input>/<select>` `name` and `id` exactly; `src/utils/settingsSecurity.js` mirrors them)
- Move + modify: `public/settings.js` → `public/js/settings.js`
- Modify: `test/frontend-guards.test.js`

**Interfaces:**
- Produces `MK.settingsModel`:
  - `SECTION_GROUPS = [{ label:'SERVER', sections:['server'] }, { label:'ACCESS', sections:['auth','ratelimit'] }, { label:'ALERTS', sections:['email','ntfy','webhook','monitoring'] }, { label:'APPEARANCE', sections:['theme'] }]` (ids equal today's `data-panel` values).
  - `ENABLE_KEY = { auth:'auth.enabled', email:'email.enabled', ntfy:'ntfy.enabled', webhook:'webhook.enabled', monitoring:'monitoring.enabled' }` (sections without a key always show `dot--ok`).
  - `flatten(obj, prefix = '') -> Record<string, any>` (dotted keys, arrays kept as values).
  - `diffSettings(saved: object, current: object) -> string[]` — sorted dotted keys whose values differ (compare flattened, `String(a) !== String(b)`; a key missing on one side counts).
  - `matchesSetting({ label, key }, query) -> boolean` (case-insensitive over both).
  - `sectionFromHash(hash) -> string|null` for `#section=<id>`, returning only ids in `SECTION_GROUPS`.
- Consumes: `mountShell('settings')`. Endpoints unchanged (`GET/POST/DELETE /api/settings`, `GET /api/settings/running`, notification test endpoints already used by `settings.js:454-500`).

- [ ] **Step 1: Write failing tests:**
  - `diffSettings finds nested changes`: saved `{email:{smtp:{port:587,host:'a'}}}`, current `{email:{smtp:{port:'587',host:'b'}}}` → `['email.smtp.host']`.
  - `diffSettings counts added and removed keys`: `{a:1}` vs `{b:1}` → `['a','b']`.
  - `sectionFromHash`: `'#section=ntfy'` → `'ntfy'`; `'#section=../x'` → `null`.
  - `matchesSetting`: `{label:'Host', key:'email.smtp.host'}` matches `'smtp'` and `'HOST'`, not `'ntfy'`.
- [ ] **Step 2: Run** `node --test test/frontend-settings-model.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement `settings-model.js`.** Run again — Expected: PASS.
- [ ] **Step 4: Markup** per `BSettings.dc.html`. Section nav is built from `SECTION_GROUPS`. Each existing panel becomes a `<section data-section="<id>" hidden>` with its fields regrouped into `<fieldset>`s. Each field's label gets a `<span class="field-key">` showing its `name`. The sticky footer has `#dirty-count`, `discard`, `save changes`, `reset to defaults`, `reload`, `view running config`, and the line "changes apply after a server restart". The running-config modal becomes a `<dialog>`.
- [ ] **Step 5: Adapt `js/settings.js`**: replace local `escapeHtml`/`authedFetch`/`initTheme`/`initAuth`/`showAlert` with `MK.core`/`mountShell`. Keep `getFormData`/`populateForm`. Keep a `saved` snapshot after load and save. On every `input`/`change`, set `#dirty-count` from `diffSettings(saved, getFormData()).length` and mark sections with unsaved changes. `discard` restores `saved`. Warn on `beforeunload` while dirty. Navigation uses `#section=`, and the filter hides non-matching fields and sections.
- [ ] **Step 6: Run** `npm test` — Expected: PASS (includes `test/settings-security.test.js`, which must stay green).
- [ ] **Step 7: Manual check**: edit two fields in different sections (count shows 2, then discard brings it back to 0). Save, reload, and the values persist. `/notifications.html` "configure →" links open the right section. Reset and view running config still work.
- [ ] **Step 8: Commit** `git commit -m "feat(ui): split-pane settings with dirty tracking"`

---

### Task 10: Login page

**Files:**
- Modify: `public/login.html` (move its inline script to `public/js/login.js`, behaviour unchanged)
- Modify: `test/frontend-guards.test.js`

- [ ] **Step 1: Restyle**: a centred `.card` (max-width 380px) with the brand, `$ login`, username and password `.field`s, a primary `sign in` button, and the OIDC button when enabled (same condition as today). Errors from `?error=` render in a `.banner--err` via `textContent`. Load only `css/app.css`, `js/core.js` (for theme) and `js/login.js`. No shell.
- [ ] **Step 2: Run** `npm test` — Expected: PASS.
- [ ] **Step 3: Manual check** with `ENABLE_AUTH=true`: a bad password shows the error, a good one lands on `/`, and logout from the shell returns here. Both themes.
- [ ] **Step 4: Commit** `git commit -m "feat(ui): restyle login"`

---

### Task 11: Remove the old UI and tighten CSP

**Files:**
- Delete: `public/styles.css`, `public/styleguide.html`, `public/js/legacy/` (should already be empty)
- Modify: `src/config/securityHeaders.js` (remove `https://cdnjs.cloudflare.com` from `style-src` and `font-src`; update the comment)
- Modify: `test/security-headers.test.js`, `test/frontend-guards.test.js`
- Modify: `README.md` (screenshots and the feature list's mention of page layout), `public/assets/screenshot.png` (new capture of the certificates page, dark)
- Modify: the `SHARED DESIGN LANGUAGE` banner comment in both stylesheets, which says "keep in sync with the other stylesheet", so it names `public/css/app.css` and `docs/assets/styles.css` explicitly (identical edit in both, so the Task 1 test stays green)

- [ ] **Step 1: Write failing tests:** in `security-headers.test.js`, `CSP allows no third-party origins` (`assert.doesNotMatch(csp, /cdnjs/)`). In `frontend-guards.test.js`, replace `REDESIGNED` with "every `.html` under `public/`" and add `no page references styles.css or font-awesome`.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL on both new tests.
- [ ] **Step 3: Make the deletions and edits** listed under Files.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Full click-through** in both themes and at 360px and 1440px widths: every page, and every action from the Task 5 parity table. Check DevTools Network shows no request to any other origin, and the console shows no CSP violations.
- [ ] **Step 6: Commit** `git commit -m "chore(ui): remove legacy stylesheet, drop CDN from CSP"`

---

## Phase 2 (not in this plan)

Each item needs its own short spec and plan when picked up. Listed so nobody builds them by accident in phase 1:

1. **Usage snippets tab** (frontend only): `MK.snippets.build(kind: 'nginx'|'caddy'|'node'|'docker', cert) -> string`, pure and tested; adds a `usage` sub-tab.
2. **Raw tab**: new `GET /api/certificates/:folder/:certname/text` returning `openssl x509 -noout -text` output (use the path validation in `src/security`).
3. **Renew**: `POST /api/certificates/:folder/:certname/renew`. Regenerates with the same domains and format, then archives the old cert.
4. **Activity log and alert history**: an append-only event store plus `GET /api/activity?cert=<key>`, written to by generate, upload, archive, restore, delete, SCEP enroll and monitoring alerts.
5. **SCEP challenge revoke**: `DELETE /api/scep/challenge/:identifier`.
