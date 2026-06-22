# Unified Design Language — Landing ↔ Dashboard

**Date:** 2026-06-21
**Status:** Approved design, pending implementation plan
**Owner:** Jeff Caldwell

## Goal

Bring the terminal-themed GitHub Pages **landing** (`docs/`) and the actual product
**dashboard** (`public/`) into one coherent visual identity — "meet in the middle" —
while keeping each surface's essential character: the landing keeps its CRT
signature, the dashboard keeps its light/dark theming and stays a clean working
tool.

## Decisions (locked via visual brainstorming)

| Dimension | Decision |
|-----------|----------|
| Direction | Meet in the middle — define one shared language, nudge **both** surfaces toward it |
| Accent | **Aqua-phosphor `#2cf5b8`** (dark); a deep teal for light mode |
| Typography | **System monospace stack everywhere**; landing **drops** VT323 + IBM Plex Mono web fonts. Headings = same mono, **bold + uppercase + letter-spacing** |
| Shape & density | **4px** radius, **1px** borders, glow reserved for **primary action + focus** |
| Signature effects | **CRT stays the landing's signature only**; dashboard stays clean with the shared aqua glow |
| Preserve | Dashboard light mode · landing CRT signature · product stability (dashboard = recolor, not restructure) |

## Architecture: shared token layer

There is **no build step**, and the two stylesheets are served from different roots
(`docs/` as GitHub Pages, `public/` by the Express app). A literal shared import is
therefore not practical without introducing a build, which neither surface warrants.

**Approach:** define the shared design tokens as a clearly-delimited `:root` block
that is **duplicated verbatim in both** `docs/assets/styles.css` and
`public/styles.css`, each wrapped in a comment banner:

```
/* ===== SHARED DESIGN LANGUAGE — keep in sync with the other stylesheet.
   Canonical source: docs/superpowers/specs/2026-06-21-unified-design-language-design.md ===== */
```

Honest tradeoff: the two copies must be kept in sync by hand; this spec is the
canonical reference. (Rejected alternative: a build/bundler to share one file —
disproportionate for two small stylesheets.)

Each stylesheet keeps its **own surface-layer tokens** (backgrounds, panel
treatments) on top of the shared tokens, because the landing intentionally runs a
darker near-black for CRT punch while the dashboard uses its GitHub-dark gradient
and a full light theme.

### Shared tokens (canonical values)

Dark (default on both surfaces):

| Token | Value | Notes |
|-------|-------|-------|
| `--accent` | `#2cf5b8` | the shared signature hue |
| `--accent-soft` | `#8cf5d4` | lighter aqua for secondary emphasis |
| `--accent-contrast` | `#04140f` | near-black text on an accent-filled control |
| `--accent-glow` | `rgba(44, 245, 184, 0.40)` | used only in `--glow` |
| `--glow` | `0 0 8px var(--accent-glow)` | primary action + focus only |
| `--font-mono` | `ui-monospace, 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', 'Courier New', monospace` | everything |
| `--radius` | `4px` | default for cards, buttons, inputs |
| `--radius-lg` | `8px` | large containers/modals (optional, where 4px looks cramped) |
| `--border-width` | `1px` | |
| `--muted` | `#7d8590` | shared neutral grey for secondary text |
| `--success` | `#4ade80` | status — shared |
| `--warning` | `#fbbf24` | status — shared |
| `--error` | `#f87171` | status — shared |

Light mode (dashboard only): the accent is darkened into the same hue family for
WCAG AA on light surfaces.

| Token | Value | Notes |
|-------|-------|-------|
| `--accent` (light) | `#0a7c61` | deep teal; must pass AA (≥4.5:1) as text on the light bg |
| `--accent-contrast` (light) | `#ffffff` | text on accent-filled control |
| `--accent-glow` (light) | `rgba(10, 124, 97, 0.18)` | softer glow on light |

**Heading treatment (shared):** `font-family: var(--font-mono); font-weight: 700;
text-transform: uppercase; letter-spacing: 1.5px;` applied to display/section
headings on both surfaces. (Hero/large display headings may scale letter-spacing
up proportionally.)

**Button language (shared):** primary = accent fill + `--accent-contrast` text +
`--glow`, `--radius`; secondary = 1px border, accent or neutral text, no glow,
`--radius`; focus-visible = visible accent outline/inverse (never `outline:none`
without a replacement).

## Landing (`docs/`) — recolor + de-font, keep CRT

1. Replace the green phosphor tokens with the shared aqua set:
   - `--phosphor #2bff88` → `--accent #2cf5b8`; `--phosphor-soft #7dffb8` →
     `--accent-soft #8cf5d4`; keep the pale body text token `--text` at `#c8f7da`;
     `--muted #5f9d77` → shared `--muted #7d8590`;
     `--border #15431f` → aqua-tinted dark `#2f4a40`. Keep the near-black
     surface (`--bg`) for CRT contrast; drop the unused `--amber` reserve (status
     uses `--warning` now).
2. **Remove web fonts:** delete the VT323 and IBM Plex Mono `@font-face` blocks,
   the `<link rel="preload">` font tags, and the three `.woff2` files under
   `docs/assets/fonts/`; remove `docs/assets/FONT-LICENSES.txt` (no bundled fonts
   remain). Set the display/body font to `var(--font-mono)`.
3. Convert hero title and `>_ SECTION` headers from VT323 to the shared mono
   heading treatment (bold/uppercase/letter-spacing). The `>_ ` prefix stays.
4. Buttons: square → `--radius` (4px); primary actions become accent-fill+glow,
   secondary become outline (matching the shared button language).
5. **Keep unchanged:** CRT scanlines, vignette, flicker, boot sequence, blinking
   carets, console easter egg, and all `prefers-reduced-motion` / JS-disabled
   fallbacks. Update the boot/caret colors to the aqua accent.
6. Re-verify: still zero external network calls (now also zero font downloads),
   reduced-motion + JS-off paths intact, WCAG AA body text on the dark surface.

## Dashboard (`public/`) — recolor + tighten, keep light mode

The dashboard is already heavily tokenized (≈319 `var()` uses), so most of this is
editing the `:root` / `[data-theme]` token values, plus a small sweep of hardcoded
values and radii.

1. **Recolor tokens:** dark `--primary-color` and `--text-color` `#40e0d0` →
   `#2cf5b8`; all `--glow-*` and the ~19 inline `rgba(64,224,208,…)` and 2 hardcoded
   `#40e0d0` → the aqua equivalents (`rgba(44,245,184,…)` / `#2cf5b8`). Light-mode
   `--primary-color #198754` → `#0a7c61` (verify AA), with matching light glow.
2. **Demote coral:** the 8 `#ff6b6b` / `rgba(255,107,107,…)` occurrences are no
   longer part of the identity — repoint identity/glow uses to the accent; coral may
   remain only where it reads as an incidental/destructive accent. Secondary blue
   `#8cc8ff` stays as an incidental secondary (links), not identity.
3. **Radius normalization:** introduce `--radius` (4px) / `--radius-lg` (8px) and
   replace the common interactive-control and card radii (the 6px ×12 and most 8px
   ×16 component uses) with the tokens. Pills/toggles/badges that rely on their shape
   keep it. Goal: consistent 4px on cards, buttons, inputs, modals — not a blind
   global replace.
4. **Glow discipline:** keep glow on primary buttons, hover, and focus; remove
   ambient glow that doesn't serve emphasis (so the tool stays calm).
5. **Heading treatment:** apply the shared uppercase/letter-spacing mono treatment
   to `header h1` and `section h2` (they already use letter-spacing + the mono
   stack), keeping per-theme text-shadow rules.
6. **Keep unchanged:** the light/dark `data-theme` toggle and all its overrides, the
   system-mono font (already in use), every component and button variant, layout,
   and behavior. No structural/HTML/JS changes — recolor + radius only.
7. Re-verify: light **and** dark themes both legible (AA), the theme toggle still
   works, no component visually broken by the radius/glow changes.

## Out of scope

- No new build tooling or CSS bundler.
- No HTML restructuring or JS behavior changes in the dashboard.
- No new dashboard "CRT mode" toggle (effects decision was "landing-only CRT").
- Landing content/sections unchanged (this is a restyle, not a rewrite).

## Success criteria

- Landing and dashboard visibly read as **one product**: same accent, mono type,
  4px shape, glow discipline.
- Landing keeps the CRT signature and all accessibility fallbacks; **no web-font
  downloads and no external calls**.
- Dashboard keeps a working light **and** dark theme, both WCAG AA; theme toggle
  and all components function unchanged.
- The shared `:root` token block is byte-identical in both stylesheets and carries
  the sync banner pointing at this spec.

## Risks

- **Token drift** between the two copies — mitigated by the banner + this spec as
  source of truth; a future task could add a CI check that the two blocks match.
- **Light-mode contrast** of the deep-teal accent — must be verified at AA for text
  uses (buttons use dark/white text on the fill, which is safe).
- **Radius sweep** touching many rules — risk of missing or over-applying; the plan
  enumerates exactly which selectors change.
