const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Pages that have been rebuilt on the split-pane design; each task appends its page.
const REDESIGNED = ['public/styleguide.html', 'public/index.html', 'public/root-ca.html', 'public/notifications.html', 'public/scep.html', 'public/settings.html'];

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (/\.(html|js|css)$/.test(entry.name)) out.push({ rel, src: read(rel) });
  }
  return out;
}

test('shared design-language block is identical in app.css and docs styles', () => {
  const block = (s) => s.slice(
    s.indexOf('/* ===== SHARED DESIGN LANGUAGE'),
    s.indexOf('/* ===== END SHARED DESIGN LANGUAGE ===== */')
  );
  const a = block(read('public/css/app.css'));
  assert.ok(a.length > 100);
  assert.strictEqual(a, block(read('docs/assets/styles.css')));
});

test('no inline event handlers anywhere under public/ (including subfolders)', () => {
  for (const f of walk('public')) assert.doesNotMatch(f.src, /\son[a-z]+\s*=\s*["']/i, f.rel);
});

test('no external URLs in redesigned pages', () => {
  for (const rel of REDESIGNED) assert.doesNotMatch(read(rel), /(src|href)=["']https?:\/\//i, rel);
});

test('app.css defines light-theme overrides for every surface token', () => {
  const css = read('public/css/app.css');
  for (const t of ['--bg', '--bg-pane', '--text', '--border', '--info', '--prompt', '--accent'])
    assert.match(css, new RegExp(`\\[data-theme="light"\\][^}]*${t}:`, 's'), t);
});

// ---- Side-stripe guard (value-based) ----
const SIDE_PROP = '(?:left|right|inline-start|inline-end)';
const SIDE_CSS = new RegExp(`(border-${SIDE_PROP}(?:-width|-color|-style)?)\\s*:\\s*([^;}\\n]*)`, 'gi');
const SIDE_JS = /\bborder(?:Left|Right|InlineStart|InlineEnd)(?:Width|Color|Style)?\b\s*[:=]\s*([^;,\n}]*)/g;
const SIDE_SETPROP = new RegExp(`['"](border-${SIDE_PROP}(?:-width|-color|-style)?)['"]\\s*,\\s*([^)\\n]*)`, 'gi');
const NEUTRAL_VALUE = /^(?:0|0px|none|1px|transparent|(?:1px\s+solid\s+)?(?:var\(--border(?:-strong)?\)|transparent))$/i;

function stripComments(src, isJs) {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  if (isJs) out = out.replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
  return out;
}

function neutralBorderValue(raw) {
  const v = raw.replace(/!important/i, '').replace(/['"`]/g, '').replace(/\s+/g, ' ').trim();
  return NEUTRAL_VALUE.test(v);
}

function blankFunctions(v) {
  let prev;
  do { prev = v; v = v.replace(/[a-z-]+\([^()]*\)/gi, ' '); } while (v !== prev);
  return v;
}

function splitTopLevel(v) {
  const parts = []; let depth = 0, cur = '';
  for (const ch of v) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

function sideShadow(value) {
  return splitTopLevel(value).some((shadow) => {
    const nums = (blankFunctions(shadow).match(/-?\d*\.?\d+(?:px)?(?=\s|$)/g) || []).map(parseFloat);
    if (nums.length < 2) return false;
    const [x, y, blur = 0] = nums;
    return blur === 0 && (x !== 0) !== (y !== 0);
  });
}

function findSideStripes(src, { js = false } = {}) {
  const code = stripComments(src, js);
  const found = [];
  const check = (prop, value) => { if (!neutralBorderValue(value)) found.push(`${prop}: ${value.trim()}`); };
  for (const m of code.matchAll(SIDE_CSS)) check(m[1], m[2]);
  for (const m of code.matchAll(SIDE_SETPROP)) check(m[1], m[2]);
  if (js) for (const m of code.matchAll(SIDE_JS)) check(m[0].split(/[:=]/)[0].trim(), m[1]);
  for (const m of code.matchAll(/(?:box-shadow|boxShadow)\s*[:=]\s*([^;}\n]*)/gi)) {
    if (sideShadow(m[1])) found.push(`box-shadow: ${m[1].trim()}`);
  }
  return found;
}

function walkJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'legacy') out.push(...walkJs(rel)); }
    else if (entry.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

test('findSideStripes flags stripes and allows neutral dividers, rings and drop shadows', () => {
  for (const bad of [
    'a{border-left: 3px solid var(--accent)}',
    'a{border-inline-start: 2px solid red}',
    'a{border-right-width: 3px}',
    'a{border-left-style: solid}',
    'a{border-left: 1px solid var(--error)}',
    'a{box-shadow: inset 2px 0 0 var(--accent)}',
    'a{box-shadow: 3px 0 0 #2cf5b8 inset}',
    'a{box-shadow: 0 0 8px red, inset -3px 0 0 var(--accent)}',
  ]) assert.ok(findSideStripes(bad).length > 0, bad);
  for (const bad of [
    "el.style.borderLeft = '3px solid var(--accent)'",
    "el.style.borderInlineStart = '2px solid red'",
    "el.style.borderRightColor = 'var(--accent)'",
    "el.style.setProperty('border-left', '3px solid red')",
    "el.style.boxShadow = 'inset 2px 0 0 red'",
  ]) assert.ok(findSideStripes(bad, { js: true }).length > 0, bad);
  for (const ok of [
    'a{border-inline-end: 1px solid var(--border)}',
    'a{border-right: 1px solid var(--border-strong)}',
    'a{border-left: 0}',
    'a{border-inline-end: 0}',
    'a{border-left-width: 1px}',
    'a{border-left-color: var(--border)}',
    'a{box-shadow: 0 0 0 3px var(--accent-wash)}',
    'a{box-shadow: 0 4px 16px rgba(0,0,0,.3)}',
    '/* no border-left stripes */ a{color:red}',
  ]) assert.deepStrictEqual(findSideStripes(ok), [], ok);
  assert.deepStrictEqual(findSideStripes('// border-left: 3px solid red\nconst a = 1;', { js: true }), []);
});

test('no side-stripe accents in redesigned CSS/HTML/JS', () => {
  const cssDir = path.join(ROOT, 'public/css');
  const files = [
    ...fs.readdirSync(cssDir).filter((n) => n.endsWith('.css')).map((n) => `public/css/${n}`),
    ...REDESIGNED,
    ...walkJs('public/js'),
  ];
  for (const rel of files) {
    const hits = findSideStripes(read(rel), { js: rel.endsWith('.js') });
    assert.deepStrictEqual(hits, [], `${rel}: side-stripe accent(s) found`);
  }
});
