# Unified Design Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the terminal landing (`docs/`) and the product dashboard (`public/`) into one visual identity — shared aqua-phosphor accent, system-mono type, 4px shape, glow-on-primary — while the landing keeps its CRT signature and the dashboard keeps its light/dark themes.

**Architecture:** A byte-identical shared `:root` token block is duplicated into both stylesheets (no build step). Both files already drive color via CSS custom properties, so each surface adopts the shared tokens by **aliasing its existing token names to the new shared ones** (e.g. `--phosphor: var(--accent)`), keeping diffs small. Each surface keeps its own surface-layer tokens (backgrounds; the dashboard's full light theme; the landing's near-black CRT surface).

**Tech Stack:** Plain CSS custom properties, vanilla HTML. No build step, no new dependencies. "Tests" are visual serve checks (the JS test suite must stay green as a regression guard).

## Global Constraints

- **No build step / no new dependencies.** Plain CSS only.
- **Shared accent** `#2cf5b8` (dark); dashboard **light-mode accent** `#0a7c61` (deep teal, must pass WCAG AA ≥4.5:1 as text on light bg).
- **System monospace everywhere.** The landing **removes** its VT323 + IBM Plex Mono web fonts (no `@font-face`, no preloads, no `.woff2`, no `FONT-LICENSES.txt`). Headings use the shared mono with **bold + uppercase + letter-spacing 1.5px** (taglines/body stay sentence case).
- **Shape:** `--radius: 4px` on cards/buttons/inputs/modals; `--radius-lg: 8px` for large containers; `1px` borders; **glow reserved for primary action + focus**.
- **CRT is the landing's signature only.** No CRT/scanlines added to the dashboard.
- **Preserve:** dashboard light/dark `data-theme` toggle + all components/behavior (recolor + radius only, no HTML/JS restructure); landing CRT, console, and `prefers-reduced-motion` / JS-disabled fallbacks.
- **No external network calls** from either served surface (landing now also has zero font downloads).
- `npm test` (73 tests) must stay green — we touch no JS/server code.
- **Commits:** conventional messages, **no `Co-Authored-By` trailer**.

### Canonical shared token block (paste byte-identical into BOTH stylesheets)

```css
/* ===== SHARED DESIGN LANGUAGE — keep in sync with the other stylesheet.
   Canonical source: docs/superpowers/specs/2026-06-21-unified-design-language-design.md ===== */
:root {
  --accent:          #2cf5b8;
  --accent-soft:     #8cf5d4;
  --accent-contrast: #04140f;
  --accent-glow:     rgba(44, 245, 184, 0.40);
  --glow:            0 0 8px var(--accent-glow);
  --font-mono:       ui-monospace, 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', 'Courier New', monospace;
  --radius:          4px;
  --radius-lg:       8px;
  --border-width:    1px;
  --muted:           #7d8590;
  --success:         #4ade80;
  --warning:         #fbbf24;
  --error:           #f87171;
}
/* ===== END SHARED DESIGN LANGUAGE ===== */
```

**Local preview commands (used in verification):**
```bash
# Landing:
python3 -m http.server 8080 --directory docs   # http://localhost:8080/
# Dashboard CSS (static check of the stylesheet/markup; full app needs `npm start`):
python3 -m http.server 8081 --directory public  # http://localhost:8081/
```

---

## File Structure

```
docs/assets/styles.css     # landing: shared block + aliased surface tokens + heading/button treatment
docs/index.html            # landing: remove two font <link rel="preload"> lines
docs/assets/fonts/         # DELETE the two .woff2 files (dir becomes empty → remove)
docs/assets/FONT-LICENSES.txt  # DELETE (no bundled fonts remain)
docs/PAGES.md              # fix the "self-hosted fonts" asset description
public/styles.css          # dashboard: shared block + token recolor + radius tokens + light-mode accent
```

---

## Task 1: Landing — adopt shared tokens, drop web fonts, mono headings

**Files:**
- Modify: `docs/assets/styles.css` (top region: comment, `@font-face`, `:root`; heading + button rules)
- Modify: `docs/index.html` (remove 2 preload links, lines 11-12)
- Delete: `docs/assets/fonts/vt323-latin-400-normal.woff2`, `docs/assets/fonts/ibm-plex-mono-latin-400-normal.woff2`
- Delete: `docs/assets/FONT-LICENSES.txt`
- Modify: `docs/PAGES.md` (font line)

**Interfaces:**
- Produces: the canonical shared `:root` block (consumed for sync-check in Task 4). Landing tokens `--phosphor`, `--phosphor-soft`, `--display`, `--mono`, `--glow` become aliases of the shared tokens.

- [ ] **Step 1: Replace the file header + `@font-face` + `:root` region**

In `docs/assets/styles.css`, replace the current lines 1–28 (the banner comment, both `@font-face` blocks, and the `:root{…}`) with this — the shared block followed by the landing's surface `:root` that aliases the old names:

```css
/* ============================================================
   mkcert-OS terminal landing — design system
   Shares the unified design language with the product dashboard.
   ============================================================ */

/* ===== SHARED DESIGN LANGUAGE — keep in sync with the other stylesheet.
   Canonical source: docs/superpowers/specs/2026-06-21-unified-design-language-design.md ===== */
:root {
  --accent:          #2cf5b8;
  --accent-soft:     #8cf5d4;
  --accent-contrast: #04140f;
  --accent-glow:     rgba(44, 245, 184, 0.40);
  --glow:            0 0 8px var(--accent-glow);
  --font-mono:       ui-monospace, 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', 'Courier New', monospace;
  --radius:          4px;
  --radius-lg:       8px;
  --border-width:    1px;
  --muted:           #7d8590;
  --success:         #4ade80;
  --warning:         #fbbf24;
  --error:           #f87171;
}
/* ===== END SHARED DESIGN LANGUAGE ===== */

:root {
  /* landing surface layer (near-black for CRT punch) */
  --bg:          #070b07;
  --bg-panel:    #0c130c;
  --border:      #2f4a40;   /* aqua-tinted dark */
  --text:        #c8f7da;   /* body — AA on --bg */
  --maxw:        1040px;
  /* aliases → shared language (keeps existing usage lines working) */
  --mono:        var(--font-mono);
  --display:     var(--font-mono);   /* VT323 retired; headings use shared mono */
  --phosphor:    var(--accent);
  --phosphor-soft: var(--accent-soft);
}
```

Note: this removes both `@font-face` blocks, the old `--amber` token (no longer referenced — status now uses `--warning`), and points `--glow` at the shared definition.

- [ ] **Step 2: Give structural headings the shared mono treatment**

The headings previously relied on VT323's look (`font-weight: 400`). With mono they need weight + uppercase. Update these rules in `docs/assets/styles.css`:

Change the base heading rule (was `h1, h2, .display { font-family: var(--display); font-weight: 400; letter-spacing: 1px; }`) to:
```css
h1, h2, .display { font-family: var(--display); font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; }
```
And add `font-weight: 700; text-transform: uppercase;` to these heading selectors (keep their existing font-size/color): `.section-head`, `.hero-title`, `.titlebar-name`, `.feature h3`, `.manifest dt`, `.console-prompt`, `.footer-sign`. For example `.section-head` becomes:
```css
.section-head {
  font-family: var(--display);
  font-size: clamp(28px, 4vw, 44px);
  color: var(--accent);
  margin: 0 0 18px;
  font-weight: 700;
  text-transform: uppercase;
}
```
**Do NOT uppercase the tagline:** leave `.hero-tagline` sentence-case (it stays `font-weight` default; you may set `font-weight: 600` but no `text-transform`). The console output (`.console-out`) and code blocks stay as-is.

- [ ] **Step 3: Round the buttons to the shared radius**

In `docs/assets/styles.css`, add `border-radius: var(--radius);` to `.btn` and to `.copy-btn` (both were square). Keep their inverse-video `:hover, :focus-visible` rules. The `.feature` cards and `.codeblock pre` may also take `border-radius: var(--radius);` for consistency (they were square) — add it to `.feature` and `.codeblock pre`. Leave `.monitor-screen` (10px) as the CRT bezel — it's a deliberate large frame; set it to `var(--radius-lg)`.

- [ ] **Step 4: Remove the font preloads from `docs/index.html`**

Delete these two lines (currently 11–12):
```html
  <link rel="preload" href="assets/fonts/vt323-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="preload" href="assets/fonts/ibm-plex-mono-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin />
```

- [ ] **Step 5: Delete the font assets and license, fix the docs note**

```bash
git rm docs/assets/fonts/vt323-latin-400-normal.woff2 \
       docs/assets/fonts/ibm-plex-mono-latin-400-normal.woff2 \
       docs/assets/FONT-LICENSES.txt
rmdir docs/assets/fonts 2>/dev/null || true
```
In `docs/PAGES.md`, update the asset description line that mentions fonts so it no longer claims self-hosted fonts (e.g. change "styles, scripts, self-hosted fonts, screenshot" → "styles, scripts, screenshot").

- [ ] **Step 6: Verify the landing**

```bash
python3 -m http.server 8080 --directory docs &  SRV=$!
sleep 1
# no font references remain anywhere in served files:
grep -riE "woff2|@font-face|VT323|IBM Plex|FONT-LICENSES" docs/index.html docs/assets/styles.css && echo "FAIL: font refs remain" || echo "OK: no font refs"
# no external resource loads (informational anchor hrefs are fine):
curl -s http://localhost:8080/ | grep -oE '(src|href)="https?://[^"]+"' | grep -v 'github.com\|hub.docker.com' && echo "FAIL: external resource" || echo "OK: no external resources"
curl -s -o /dev/null -w "index:%{http_code}\n" http://localhost:8080/
kill $SRV
```
Expected: "OK: no font refs", "OK: no external resources", `index:200`. Then open `http://localhost:8080/` and confirm: aqua accent throughout, mono uppercase headings, 4px buttons, CRT scanlines/boot still present, tagline still sentence-case. Toggle OS reduced-motion → boot/flicker off, content visible.

- [ ] **Step 7: Commit**

```bash
git add docs/assets/styles.css docs/index.html docs/PAGES.md
git commit -m "feat(landing): adopt shared design tokens, drop web fonts, mono headings"
```

---

## Task 2: Dashboard — shared tokens, recolor turquoise→aqua, light-mode accent

**Files:**
- Modify: `public/styles.css` (insert shared block; `:root` + `[data-theme="light"]` token values; global turquoise→aqua; neutralize ambient coral)

**Interfaces:**
- Consumes: the canonical shared block (must be byte-identical to Task 1's).
- Produces: dashboard reads aqua in dark + light; `--primary-color`/`--text-color` alias `var(--accent)`.

- [ ] **Step 1: Insert the shared token block**

In `public/styles.css`, immediately after the reset rule (`* { … box-sizing … }`, before the existing `:root` at line ~10), insert the canonical shared block **byte-identical** to the one in Task 1 Step 1 (the `/* ===== SHARED DESIGN LANGUAGE … */ :root { … } /* ===== END … */` block). Place it BEFORE the existing `:root` so the existing dark `:root` and the later `[data-theme="light"]` can reference `--accent`.

- [ ] **Step 2: Point the dark identity tokens at the accent**

In the existing dark `:root` (lines ~9–39), change these values:
```css
    --primary-color: var(--accent);      /* was #40e0d0 */
    --text-color: var(--accent);         /* was #40e0d0 */
    --button-bg: rgba(44, 245, 184, 0.1);        /* was rgba(64, 224, 208, 0.1) */
    --button-hover-bg: rgba(44, 245, 184, 0.2);  /* was rgba(64, 224, 208, 0.2) */
    --glow-primary: var(--accent-glow);  /* was rgba(64, 224, 208, 0.3) */
```
In the same block's `--backdrop-overlay`, change the turquoise radial `rgba(64, 224, 208, 0.03)` → `rgba(44, 245, 184, 0.03)`, and **neutralize the ambient coral**: change the second radial `rgba(255, 107, 107, 0.03)` → `rgba(44, 245, 184, 0.02)` (a faint second aqua wash instead of coral), so the page tint is a single hue family.

- [ ] **Step 3: Global replace remaining hardcoded turquoise**

Every remaining literal `rgba(64, 224, 208,` is a glow/border/background that should become aqua. Replace all occurrences in `public/styles.css`:
```bash
# from repo root:
sed -i '' 's/rgba(64, 224, 208,/rgba(44, 245, 184,/g' public/styles.css   # macOS sed
# verify none remain:
grep -nE "#40e0d0|64, ?224, ?208" public/styles.css && echo "FAIL: turquoise remains" || echo "OK: no turquoise"
```
Expected: "OK: no turquoise". (This covers lines previously at 439, 449–451, 461, 1001, 1004, 1314–1318, 1916–1919.)

- [ ] **Step 4: Light-mode accent (WCAG AA)**

In the `[data-theme="light"]` block (lines ~41–71), change:
```css
    --primary-color: #0a7c61;   /* was #198754 — deep teal, AA on light bg */
    --glow-primary: rgba(10, 124, 97, 0.18);   /* was rgba(25, 135, 84, 0.1) */
    --button-bg: rgba(10, 124, 97, 0.1);
    --button-hover-bg: rgba(10, 124, 97, 0.2);
```
Also add, inside this same `[data-theme="light"]` block, the light overrides of the shared accent tokens so the deep teal flows everywhere:
```css
    --accent: #0a7c61;
    --accent-contrast: #ffffff;
    --accent-glow: rgba(10, 124, 97, 0.18);
```
Leave `--text-color` (light) at its dark-on-light value `#212529` (body text stays dark on light — do not make it teal).

- [ ] **Step 5: Verify both themes**

```bash
python3 -m http.server 8081 --directory public &  SRV=$!
sleep 1
grep -nE "#40e0d0|64, ?224, ?208" public/styles.css && echo "FAIL turquoise" || echo "OK no turquoise"
curl -s -o /dev/null -w "css:%{http_code}\n" http://localhost:8081/styles.css
kill $SRV
npm test 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: "OK no turquoise", `css:200`, `pass 73 / fail 0`. Then open `http://localhost:8081/` (login page renders the stylesheet) and use DevTools to set `<html data-theme="light">` and `="dark">`: confirm aqua accent in dark, deep-teal accent in light, **body text legible in both** (spot-check contrast ≥4.5:1 on primary text via DevTools), no turquoise/coral identity remaining.

- [ ] **Step 6: Commit**

```bash
git add public/styles.css
git commit -m "feat(dashboard): adopt shared aqua accent across dark and light themes"
```

---

## Task 3: Dashboard — radius normalization to the shared scale

**Files:**
- Modify: `public/styles.css` (`border-radius` declarations)

**Interfaces:**
- Consumes: `--radius` / `--radius-lg` from the shared block (Task 2).

- [ ] **Step 1: Map component radii to `--radius` (4px)**

The dashboard mixes radii. Apply these exact, bounded replacements in `public/styles.css` (component-level rectangles → 4px; large containers → 8px; circles/pills untouched):
```bash
# component rectangles (buttons, cards, inputs, small panels): 6px and 8px → --radius
sed -i '' 's/border-radius: 6px;/border-radius: var(--radius);/g' public/styles.css
sed -i '' 's/border-radius: 8px;/border-radius: var(--radius);/g' public/styles.css
# large containers/modals: 10px, 12px, 15px → --radius-lg
sed -i '' 's/border-radius: 10px;/border-radius: var(--radius-lg);/g' public/styles.css
sed -i '' 's/border-radius: 12px;/border-radius: var(--radius-lg);/g' public/styles.css
sed -i '' 's/border-radius: 15px;/border-radius: var(--radius-lg);/g' public/styles.css
```
Leave untouched: `border-radius: 50%` (circular avatars/dots), `border-radius: 9px` and `border-radius: 3px` (one-off small details), and any `border-radius: 4px` already correct.

- [ ] **Step 2: Confirm what remains is intentional**

```bash
grep -nE "border-radius:" public/styles.css | grep -vE "var\(--radius|var\(--radius-lg\)|50%|9px|3px" && echo "REVIEW remaining literals above" || echo "OK: only tokens + intended one-offs remain"
```
Expected: "OK: only tokens + intended one-offs remain" (or a short list of `4px` literals, which are fine). If any unexpected literal remains, map it: rectangle → `var(--radius)`, large container → `var(--radius-lg)`.

- [ ] **Step 3: Verify visually**

```bash
python3 -m http.server 8081 --directory public &  SRV=$!
sleep 1
curl -s -o /dev/null -w "css:%{http_code}\n" http://localhost:8081/styles.css
kill $SRV
npm test 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `css:200`, `pass 73 / fail 0`. Open `http://localhost:8081/` and confirm buttons/cards/inputs now share the 4px corner, nothing looks visually broken (no element that should be a pill turned square; no oversized rounding lost where it mattered).

- [ ] **Step 4: Commit**

```bash
git add public/styles.css
git commit -m "feat(dashboard): normalize corner radius to shared 4px/8px scale"
```

---

## Task 4: Cross-surface sync verification + docs

**Files:**
- Create: `scripts/check-shared-tokens.sh`
- Modify: `README.md` (one line noting the shared design language)

**Interfaces:**
- Consumes: the shared block present in both stylesheets (Tasks 1–2).

- [ ] **Step 1: Write a sync-check script**

Create `scripts/check-shared-tokens.sh` that extracts the shared block from both stylesheets and fails if they differ:
```bash
#!/usr/bin/env bash
# Verify the SHARED DESIGN LANGUAGE :root block is byte-identical in both stylesheets.
set -euo pipefail
extract() {
  awk '/SHARED DESIGN LANGUAGE/{f=1} f{print} /END SHARED DESIGN LANGUAGE/{f=0}' "$1"
}
a=$(extract docs/assets/styles.css)
b=$(extract public/styles.css)
if [ -z "$a" ]; then echo "FAIL: shared block missing in docs/assets/styles.css"; exit 1; fi
if [ "$a" = "$b" ]; then
  echo "OK: shared design-language block is identical in both stylesheets"
else
  echo "FAIL: shared block differs between docs/assets/styles.css and public/styles.css"
  diff <(printf '%s' "$a") <(printf '%s' "$b") || true
  exit 1
fi
```

- [ ] **Step 2: Run it**

```bash
chmod +x scripts/check-shared-tokens.sh
./scripts/check-shared-tokens.sh
```
Expected: `OK: shared design-language block is identical in both stylesheets`. If it fails, reconcile the two blocks to match the canonical block in this plan's Global Constraints, then re-run.

- [ ] **Step 3: Note the shared language in `README.md`**

Add one line near the existing landing-page note:
```markdown
> 🎨 **Design:** the landing page and dashboard share one visual language (aqua-phosphor accent, system-mono, 4px shape). The shared token block lives in both stylesheets; `scripts/check-shared-tokens.sh` verifies they stay in sync.
```

- [ ] **Step 4: Final cross-surface check + commit**

```bash
./scripts/check-shared-tokens.sh
npm test 2>&1 | grep -E "^ℹ (pass|fail)"
git add scripts/check-shared-tokens.sh README.md
git commit -m "chore: add shared-token sync check and document the design language"
```
Expected: sync OK, `pass 73 / fail 0`. Finally, open both `http://localhost:8080/` (landing) and `http://localhost:8081/` (dashboard) side by side and confirm they read as one product: same aqua accent, same mono headings, same 4px shape; landing keeps CRT, dashboard stays clean with working light/dark.

---

## Self-Review (completed during planning)

**Spec coverage:**
- Shared token layer (duplicated block + banner + canonical source) → Task 1 Step 1 + Task 2 Step 1 + Task 4 sync check ✓
- Shared token values (accent/soft/contrast/glow/font/radius/border/muted/status) → canonical block in Global Constraints ✓
- Light-mode accent `#0a7c61` AA → Task 2 Step 4 ✓
- Landing recolor via aliases → Task 1 Step 1 ✓
- Landing remove web fonts (face/preload/woff2/licenses) → Task 1 Steps 1,4,5 ✓
- Landing mono uppercase headings, tagline sentence-case → Task 1 Step 2 ✓
- Landing 4px buttons, CRT preserved → Task 1 Steps 3,6 ✓
- Dashboard recolor turquoise→aqua (tokens + hardcoded) → Task 2 Steps 2,3 ✓
- Demote coral (ambient) → Task 2 Step 2 ✓
- Dashboard radius normalization → Task 3 ✓
- Glow discipline (primary glow stays; ambient coral neutralized) → Task 2 ✓
- Preserve light/dark toggle + components, no JS/HTML restructure → Tasks 2–3 scope ✓
- No external calls / npm test green → verification steps in every task ✓

**Placeholder scan:** no TBD/TODO; every step has concrete code/commands and expected output.

**Type/name consistency:** the canonical shared block is reproduced identically in Task 1 Step 1 and referenced (not retyped divergently) in Task 2 Step 1; token names (`--accent`, `--accent-soft`, `--accent-contrast`, `--accent-glow`, `--glow`, `--font-mono`, `--radius`, `--radius-lg`, `--muted`) are used consistently across tasks; the sync-check script (Task 4) enforces it mechanically.

**Note on `sed -i ''`:** commands use the macOS/BSD form (`sed -i ''`) matching this repo's `darwin` platform. On GNU/Linux use `sed -i` (no `''`).
