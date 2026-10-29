# Split-Pane Redesign ("Direction B") — Dashboard UI

**Date:** 2026-10-29
**Status:** Approved direction, pending implementation
**Owner:** Jeff Caldwell

## Goal

Replace the single-column stacked dashboard in `public/` with a denser,
business-tool layout: a fixed top bar with page tabs, and on every page a
**list/navigation pane on the left** and a **detail/work pane on the right**.
Keep the terminal identity (aqua accent, system mono, `>`/`$` prompt glyphs).

## Source of truth

- Design canvas (all explorations): https://claude.ai/artifact/TYRnDRS5Sj9j6vtV8BrQkV
- Chosen direction, checked in as static references (open in a browser or read
  as markup; they use sample data, and `{{…}}` holes are filled by the
  `renderVals()` script at the bottom of each file):
  - `2026-10-29-split-pane-redesign/SplitPane.dc.html` — certificates, dark
  - `2026-10-29-split-pane-redesign/BLight.dc.html` — certificates, light
  - `2026-10-29-split-pane-redesign/BScep.dc.html` — SCEP
  - `2026-10-29-split-pane-redesign/BSettings.dc.html` — settings
- `2026-06-21-unified-design-language-design.md` still governs tokens, fonts,
  radius and glow. Where the mockups differ from it, **that spec wins**, except
  for the deviations listed under *Decisions*.

## Decisions

| Topic | Decision |
|---|---|
| Build | No build step. Plain `<script>` files. Logic that can be tested is written as UMD-style modules (`module.exports` in Node, `window.MK.<name>` in the browser) and tested with `node --test`. |
| Font | System mono stack `var(--font-mono)` everywhere. The mockups' JetBrains Mono is **not** used (no web fonts). |
| Icons | Font Awesome is removed. Use text glyphs (`↓ ⟳ ↑ ↵ ×`) and the few inline SVGs in the mockups. CSP drops `cdnjs.cloudflare.com`. |
| Prompt glyphs | `>` in the brand and `$` before each page `h1` use a new token `--prompt` (dark `#ff6b6b`, light `#c8323f`). This is the only coral in the UI. It is a deliberate exception to the 2026-06-21 "demote coral" rule. |
| Copy style | Navigation tabs, sub-tabs and button labels are lowercase (`certificates`, `root-ca`, `download`). Section labels are uppercase with letter-spacing (`SUBJECT ALT NAMES`). |
| Pages | `index.html` (certificates), `root-ca.html`, `scep.html`, `notifications.html`, `settings.html`, `login.html`. Root CA and notifications move **off** the certificates page onto their own pages. |
| Theme | Same mechanism as today: `data-theme` on `<html>`, `localStorage['theme']`, server default from `GET /api/config/theme`. Code/snippet blocks stay dark in light mode. |
| API | **No API changes in phase 1.** The UI shows only data the API already returns. |
| Responsive | Below 900px the panes stack (list above detail) and the top bar wraps. No horizontal page scroll at 360px. |

## Screens (phase 1)

**Shell (every page except login):** brand `> mkcert_web`; tabs
`certificates · root-ca · scep · notifications · settings` (the active one is
accent-coloured and underlined, `aria-current="page"`); status dots for `mkcert`,
`CA`, `openssl` from `GET /api/status`; username from `GET /api/auth/status`;
theme toggle; `logout` (hidden when auth is disabled).

**Certificates (`index.html`)**
- Left pane: QUICK GENERATE command bar (`$ mkcert` + domains input + `--format`
  select `pem|crt|p12|p12-client` + `run ↵`); filter input (`/` focuses it);
  `↑ upload` opens an upload dialog with the existing dropzone behaviour; list
  grouped as `NEEDS ATTENTION` (expired or ≤30 days), `HEALTHY`, `READ-ONLY`
  (root CA / interface SSL / uploaded), `ARCHIVED`. Each item: status dot, name,
  format, and a meta line (`expires in 20d · 2 SANs`).
- Right pane: `$ <name>` heading, status pill, meta row (format · location ·
  created), header actions (`↓ bundle`, `pfx`, `archive` | `restore`,
  `delete` — delete only for archived, as today), sub-tabs `overview · files · notes`.
  - overview: VALIDITY card (days left, bar, issued→expires dates) and SUBJECT
    ALT NAMES card (chips + format, location, file size, SHA-256 fingerprint).
  - files: certificate and key files with individual download buttons.
  - notes: the existing notes editor (`PUT /api/certificates/:folder/:certname/notes`).
- Selection lives in the URL hash `#cert=<folder>/<name>` so it survives reload.
  With no selection, the first item in the first group is selected.
- Empty state (no certificates): the right pane explains quick generate and upload.

**Root CA (`root-ca.html`):** left pane CA summary (subject, expiry, status),
right pane details plus actions: download rootCA, install CA, generate CA (the
existing manual-generation flow), with install instructions.

**SCEP (`scep.html`):** see `BScep.dc.html`. Left: SERVICE URLs with copy
buttons, ENTERPRISE CA status, TEMPLATES. Right sub-tabs
`challenges · issued · manual enroll · mdm setup`. A new challenge password is
shown once in a banner. **There is no revoke button** (no API for it); the
mockup's revoke column is dropped.

**Notifications (`notifications.html`):** left pane channel list
(email, ntfy, webhook, monitoring) with on/off dots; right pane shows the
selected channel's status and its test actions; monitoring shows schedule,
`check now`, `start`/`stop`, and the expiring-certificates list.

**Settings (`settings.html`):** see `BSettings.dc.html`. Left pane: section
list grouped SERVER (`server`) · ACCESS (`auth`, `ratelimit`) · ALERTS (`email`,
`ntfy`, `webhook`, `monitoring`) · APPEARANCE (`theme`) with an enabled dot,
plus a `find setting…` filter over labels and config keys. Right pane: one
section's form, each field showing its `name` (config key) as a hint. A sticky
footer shows `N unsaved changes`, `discard`, `save changes`, plus the existing
`reset to defaults`, `reload`, `view running config`. The footer states that
changes take effect after a server restart (current behaviour).

**Login (`login.html`):** restyled card in the new tokens; behaviour unchanged.

## Phase 2 (separate plans, each optional)

Shown in the mockups but needing new server work, so out of phase 1:
usage snippets tab (frontend only), raw `openssl x509 -text` tab, renew,
activity log, per-certificate alert history, SCEP challenge revoke.

## Success criteria

- Every action available today is still reachable (checked by the audit in the plan).
- `npm test` passes, including the new frontend module tests and the existing
  "no inline event handlers" and CSP tests.
- Light and dark are both WCAG AA for text.
- No page requests anything outside its own origin.
