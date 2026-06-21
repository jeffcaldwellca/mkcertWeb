# Terminal-Themed GitHub Pages Landing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an immersive "Fallout RobCo terminal" single-page GitHub Pages site for the mkcert Web UI, served from `/docs` on `main`.

**Architecture:** Vanilla static site — one `index.html`, one `styles.css`, plus small vanilla JS modules. CRT effects are pure CSS gated behind `prefers-reduced-motion`. The only unit-tested logic is the easter-egg console command parser, isolated in a UMD module so it runs in the browser *and* under the project's `node --test` runner. Everything else is verified by serving the page locally.

**Tech Stack:** HTML5, CSS3 (custom properties, gradients, keyframes), vanilla ES, self-hosted `woff2` fonts (VT323 + IBM Plex Mono via `@fontsource` files), `node:test` for the parser.

## Global Constraints

Every task implicitly includes these (verbatim from the spec):

- **No external network calls** — self-host fonts; no CDNs, no Google Fonts, no analytics.
- **No Bethesda trademarks or logos** — homage only; footer carries "Fan homage … not affiliated with or endorsed by Bethesda."
- **Palette:** Pip-Boy green on near-black. Amber token may be defined but stays **unused by default**.
- **No build step** — files are served as-authored from `/docs`.
- **Fonts:** VT323 for boot/headings/title; IBM Plex Mono for body/code. Self-hosted `woff2`, `font-display: swap`, preloaded in `<head>`.
- **`prefers-reduced-motion`** fully supported (no boot animation, no flicker, content immediately visible). Page must remain readable and navigable with **JavaScript disabled**.
- **WCAG AA** contrast for body text against the background.
- **Facts (must be exact):** version `4.1.0`; license `GPLv3`; repo `https://github.com/jeffcaldwellca/mkcertWeb`; Docker Hub `https://hub.docker.com/r/jeffcaldwellca/mkcertweb`; requirements Node.js 16+, mkcert, OpenSSL.
- **`docs/.nojekyll`** present so Pages serves statically; existing markdown under `/docs` is untouched.
- **Commits:** one per task; conventional-commit messages; **no `Co-Authored-By` trailer**.

**Local preview command (used in every task's verification):**
```bash
python3 -m http.server 8080 --directory docs
# then open http://localhost:8080/
```

---

## File Structure

```
docs/
  .nojekyll
  index.html                       # all sections; semantic landmarks
  assets/
    styles.css                     # design system + CRT layer + all sections
    main.js                        # boot sequence, typed text, copy buttons, console wiring (DOM)
    console-commands.js            # UMD: pure runCommand() — browser global + CommonJS export
    screenshot.png                 # copied from public/assets/screenshot.png
    favicon.ico                    # copied from public/assets/
    favicon-32x32.png              # copied from public/assets/
    apple-touch-icon.png           # copied from public/assets/
    site.webmanifest               # copied from public/assets/ (icon paths fixed to ./)
    FONT-LICENSES.txt              # OFL notices for VT323 + IBM Plex Mono
    fonts/
      vt323-latin-400-normal.woff2
      ibm-plex-mono-latin-400-normal.woff2
      ibm-plex-mono-latin-500-normal.woff2
test/
  console-commands.test.js         # node:test for runCommand()
```

---

## Task 1: Scaffold, assets, fonts, and a page that serves

**Files:**
- Create: `docs/.nojekyll`
- Create: `docs/index.html`
- Create: `docs/assets/styles.css`
- Create: `docs/assets/fonts/*.woff2` (downloaded)
- Create: `docs/assets/FONT-LICENSES.txt`
- Copy: `public/assets/screenshot.png`, `favicon.ico`, `favicon-32x32.png`, `apple-touch-icon.png`, `site.webmanifest` → `docs/assets/`

**Interfaces:**
- Produces: a served `docs/index.html` with linked `assets/styles.css`; the `:root` design tokens and `@font-face` rules consumed by all later tasks.

- [ ] **Step 1: Create `docs/.nojekyll` and copy binary assets**

```bash
touch docs/.nojekyll
mkdir -p docs/assets/fonts
cp public/assets/screenshot.png docs/assets/screenshot.png
cp public/assets/favicon.ico docs/assets/favicon.ico
cp public/assets/favicon-32x32.png docs/assets/favicon-32x32.png
cp public/assets/apple-touch-icon.png docs/assets/apple-touch-icon.png
cp public/assets/site.webmanifest docs/assets/site.webmanifest
```

- [ ] **Step 2: Download self-hosted fonts** (OFL, from `@fontsource` mirrors on unpkg)

```bash
cd docs/assets/fonts
curl -fsSL -o vt323-latin-400-normal.woff2 \
  https://unpkg.com/@fontsource/vt323@5/files/vt323-latin-400-normal.woff2
curl -fsSL -o ibm-plex-mono-latin-400-normal.woff2 \
  https://unpkg.com/@fontsource/ibm-plex-mono@5/files/ibm-plex-mono-latin-400-normal.woff2
curl -fsSL -o ibm-plex-mono-latin-500-normal.woff2 \
  https://unpkg.com/@fontsource/ibm-plex-mono@5/files/ibm-plex-mono-latin-500-normal.woff2
cd -
# Verify all three are real woff2 (wOF2 magic), not HTML error pages:
file docs/assets/fonts/*.woff2
```
Expected: each reported as `Web Open Font Format (Version 2)`. If any is HTML/empty, the download failed — re-fetch (try `@fontsource/vt323@5.0.12` pinned) before continuing.

- [ ] **Step 3: Add font license attribution** — create `docs/assets/FONT-LICENSES.txt`

```text
Bundled fonts (self-hosted), used under the SIL Open Font License 1.1:

- VT323 — Copyright The VT323 Project Authors.
  https://github.com/google/fonts/tree/main/ofl/vt323
- IBM Plex Mono — Copyright IBM Corp.
  https://github.com/IBM/plex

Full OFL text: https://openfontlicense.org/
```

- [ ] **Step 4: Fix `site.webmanifest` icon paths** so they resolve under `/assets`

Open `docs/assets/site.webmanifest` and ensure icon `src` values are relative to the assets folder (e.g. `"src": "./android-chrome-192x192.png"`). If those icon files weren't copied, either copy them too (`cp public/assets/android-chrome-*.png docs/assets/`) or remove their entries. The manifest must reference only files that exist.

- [ ] **Step 5: Write the design-system head of `docs/assets/styles.css`**

```css
/* ============================================================
   mkcert-OS terminal landing — design system
   Palette: Pip-Boy green on near-black. Amber reserved/unused.
   ============================================================ */

@font-face {
  font-family: 'VT323';
  src: url('fonts/vt323-latin-400-normal.woff2') format('woff2');
  font-weight: 400; font-style: normal; font-display: swap;
}
@font-face {
  font-family: 'IBM Plex Mono';
  src: url('fonts/ibm-plex-mono-latin-400-normal.woff2') format('woff2');
  font-weight: 400; font-style: normal; font-display: swap;
}
@font-face {
  font-family: 'IBM Plex Mono';
  src: url('fonts/ibm-plex-mono-latin-500-normal.woff2') format('woff2');
  font-weight: 500; font-style: normal; font-display: swap;
}

:root {
  --bg:          #070b07;
  --bg-panel:    #0c130c;
  --border:      #15431f;
  --phosphor:    #2bff88;   /* bright accent / headings */
  --phosphor-soft:#7dffb8;
  --text:        #c8f7da;   /* body — AA on --bg */
  --muted:       #5f9d77;   /* secondary */
  --amber:       #ffb000;   /* RESERVED — do not use by default */
  --glow:        0 0 6px rgba(43, 255, 136, 0.55);
  --mono: 'IBM Plex Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace;
  --display: 'VT323', var(--mono);
  --maxw: 1040px;
}

* { box-sizing: border-box; }

html { scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--mono);
  font-size: 17px;
  line-height: 1.6;
  text-shadow: var(--glow);
  -webkit-font-smoothing: antialiased;
}

.wrap { max-width: var(--maxw); margin: 0 auto; padding: 0 20px; }

a { color: var(--phosphor); }

.skip-link {
  position: absolute; left: -9999px; top: 0;
  background: var(--phosphor); color: var(--bg);
  padding: 8px 14px; z-index: 10000; text-shadow: none;
}
.skip-link:focus { left: 8px; top: 8px; }

h1, h2, .display { font-family: var(--display); font-weight: 400; letter-spacing: 1px; }

/* Section heading like a typed command, e.g. ">_ SYSTEM CAPABILITIES" */
.section-head {
  font-family: var(--display);
  font-size: clamp(28px, 4vw, 44px);
  color: var(--phosphor);
  margin: 0 0 18px;
}
.section-head::before { content: ">_ "; color: var(--phosphor-soft); }

section { padding: 56px 0; border-top: 1px solid var(--border); }
```

- [ ] **Step 6: Write a minimal but valid `docs/index.html` shell**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>mkcert Web UI — local TLS, minus the pain</title>
  <meta name="description" content="A secure web interface for managing local TLS certificates with mkcert. SCEP enrollment, multiple formats, Docker-ready." />
  <link rel="icon" href="assets/favicon.ico" />
  <link rel="icon" type="image/png" sizes="32x32" href="assets/favicon-32x32.png" />
  <link rel="apple-touch-icon" href="assets/apple-touch-icon.png" />
  <link rel="preload" href="assets/fonts/vt323-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="preload" href="assets/fonts/ibm-plex-mono-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="stylesheet" href="assets/styles.css" />
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <main id="main" class="wrap">
    <h1 class="display">mkcert Web UI</h1>
    <p>Local TLS, minus the pain.</p>
  </main>
</body>
</html>
```

- [ ] **Step 7: Serve and verify**

Run: `python3 -m http.server 8080 --directory docs` and open `http://localhost:8080/`
Expected: page loads on near-black background, green text, VT323 title renders (check Network tab: all three `woff2` load `200`, **no requests to external domains**). No console errors.

- [ ] **Step 8: Commit**

```bash
git add docs/.nojekyll docs/index.html docs/assets
git commit -m "feat(pages): scaffold terminal landing — assets, self-hosted fonts, design tokens"
```

---

## Task 2: CRT overlay layer (scanlines, vignette, flicker)

**Files:**
- Modify: `docs/assets/styles.css` (append CRT block)
- Modify: `docs/index.html` (add overlay element)

**Interfaces:**
- Consumes: `:root` tokens from Task 1.
- Produces: a `.crt` fixed overlay element that all later visuals sit beneath; reduced-motion behavior other tasks rely on.

- [ ] **Step 1: Append the CRT layer to `styles.css`**

```css
/* ---------- CRT overlay (decorative, never blocks input) ---------- */
.crt {
  position: fixed; inset: 0; z-index: 9000;
  pointer-events: none;
  background:
    radial-gradient(120% 120% at 50% 50%,
      rgba(0,0,0,0) 60%, rgba(0,0,0,0.55) 100%),           /* vignette */
    repeating-linear-gradient(
      to bottom,
      rgba(0,0,0,0) 0, rgba(0,0,0,0) 2px,
      rgba(0,0,0,0.16) 3px, rgba(0,0,0,0.16) 3px);          /* scanlines */
}
@keyframes crt-flicker {
  0%, 96%, 100% { opacity: 1; }
  97% { opacity: 0.82; }
  98% { opacity: 0.95; }
  99% { opacity: 0.86; }
}
@media (prefers-reduced-motion: no-preference) {
  .crt { animation: crt-flicker 6s linear infinite; }
}
```

- [ ] **Step 2: Add the overlay element** — insert as the first child of `<body>` in `index.html`, before the skip link:

```html
<div class="crt" aria-hidden="true"></div>
```

- [ ] **Step 3: Verify**

Reload `http://localhost:8080/`.
Expected: faint horizontal scanlines + darkened corners over the whole viewport; a subtle periodic flicker. Clicking/selecting text still works (overlay does not intercept input).
Then run: enable "Reduce motion" (macOS: System Settings → Accessibility → Display → Reduce motion) and reload.
Expected: scanlines/vignette remain, **flicker stops**.

- [ ] **Step 4: Commit**

```bash
git add docs/assets/styles.css docs/index.html
git commit -m "feat(pages): add CRT scanline/vignette/flicker overlay with reduced-motion gating"
```

---

## Task 3: Boot / POST overlay (typed sequence, skippable, once per session)

**Files:**
- Modify: `docs/index.html` (boot overlay markup + `main.js` script tag)
- Modify: `docs/assets/styles.css` (boot styles)
- Create: `docs/assets/main.js`

**Interfaces:**
- Consumes: tokens + `.crt` from Tasks 1–2.
- Produces: `typeLines(el, lines, opts)` helper inside `main.js` (reused by hero typing in Task 4); a `sessionStorage` key `mkcertos_booted`.

- [ ] **Step 1: Add boot overlay markup** — insert right after the `.crt` element in `index.html`:

```html
<div id="boot" class="boot" role="status" aria-label="System boot sequence">
  <pre id="boot-text" class="boot-text"></pre>
  <p class="boot-hint">[ PRESS ANY KEY TO SKIP ]</p>
</div>
```

- [ ] **Step 2: Add boot styles to `styles.css`**

```css
/* ---------- Boot / POST overlay ---------- */
.boot {
  position: fixed; inset: 0; z-index: 9500;
  background: var(--bg);
  display: flex; flex-direction: column; justify-content: center;
  padding: 6vh 8vw;
}
.boot.is-hidden { display: none; }
.boot-text { font-family: var(--mono); color: var(--phosphor); margin: 0; white-space: pre-wrap; }
.boot-hint { color: var(--muted); margin-top: 24px; }
.boot-text::after { content: "▋"; animation: caret 1s step-end infinite; }
@keyframes caret { 50% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .boot-text::after { animation: none; } }
```

- [ ] **Step 3: Create `docs/assets/main.js` with the typing helper + boot controller**

```javascript
/* main.js — progressive enhancement: boot, typing, copy, console wiring */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /**
   * Type an array of lines into a target element, char by char.
   * Returns a Promise that resolves when done. Honors reduced motion
   * (renders instantly) and an optional skip() escape hatch.
   */
  function typeLines(el, lines, opts) {
    opts = opts || {};
    var speed = opts.speed || 18;          // ms per char
    var linePause = opts.linePause || 220; // ms between lines
    var skipped = false;
    function skip() {
      skipped = true;
      el.textContent = lines.join('\n') + '\n';
    }
    var promise = new Promise(function (resolve) {
      if (reduceMotion) { skip(); return resolve(skip); }
      var li = 0, ci = 0;
      (function tick() {
        if (skipped) return resolve(skip);
        if (li >= lines.length) return resolve(skip);
        var line = lines[li];
        if (ci <= line.length) {
          el.textContent = lines.slice(0, li).join('\n') +
            (li > 0 ? '\n' : '') + line.slice(0, ci) + (li > 0 || ci > 0 ? '' : '');
          ci++;
          setTimeout(tick, speed);
        } else {
          el.textContent = lines.slice(0, li + 1).join('\n') + '\n';
          li++; ci = 0;
          setTimeout(tick, linePause);
        }
      })();
    });
    promise.skip = skip;
    return { promise: promise, skip: skip };
  }

  // --- Boot sequence ---
  function runBoot() {
    var boot = document.getElementById('boot');
    var textEl = document.getElementById('boot-text');
    if (!boot || !textEl) return;

    function dismiss() { boot.classList.add('is-hidden'); cleanup(); }
    function cleanup() {
      window.removeEventListener('keydown', onSkip);
      window.removeEventListener('click', onSkip);
    }
    function onSkip() { sessionStorage.setItem('mkcertos_booted', '1'); dismiss(); }

    // Skip entirely if already booted this session or reduced motion.
    if (sessionStorage.getItem('mkcertos_booted') === '1' || reduceMotion) {
      boot.classList.add('is-hidden');
      return;
    }

    var lines = [
      'RobCo Industries (TM) Termlink Protocol',
      'MKCERT-OS v4.1.0  —  CERTIFICATE AUTHORITY TERMINAL',
      '',
      'INITIALIZING ............ OK',
      'MEMORY CHECK ............ OK',
      'LOADING CERTIFICATE AUTHORITY ............ OK',
      'ESTABLISHING SECURE LINK ............ OK',
      'MOUNTING /certificates ............ OK',
      '',
      'READY.'
    ];
    window.addEventListener('keydown', onSkip);
    window.addEventListener('click', onSkip);
    var t = typeLines(textEl, lines, { speed: 14, linePause: 160 });
    t.promise.then(function () {
      sessionStorage.setItem('mkcertos_booted', '1');
      setTimeout(dismiss, 650);
    });
  }

  // expose for later tasks
  window.MKCERTOS = { typeLines: typeLines, reduceMotion: reduceMotion };

  document.addEventListener('DOMContentLoaded', function () {
    runBoot();
  });
})();
```

Note on the boot text: "RobCo Industries (TM) Termlink Protocol" is a recognizable phrasing. If you want zero trademark exposure, replace that first line with `ROBCO-STYLE TERMLINK // MKCERT-OS`. Per the spec's homage stance, prefer the zero-exposure variant.

- [ ] **Step 4: Apply the spec's trademark stance** — set the first boot line to the homage-safe variant:

Change `'RobCo Industries (TM) Termlink Protocol',` to:
```javascript
      'ROBCO-STYLE TERMLINK // MKCERT-OS',
```

- [ ] **Step 5: Add the script tag** — before `</body>` in `index.html`:

```html
  <script src="assets/main.js" defer></script>
```

- [ ] **Step 6: Verify**

Reload in a fresh tab (or clear sessionStorage). Expected: full-screen boot overlay types the sequence, blinking caret, `[ PRESS ANY KEY TO SKIP ]`; after `READY.` it disappears revealing the page. Press a key mid-sequence → it dismisses immediately. Reload again in the same tab → boot does **not** replay. With Reduce motion on → no boot overlay at all, page visible immediately.

- [ ] **Step 7: Commit**

```bash
git add docs/index.html docs/assets/styles.css docs/assets/main.js
git commit -m "feat(pages): add skippable typed boot sequence with reduced-motion + session gating"
```

---

## Task 4: Sticky title bar + hero (typed tagline, action buttons)

**Files:**
- Modify: `docs/index.html` (title bar + hero markup)
- Modify: `docs/assets/styles.css` (title bar, hero, button styles)
- Modify: `docs/assets/main.js` (type the hero tagline)

**Interfaces:**
- Consumes: `window.MKCERTOS.typeLines` from Task 3.
- Produces: `.btn` terminal button style reused by later CTAs.

- [ ] **Step 1: Add the sticky title bar** — first element inside `<body>` after the boot overlay (before `.skip-link` is fine, but place visually-first markup logically; keep skip link first for a11y). Recommended order: `.crt`, `#boot`, `.skip-link`, then:

```html
<header class="titlebar">
  <div class="wrap titlebar-inner">
    <span class="titlebar-name">MKCERT-OS TERMINAL</span>
    <span class="titlebar-status">v4.1.0 · LINK: SECURE · CA: ONLINE<span class="caret">▋</span></span>
  </div>
</header>
```

- [ ] **Step 2: Replace the placeholder `<main>` with the hero** (keep `id="main"`):

```html
<main id="main">
  <section class="hero">
    <div class="wrap">
      <h1 class="hero-title display">mkcert&nbsp;Web&nbsp;UI</h1>
      <p class="hero-tagline" id="hero-tagline" aria-label="Local TLS, minus the pain."></p>
      <p class="hero-sub">A secure web interface for managing local TLS certificates with mkcert — generation, SCEP enrollment, multiple formats, Docker-ready.</p>
      <nav class="hero-actions" aria-label="Primary">
        <a class="btn btn-primary" href="https://github.com/jeffcaldwellca/mkcertWeb">[ DEPLOY VIA DOCKER ]</a>
        <a class="btn" href="https://github.com/jeffcaldwellca/mkcertWeb">[ VIEW SOURCE ]</a>
        <a class="btn" href="https://hub.docker.com/r/jeffcaldwellca/mkcertweb">[ DOCKER HUB ]</a>
      </nav>
    </div>
  </section>
```
(The remaining sections and `</main>` close in later tasks; for now add a temporary `</main>` after the hero `</section>` and remove it when Task 5 adds the next section.)

- [ ] **Step 3: Add title bar + hero + button CSS**

```css
/* ---------- Title bar ---------- */
.titlebar {
  position: sticky; top: 0; z-index: 8000;
  background: rgba(7,11,7,0.92); border-bottom: 1px solid var(--border);
  backdrop-filter: blur(2px);
}
.titlebar-inner { display: flex; justify-content: space-between; align-items: center;
  font-family: var(--display); font-size: 22px; color: var(--phosphor); padding: 8px 20px; }
.titlebar-status { color: var(--muted); font-size: 18px; }
.caret { animation: caret 1s step-end infinite; }
@media (prefers-reduced-motion: reduce) { .caret { animation: none; } }
@media (max-width: 620px) { .titlebar-status { display: none; } }

/* ---------- Hero ---------- */
.hero { padding: 72px 0 64px; border-top: none; }
.hero-title { font-size: clamp(48px, 10vw, 104px); line-height: 0.95; margin: 0; color: var(--phosphor); }
.hero-tagline { font-family: var(--display); font-size: clamp(24px, 4vw, 38px); color: var(--phosphor-soft); min-height: 1.4em; margin: 10px 0 0; }
.hero-tagline::after { content: "▋"; animation: caret 1s step-end infinite; }
@media (prefers-reduced-motion: reduce) { .hero-tagline::after { animation: none; } }
.hero-sub { max-width: 60ch; color: var(--text); }
.hero-actions { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 28px; }

/* ---------- Terminal buttons ---------- */
.btn {
  display: inline-block; font-family: var(--display); font-size: 22px;
  color: var(--phosphor); text-decoration: none; text-shadow: var(--glow);
  border: 1px solid var(--phosphor); padding: 8px 16px; background: transparent;
  transition: background .12s linear, color .12s linear;
}
.btn:hover, .btn:focus-visible { background: var(--phosphor); color: var(--bg); text-shadow: none; outline: none; }
.btn-primary { box-shadow: var(--glow); }
```

- [ ] **Step 4: Type the hero tagline** — in `main.js`, inside the `DOMContentLoaded` handler, after `runBoot();` add:

```javascript
    var tagline = document.getElementById('hero-tagline');
    if (tagline) {
      window.MKCERTOS.typeLines(tagline, ['Local TLS, minus the pain.'],
        { speed: 38, linePause: 0 });
    }
```

- [ ] **Step 5: Verify**

Reload. Expected: sticky header stays pinned on scroll; hero title in big VT323; tagline types itself out; three buttons invert (green fill, dark text) on hover and on keyboard focus (Tab to them). With JS disabled, the tagline is empty visually but the `aria-label` still conveys it and the page is fully usable — confirm buttons and links work.

- [ ] **Step 6: Commit**

```bash
git add docs/index.html docs/assets/styles.css docs/assets/main.js
git commit -m "feat(pages): add sticky title bar and hero with typed tagline and terminal buttons"
```

---

## Task 5: System Capabilities feature grid

**Files:**
- Modify: `docs/index.html` (capabilities section)
- Modify: `docs/assets/styles.css` (grid + card styles)

**Interfaces:**
- Consumes: `.section-head`, tokens.
- Produces: `.feature-grid` / `.feature` markup pattern.

- [ ] **Step 1: Add the section** (immediately after the hero `</section>`; remove any temporary `</main>` from Task 4):

```html
  <section id="capabilities">
    <div class="wrap">
      <h2 class="section-head">SYSTEM CAPABILITIES</h2>
      <ul class="feature-grid">
        <li class="feature"><h3>Certificate Generation</h3><p>Create certificates for multiple domains and IP addresses in one pass.</p></li>
        <li class="feature"><h3>SCEP Enrollment</h3><p>Simple Certificate Enrollment Protocol for automatic device enrollment.</p></li>
        <li class="feature"><h3>Enterprise Security</h3><p>Command-injection &amp; path-traversal protection with comprehensive rate limiting.</p></li>
        <li class="feature"><h3>Multiple Formats</h3><p>Export PEM, CRT, and PFX (PKCS#12) certificates.</p></li>
        <li class="feature"><h3>Flexible Auth</h3><p>Basic auth plus OpenID Connect SSO.</p></li>
        <li class="feature"><h3>Email Notifications</h3><p>Automated SMTP alerts for expiring certificates.</p></li>
        <li class="feature"><h3>Certificate Monitoring</h3><p>Automatic monitoring with configurable warning periods.</p></li>
        <li class="feature"><h3>Docker Ready</h3><p>Complete containerization with docker-compose.</p></li>
      </ul>
    </div>
  </section>
```

- [ ] **Step 2: Add grid CSS**

```css
/* ---------- Feature grid ---------- */
.feature-grid { list-style: none; margin: 0; padding: 0;
  display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
.feature { border: 1px solid var(--border); background: var(--bg-panel); padding: 18px 18px 20px; }
.feature h3 { font-family: var(--display); font-size: 26px; color: var(--phosphor); margin: 0 0 6px; }
.feature h3::before { content: "› "; color: var(--phosphor-soft); }
.feature p { margin: 0; color: var(--text); font-size: 15.5px; }
.feature:hover { border-color: var(--phosphor); box-shadow: var(--glow); }
```

- [ ] **Step 3: Verify**

Reload. Expected: responsive grid of 8 bordered cards, each with a `›` prefixed VT323 heading; cards glow-outline on hover; grid reflows to 1–2 columns on narrow widths. Confirm all eight features match the README.

- [ ] **Step 4: Commit**

```bash
git add docs/index.html docs/assets/styles.css
git commit -m "feat(pages): add system capabilities feature grid"
```

---

## Task 6: Display panel (screenshot in CRT bezel)

**Files:**
- Modify: `docs/index.html` (display section)
- Modify: `docs/assets/styles.css` (bezel styles)

**Interfaces:** Consumes tokens; produces `.monitor` bezel pattern.

- [ ] **Step 1: Add the section** (after capabilities `</section>`):

```html
  <section id="display">
    <div class="wrap">
      <h2 class="section-head">DISPLAY OUTPUT</h2>
      <figure class="monitor">
        <div class="monitor-screen">
          <img src="assets/screenshot.png" width="1244" height="529"
               alt="mkcert Web UI showing the certificate generation and management interface" />
          <span class="monitor-scan" aria-hidden="true"></span>
        </div>
        <figcaption>// RobCo-style management console — certificate generation &amp; monitoring</figcaption>
      </figure>
    </div>
  </section>
```

- [ ] **Step 2: Add bezel CSS**

```css
/* ---------- Monitor / display panel ---------- */
.monitor { margin: 0; }
.monitor-screen {
  position: relative; border: 2px solid var(--border);
  border-radius: 10px; padding: 10px; background: #050805;
  box-shadow: inset 0 0 60px rgba(43,255,136,0.10), var(--glow);
}
.monitor-screen img { display: block; width: 100%; height: auto; border-radius: 4px; }
.monitor-scan {
  position: absolute; inset: 10px; pointer-events: none; border-radius: 4px;
  background: repeating-linear-gradient(to bottom,
    rgba(0,0,0,0) 0, rgba(0,0,0,0) 2px, rgba(0,0,0,0.10) 3px, rgba(0,0,0,0.10) 3px);
}
.monitor figcaption { color: var(--muted); margin-top: 12px; font-size: 15px; }
```

- [ ] **Step 3: Verify**

Reload. Expected: screenshot framed in a rounded green-glowing bezel with a faint scanline sheen; image scales responsively without layout shift (width/height attributes set). `alt` text present.

- [ ] **Step 4: Commit**

```bash
git add docs/index.html docs/assets/styles.css
git commit -m "feat(pages): add screenshot display panel in CRT bezel"
```

---

## Task 7: Quick Start blocks + copy-to-clipboard

**Files:**
- Modify: `docs/index.html` (quick start section)
- Modify: `docs/assets/styles.css` (code block + copy button styles)
- Modify: `docs/assets/main.js` (`initCopyButtons`)

**Interfaces:**
- Consumes: tokens, `window.MKCERTOS`.
- Produces: `initCopyButtons()` invoked on DOM ready.

- [ ] **Step 1: Add the section** (after display `</section>`):

```html
  <section id="quick-start">
    <div class="wrap">
      <h2 class="section-head">QUICK START</h2>
      <p class="muted">Docker is the recommended path. Then open <code>http://localhost:3000</code>.</p>

      <div class="codeblock">
        <button class="copy-btn" type="button" data-copy-target="qs-docker">COPY</button>
        <pre id="qs-docker"><code>git clone https://github.com/jeffcaldwellca/mkcertWeb.git
cd mkcertWeb
docker-compose up -d</code></pre>
      </div>

      <p class="muted">Or run locally (requires Node.js 16+, mkcert, OpenSSL):</p>
      <div class="codeblock">
        <button class="copy-btn" type="button" data-copy-target="qs-local">COPY</button>
        <pre id="qs-local"><code>npm install
mkcert -install
npm start</code></pre>
      </div>
    </div>
  </section>
```

- [ ] **Step 2: Add code block CSS**

```css
/* ---------- Code blocks ---------- */
.muted { color: var(--muted); }
.codeblock { position: relative; margin: 14px 0 22px; }
.codeblock pre {
  margin: 0; background: var(--bg-panel); border: 1px solid var(--border);
  border-left: 3px solid var(--phosphor); padding: 16px 18px; overflow-x: auto;
  color: var(--text); text-shadow: none;
}
.codeblock code { font-family: var(--mono); font-size: 15px; white-space: pre; }
.copy-btn {
  position: absolute; top: 8px; right: 8px; font-family: var(--display); font-size: 16px;
  color: var(--phosphor); background: var(--bg); border: 1px solid var(--phosphor);
  padding: 2px 10px; cursor: pointer; text-shadow: var(--glow);
}
.copy-btn:hover, .copy-btn:focus-visible { background: var(--phosphor); color: var(--bg); text-shadow: none; outline: none; }
.copy-btn.copied { background: var(--phosphor); color: var(--bg); }
```

- [ ] **Step 3: Add `initCopyButtons` to `main.js`** and call it on DOM ready

```javascript
  function initCopyButtons() {
    var buttons = document.querySelectorAll('.copy-btn[data-copy-target]');
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener('click', function () {
        var target = document.getElementById(btn.getAttribute('data-copy-target'));
        if (!target) return;
        var text = target.innerText.replace(/\n$/, '');
        function done() {
          var prev = btn.textContent;
          btn.textContent = 'COPIED'; btn.classList.add('copied');
          setTimeout(function () { btn.textContent = prev; btn.classList.remove('copied'); }, 1400);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
        } else { fallbackCopy(text, done); }
      });
    });
  }
  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'absolute'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* no-op */ }
    document.body.removeChild(ta);
  }
```
Then in the `DOMContentLoaded` handler add: `initCopyButtons();`

- [ ] **Step 4: Verify**

Reload. Expected: two command blocks with a green-left-border; each `COPY` button copies the block's commands (paste elsewhere to confirm — no trailing blank line), and flips to `COPIED` for ~1.4s. Keyboard: Tab to the button, Enter copies. With JS disabled, the commands are still fully visible and selectable.

- [ ] **Step 5: Commit**

```bash
git add docs/index.html docs/assets/styles.css docs/assets/main.js
git commit -m "feat(pages): add quick-start command blocks with copy-to-clipboard"
```

---

## Task 8: Manifest section

**Files:**
- Modify: `docs/index.html` (manifest section)
- Modify: `docs/assets/styles.css` (definition list styles)

**Interfaces:** Consumes tokens, `.section-head`.

- [ ] **Step 1: Add the section** (after quick-start `</section>`):

```html
  <section id="manifest">
    <div class="wrap">
      <h2 class="section-head">MANIFEST</h2>
      <dl class="manifest">
        <dt>VERSION</dt><dd>4.1.0</dd>
        <dt>LICENSE</dt><dd><a href="https://github.com/jeffcaldwellca/mkcertWeb/blob/main/LICENSE">GPLv3</a></dd>
        <dt>REQUIRES</dt><dd>Node.js 16+ · mkcert · OpenSSL</dd>
        <dt>SOURCE</dt><dd><a href="https://github.com/jeffcaldwellca/mkcertWeb">github.com/jeffcaldwellca/mkcertWeb</a></dd>
        <dt>IMAGE</dt><dd><a href="https://hub.docker.com/r/jeffcaldwellca/mkcertweb">hub.docker.com/r/jeffcaldwellca/mkcertweb</a></dd>
      </dl>
    </div>
  </section>
```

- [ ] **Step 2: Add manifest CSS**

```css
/* ---------- Manifest ---------- */
.manifest { display: grid; grid-template-columns: max-content 1fr; gap: 8px 24px; margin: 0; }
.manifest dt { font-family: var(--display); font-size: 22px; color: var(--phosphor); }
.manifest dd { margin: 0; color: var(--text); }
@media (max-width: 520px) { .manifest { grid-template-columns: 1fr; gap: 2px 0; } .manifest dd { margin-bottom: 10px; } }
```

- [ ] **Step 3: Verify**

Reload. Expected: aligned label/value rows; VERSION `4.1.0`, LICENSE links to the repo LICENSE, REQUIRES lists Node 16+/mkcert/OpenSSL, source + image links correct. Collapses to single column on narrow screens.

- [ ] **Step 4: Commit**

```bash
git add docs/index.html docs/assets/styles.css
git commit -m "feat(pages): add manifest section with version, license, requirements"
```

---

## Task 9: Easter-egg console module + tests

**Files:**
- Create: `docs/assets/console-commands.js`
- Create: `test/console-commands.test.js`

**Interfaces:**
- Produces: global `window.ConsoleCommands` / CommonJS export `{ runCommand }`.
- `runCommand(rawInput) -> { lines: string[], clear: boolean, navigate: string|null }`
- Consumed by Task 10's DOM wiring.

- [ ] **Step 1: Write the failing test** — create `test/console-commands.test.js`

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { runCommand } = require('../docs/assets/console-commands.js');

const REPO = 'https://github.com/jeffcaldwellca/mkcertWeb';
const DOCKERHUB = 'https://hub.docker.com/r/jeffcaldwellca/mkcertweb';

test('empty input is a no-op (no error line)', () => {
  const r = runCommand('   ');
  assert.deepStrictEqual(r, { lines: [], clear: false, navigate: null });
});

test('version prints the OS version', () => {
  assert.deepStrictEqual(runCommand('version'),
    { lines: ['MKCERT-OS v4.1.0'], clear: false, navigate: null });
});

test('help lists known commands', () => {
  const r = runCommand('help');
  assert.strictEqual(r.clear, false);
  assert.strictEqual(r.navigate, null);
  const joined = r.lines.join('\n');
  ['help', 'about', 'version', 'source', 'docker', 'vault', 'clear']
    .forEach((c) => assert.ok(joined.includes(c), 'help mentions ' + c));
});

test('about returns a one-line description', () => {
  const r = runCommand('about');
  assert.strictEqual(r.lines.length, 1);
  assert.ok(/mkcert/i.test(r.lines[0]));
});

test('source navigates to the repo', () => {
  assert.strictEqual(runCommand('source').navigate, REPO);
});

test('docker navigates to docker hub', () => {
  assert.strictEqual(runCommand('docker').navigate, DOCKERHUB);
});

test('clear signals a clear with no output', () => {
  assert.deepStrictEqual(runCommand('clear'),
    { lines: [], clear: true, navigate: null });
});

test('vault returns flavor text and no navigation', () => {
  const r = runCommand('vault');
  assert.strictEqual(r.navigate, null);
  assert.ok(r.lines.length >= 1);
});

test('input is case-insensitive and ignores extra args', () => {
  assert.deepStrictEqual(runCommand('VERSION --now'),
    { lines: ['MKCERT-OS v4.1.0'], clear: false, navigate: null });
});

test('unknown command reports not found with the typed token', () => {
  assert.deepStrictEqual(runCommand('frobnicate'),
    { lines: ['command not found: frobnicate'], clear: false, navigate: null });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/console-commands.test.js`
Expected: FAIL — cannot find module `../docs/assets/console-commands.js`.

- [ ] **Step 3: Write `docs/assets/console-commands.js`** (UMD: browser global + CommonJS)

```javascript
/* console-commands.js — pure command parser for the easter-egg console.
   Works as a browser global (window.ConsoleCommands) and a CommonJS module. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.ConsoleCommands = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 'MKCERT-OS v4.1.0';
  var REPO = 'https://github.com/jeffcaldwellca/mkcertWeb';
  var DOCKERHUB = 'https://hub.docker.com/r/jeffcaldwellca/mkcertweb';

  var HELP = [
    'available commands:',
    '  help     show this list',
    '  about    what is this',
    '  version  print os version',
    '  source   open the github repo',
    '  docker   open docker hub',
    '  vault    ???',
    '  clear    clear the console'
  ];

  function ok(lines, extra) {
    var r = { lines: lines, clear: false, navigate: null };
    if (extra) { for (var k in extra) { r[k] = extra[k]; } }
    return r;
  }

  function runCommand(rawInput) {
    var input = String(rawInput == null ? '' : rawInput).trim();
    if (input === '') { return ok([]); }
    var cmd = input.split(/\s+/)[0].toLowerCase();
    switch (cmd) {
      case 'help':    return ok(HELP.slice());
      case 'about':   return ok(['mkcert Web UI: a web interface for managing local TLS certificates with mkcert.']);
      case 'version': return ok([VERSION]);
      case 'source':  return ok(['opening source repository...'], { navigate: REPO });
      case 'docker':  return ok(['opening docker hub...'], { navigate: DOCKERHUB });
      case 'vault':   return ok(['ACCESS GRANTED. Your certificates are secured. Have a pleasant day. ☢']);
      case 'clear':   return ok([], { clear: true });
      default:        return ok(['command not found: ' + cmd]);
    }
  }

  return { runCommand: runCommand };
}));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/console-commands.test.js`
Expected: PASS — all tests green. Also run the full suite to confirm no regression: `npm test`.

- [ ] **Step 5: Commit**

```bash
git add docs/assets/console-commands.js test/console-commands.test.js
git commit -m "feat(pages): add tested console command parser for easter-egg terminal"
```

---

## Task 10: Console strip, footer, DOM wiring, and final accessibility/perf pass

**Files:**
- Modify: `docs/index.html` (console strip, footer, script tag for console-commands.js)
- Modify: `docs/assets/styles.css` (console + footer styles)
- Modify: `docs/assets/main.js` (`initConsole`)

**Interfaces:**
- Consumes: `window.ConsoleCommands.runCommand` (Task 9), `.btn`/tokens.
- Produces: final page; closes `</main>`.

- [ ] **Step 1: Add the console strip + footer** (after manifest `</section>`, then close `</main>`):

```html
  <section id="console">
    <div class="wrap">
      <h2 class="section-head">CONSOLE</h2>
      <p class="muted">Interactive terminal. Type <code>help</code> and press Enter.</p>
      <div class="console">
        <div id="console-out" class="console-out" role="log" aria-live="polite" aria-label="Console output"></div>
        <form id="console-form" class="console-form" autocomplete="off">
          <label class="console-prompt" for="console-input">&gt;</label>
          <input id="console-input" class="console-input" type="text"
                 aria-label="Console command input" spellcheck="false" />
        </form>
      </div>
    </div>
  </section>
  </main>

  <footer class="site-footer">
    <div class="wrap">
      <nav class="footer-links" aria-label="Footer">
        <a href="https://github.com/jeffcaldwellca/mkcertWeb">GitHub</a>
        <a href="https://hub.docker.com/r/jeffcaldwellca/mkcertweb">Docker Hub</a>
        <a href="https://github.com/jeffcaldwellca/mkcertWeb/blob/main/LICENSE">License (GPLv3)</a>
      </nav>
      <p class="footer-note">
        mkcert Web UI v4.1.0 — released under GPLv3.<br />
        Fan homage to the RobCo terminal aesthetic; not affiliated with or endorsed by Bethesda.
      </p>
      <p class="footer-sign">MKCERT-OS // SESSION ENDED<span class="caret">▋</span></p>
    </div>
  </footer>
```

- [ ] **Step 2: Add console + footer CSS**

```css
/* ---------- Console ---------- */
.console { border: 1px solid var(--border); background: var(--bg-panel); padding: 14px; }
.console-out { min-height: 1.6em; white-space: pre-wrap; color: var(--text); text-shadow: none; margin-bottom: 8px; }
.console-out .echo { color: var(--phosphor-soft); }
.console-out .err { color: var(--muted); }
.console-form { display: flex; align-items: center; gap: 8px; }
.console-prompt { font-family: var(--display); font-size: 22px; color: var(--phosphor); }
.console-input {
  flex: 1; background: transparent; border: none; outline: none;
  color: var(--phosphor); font-family: var(--mono); font-size: 16px; text-shadow: var(--glow);
}
.console-input:focus { box-shadow: none; }

/* ---------- Footer ---------- */
.site-footer { border-top: 1px solid var(--border); padding: 40px 0 64px; }
.footer-links { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 14px; }
.footer-note { color: var(--muted); font-size: 14px; margin: 0 0 10px; }
.footer-sign { font-family: var(--display); color: var(--phosphor); margin: 0; }
```

- [ ] **Step 3: Add the console-commands.js script tag** — in `index.html` `<head>`-adjacent area, **before** `main.js`, near the end of `<body>`:

```html
  <script src="assets/console-commands.js"></script>
  <script src="assets/main.js" defer></script>
```
(`console-commands.js` is plain — no `defer` — so `window.ConsoleCommands` exists when `main.js` runs.)

- [ ] **Step 4: Add `initConsole` to `main.js`** and call it on DOM ready

```javascript
  function initConsole() {
    var form = document.getElementById('console-form');
    var input = document.getElementById('console-input');
    var out = document.getElementById('console-out');
    if (!form || !input || !out || !window.ConsoleCommands) return;

    function append(text, cls) {
      var div = document.createElement('div');
      if (cls) div.className = cls;
      div.textContent = text;
      out.appendChild(div);
    }
    append('MKCERT-OS console ready. Type "help".', 'err');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var raw = input.value;
      append('> ' + raw, 'echo');
      var res = window.ConsoleCommands.runCommand(raw);
      if (res.clear) { out.innerHTML = ''; }
      else {
        res.lines.forEach(function (line) {
          var isErr = line.indexOf('command not found') === 0;
          append(line, isErr ? 'err' : null);
        });
      }
      if (res.navigate) { window.open(res.navigate, '_blank', 'noopener'); }
      input.value = '';
      out.scrollTop = out.scrollHeight;
    });
  }
```
Then in `DOMContentLoaded` add: `initConsole();`

- [ ] **Step 5: Verify behavior**

Reload. Expected: typing `help` lists commands; `version` → `MKCERT-OS v4.1.0`; `about` → description; `clear` wipes output; `frobnicate` → `command not found: frobnicate`; `source`/`docker` open the right URL in a new tab and echo the "opening…" line; `vault` prints the flavor line. Input echoes as `> …`. Footer shows GPLv3 + homage disclaimer.

- [ ] **Step 6: Final accessibility & performance pass**

Work through this checklist, fixing inline:
- **Keyboard:** Tab through the entire page — skip link appears on first Tab and jumps to `#main`; all buttons/links/console input reachable with visible focus (green focus states). No keyboard trap in the boot overlay (it auto-dismisses / any key skips).
- **Reduced motion:** with Reduce motion ON, reload — no boot animation, no flicker, no caret blink; everything immediately readable.
- **JS disabled:** disable JS, reload — boot overlay must not hide content. Confirm `#boot` does not cover the page when JS is off. **Fix:** add to `styles.css`:
  ```css
  /* If JS never runs, never let the boot overlay hide the page. */
  .boot { display: none; }
  ```
  and in `main.js` `runBoot()`, when a boot should play, explicitly show it via `boot.style.display = 'flex'` before typing (and keep using `is-hidden`/removal to dismiss). Re-verify the boot still plays with JS ON.
- **Contrast:** spot-check body text (`--text` on `--bg`) and muted text in DevTools (aim ≥ 4.5:1 for body; bump `--muted` lighter if a key text fails). 
- **Validate HTML:** paste `docs/index.html` into https://validator.w3.org/nu/ (or run a local validator) — resolve errors (unclosed tags, duplicate ids).
- **Perf:** confirm in the Network tab there are **zero external-domain requests**; fonts are preloaded; total transfer is small. Optionally run Lighthouse — target no critical a11y failures.

- [ ] **Step 7: Commit**

```bash
git add docs/index.html docs/assets/styles.css docs/assets/main.js
git commit -m "feat(pages): add interactive console strip, footer, and a11y/perf hardening"
```

---

## Task 11: README pointer + deployment doc

**Files:**
- Modify: `README.md` (add a "Live demo / landing page" line near the top)
- Create: `docs/PAGES.md` (how Pages is configured)

- [ ] **Step 1: Add a landing-page note to `README.md`** — under the title/intro, add:

```markdown
> 🖥️ **Landing page:** a terminal-themed project page lives in [`/docs`](docs/) and is published via GitHub Pages (Settings → Pages → Deploy from branch → `main` / `/docs`).
```

- [ ] **Step 2: Create `docs/PAGES.md`**

```markdown
# GitHub Pages — terminal landing

The landing site is plain static files in `docs/` (no build step):

- `docs/index.html` — the page
- `docs/assets/` — styles, scripts, self-hosted fonts, screenshot
- `docs/.nojekyll` — serve as-is (skip Jekyll)

## Enable / update

1. Repo **Settings → Pages**.
2. **Source:** Deploy from a branch.
3. **Branch:** `main`, **Folder:** `/docs`. Save.
4. Wait for the deploy, then visit the published URL.

Editing any file under `docs/` and pushing to `main` redeploys automatically.

## Local preview

```bash
python3 -m http.server 8080 --directory docs
# http://localhost:8080/
```
```

- [ ] **Step 3: Verify** the README renders (no broken markdown) and the link to `docs/` resolves.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/PAGES.md
git commit -m "docs: point README at the GitHub Pages landing and document Pages setup"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Boot/POST overlay → Task 3 ✓
- Title bar → Task 4 ✓
- Hero + typed tagline + buttons → Task 4 ✓
- System Capabilities (README feature set) → Task 5 ✓
- Display panel (screenshot bezel) → Task 6 ✓
- Quick Start + copy → Task 7 ✓
- Manifest (Node16+/mkcert/OpenSSL, GPLv3, version, links) → Task 8 ✓
- Console easter egg (dedicated strip above footer) → Tasks 9 + 10 ✓
- Footer + homage disclaimer → Task 10 ✓
- Always-on CRT layer → Task 2 ✓
- Self-hosted fonts (VT323 + IBM Plex Mono), `.nojekyll`, no external calls → Task 1 ✓
- Reduced-motion / JS-disabled / AA contrast / a11y → gated throughout, hardened in Task 10 ✓
- Pip-Boy green palette, amber reserved → Task 1 tokens ✓
- Deployment from `/docs` → Task 11 doc ✓

**Type/name consistency:** `runCommand(rawInput) -> { lines, clear, navigate }` is defined identically in Task 9's tests and module and consumed unchanged in Task 10. `typeLines(el, lines, opts)` defined in Task 3, reused in Task 4. `window.MKCERTOS` and `window.ConsoleCommands` globals consistent across tasks.

**Placeholder scan:** no TBD/TODO; every code step contains complete code; aesthetic CSS values are concrete (tunable, but functional as written).
