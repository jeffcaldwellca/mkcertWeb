# mkcert Web UI — GitHub Pages Terminal Landing Page

**Date:** 2026-06-20
**Status:** Approved design, pending implementation plan
**Owner:** Jeff Caldwell

## Goal

Build a high-quality single-page GitHub Pages site for the **mkcert Web UI**
project that showcases the product with an immersive "hacker terminal / Fallout
RobCo computer" aesthetic. The page is marketing-grade: it should make a strong
first impression, communicate what the product does, and drive visitors to the
GitHub repo and Docker Hub.

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Scope | Single-page showcase |
| Aesthetic intensity | Immersive CRT (boot sequence, scanlines, glow, typed text, flicker) |
| Palette | Pip-Boy green on near-black (amber held in reserve, not used by default) |
| Deployment | GitHub Pages from `/docs` folder on `main` |
| Tech | Vanilla HTML/CSS/JS, no build step |
| Fonts | Self-hosted `woff2`: **VT323** (boot/headings) + **IBM Plex Mono** (body) |
| Easter egg | Interactive command prompt **included in v1** |
| Trademark stance | Homage to RobCo/Fallout terminal — no Bethesda trademarks/logos; footer carries a "fan homage, not affiliated" line |

## Source-of-truth facts (verified from repo)

- Version: **4.1.0** (`package.json`)
- License: **GPLv3** (`LICENSE`)
- Repo: `https://github.com/jeffcaldwellca/mkcertWeb`
- Docker Hub: `https://hub.docker.com/r/jeffcaldwellca/mkcertweb`
- Screenshot asset: `public/assets/screenshot.png` (1244×529)
- Favicons exist under `public/assets/`
- Requirements: Node.js 16+, mkcert, OpenSSL
- Feature set (from README): certificate generation (multi-domain/IP), SCEP
  enrollment, enterprise security (command-injection / path-traversal
  protection, rate limiting), multiple formats (PEM/CRT/PFX), Basic + OIDC auth,
  email notifications, certificate monitoring, Docker-ready.

## Architecture

No framework, no build. Static files served directly from `/docs`.

```
docs/
  .nojekyll                  # disable Jekyll; serve statically
  index.html                 # single page, semantic sections
  assets/
    styles.css               # all styling incl. CRT layer + palette tokens
    main.js                  # boot sequence, typed text, copy buttons, easter-egg prompt
    screenshot.png           # copied from public/assets/screenshot.png
    favicon.ico, *.png       # copied/reused favicons
    fonts/
      VT323.woff2
      IBMPlexMono-Regular.woff2
      (optional IBMPlexMono-Medium.woff2)
```

### Why these boundaries

- `index.html` — content/structure only. Each section is independently readable.
- `styles.css` — all presentation. CSS custom properties define the palette and
  timing so the whole theme can be retuned from one `:root` block. CRT effects
  (scanlines, vignette, flicker, glow) live in a dedicated, clearly-commented
  block, each gated behind `prefers-reduced-motion`.
- `main.js` — progressive enhancement only. The page is fully readable with JS
  disabled; JS adds the boot animation, typed text, copy-to-clipboard, and the
  easter-egg prompt. Organized as small, named modules/functions
  (`bootSequence`, `typeText`, `initCopyButtons`, `initConsole`).

## Page flow (single vertical scroll)

1. **Boot / POST overlay** — full-screen overlay on load. Types a RobCo-style
   boot sequence (e.g. `MKCERT-OS v4.1.0`, `MEMORY OK`, `LOADING CERTIFICATE
   AUTHORITY...`, `ESTABLISHING SECURE LINK...`, `READY.`) with a blinking
   cursor, then clears to reveal the page.
   - Skippable via any key / click ("PRESS ANY KEY").
   - Under `prefers-reduced-motion`, skipped instantly (content shown immediately).
   - Shown once per session (sessionStorage flag) so navigation back isn't punished.
2. **Title bar** — sticky terminal header: `MKCERT-OS TERMINAL` · `v4.1.0` ·
   a faux status readout · blinking cursor.
3. **Hero** — large title `mkcert Web UI` (VT323), typed tagline
   (e.g. "Local TLS, minus the pain."), three terminal-style buttons:
   `[ DEPLOY VIA DOCKER ]` → repo, `[ VIEW SOURCE ]` → GitHub, `[ DOCKER HUB ]`
   → Docker Hub. Buttons use inverse-video on hover/focus.
4. **`>_ SYSTEM CAPABILITIES`** — responsive feature grid sourced from the README
   feature list (see facts above). Each cell: short label + one-line description.
5. **Display panel** — `screenshot.png` mounted in a CRT "monitor bezel" with a
   scanline overlay and subtle glow.
6. **`>_ QUICK START`** — terminal code blocks with the real commands
   (`git clone ...`, `cd mkcertWeb`, `docker-compose up -d`) styled with `> `
   prompts and a per-block **copy button** (clipboard API, with visual "COPIED"
   confirmation).
7. **`>_ MANIFEST`** — requirements (Node 16+, mkcert, OpenSSL), license (GPLv3),
   version, key links.
8. **Footer** — links, GPLv3 notice, homage disclaimer ("Fan homage to the RobCo
   terminal aesthetic; not affiliated with or endorsed by Bethesda."), blinking
   cursor sign-off.

### Always-on CRT layer

Fixed-position overlay providing scanlines + vignette + a subtle flicker/glow.
Entirely disabled under `prefers-reduced-motion`. Must not intercept pointer
events (`pointer-events: none`) and must sit above content visually but below
interactive elements' usability.

### Easter-egg command prompt (v1)

A small always-present input styled as a terminal prompt (e.g. anchored in the
footer or a dedicated `>_ CONSOLE` strip). Recognizes a handful of commands:

- `help` — lists available commands
- `about` — one-liner about the project
- `version` — prints `MKCERT-OS v4.1.0`
- `docs` / `source` / `docker` — navigate to the relevant link
- `clear` — clears console output
- `vault` (or similar) — a single hidden flavor response (the "fun" payload)

Unknown input prints `command not found: <x>`. Input is echoed; output appended
to a scrollback region. Purely client-side; no eval of arbitrary code.

## Styling specifics

- **Palette tokens** (`:root`): near-black background (`#0a0e0a`-ish), bright
  Pip-Boy phosphor green for primary text/accents (`~#1bff90`), a dimmer green
  for body copy, plus muted/border greens. Amber token defined but unused by
  default.
- **Typography:** VT323 for the boot text, headings, title bar, and big hero
  type; IBM Plex Mono for body copy, feature descriptions, and code. Both
  self-hosted `woff2`, `font-display: swap`, preloaded in `<head>`.
- **Motion:** typed-text reveal, cursor blink, button glow, subtle screen
  flicker — all gated behind `prefers-reduced-motion: no-preference`.

## Accessibility & performance

- Semantic HTML5 landmarks; skip-to-content link.
- All interactive controls keyboard-focusable with visible focus states.
- `alt` text on the screenshot; ARIA where the terminal metaphor would otherwise
  hide meaning from assistive tech (boot overlay marked decorative / skippable).
- Body-text contrast meets WCAG AA against the near-black background.
- Full `prefers-reduced-motion` path: no boot animation, no flicker, content
  immediately visible.
- Self-hosted preloaded fonts; minimal vanilla JS; no third-party network calls.
- `.nojekyll` so GitHub Pages serves the directory statically without Jekyll
  processing. Existing markdown under `/docs` is left untouched.

## Out of scope (v1)

- Multi-page docs hub / rendered documentation.
- Audio (power-on hum) — may be revisited as an opt-in toggle later.
- Custom domain / CNAME.
- Any build tooling or static-site generator.

## Success criteria

- Visiting the GitHub Pages URL shows the terminal landing page as the site root.
- Immersive CRT experience on capable browsers; clean, readable, fully-functional
  experience under `prefers-reduced-motion` and with JS disabled.
- Accurate facts (version, license, commands, links) matching the repo.
- No external network dependencies; no Bethesda trademarks/logos.
- Lighthouse: no critical accessibility failures; fast load.

## Deployment steps (post-implementation, manual)

1. Merge the `/docs` site to `main`.
2. In GitHub repo Settings → Pages, set Source = "Deploy from a branch",
   Branch = `main`, Folder = `/docs`.
3. Verify the published URL renders the landing page.
