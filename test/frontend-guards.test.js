const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function htmlPages(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlPages(rel));
    else if (entry.name.endsWith('.html')) out.push(rel);
  }
  return out;
}

// Every page under public/ is on the split-pane design.
const REDESIGNED = htmlPages('public');

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

test('no page references styles.css or font-awesome', () => {
  assert.ok(REDESIGNED.length >= 6);
  for (const rel of REDESIGNED) assert.doesNotMatch(read(rel), /styles\.css|font-?awesome|cdnjs/i, rel);
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

// ---- Error text guard ----
// Error bodies become text through MK.core.formatApiError (error, reason,
// ref). A controller that reads body.error itself drops the reason and ref.
test('page controllers never build error text from body.error / body.message', () => {
  for (const rel of walkJs('public/js').filter((r) => r !== 'public/js/core.js')) {
    const code = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const hits = code.match(/\bbody\s*(?:&&\s*\(?\s*(?:err\.)?body\s*)?\.\s*(?:error|message)\b/g) || [];
    assert.deepStrictEqual(hits, [], `${rel}: use err.message or core.formatApiError(body, status)`);
  }
});

// ---- Page skeleton guard ----
function scriptsOf(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
}

function controllerOf(rel) {
  const base = path.posix.basename(rel, '.html');
  return 'js/' + (base === 'index' ? 'certificates' : base) + '.js';
}

// Every page links the same icons and web manifest from public/assets/.
const HEAD_LINKS = [
  '<link rel="icon" href="/assets/favicon.ico">',
  '<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32x32.png">',
  '<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">',
  '<link rel="manifest" href="/assets/site.webmanifest">'
];

function pageProblems(rel, html) {
  const problems = [];
  const head = (/<head>([\s\S]*?)<\/head>/.exec(html) || [])[1] || '';
  for (const link of HEAD_LINKS) {
    if (!head.includes(link)) problems.push('missing ' + link + ' in <head>');
  }
  const scripts = scriptsOf(html);
  const isLogin = path.posix.basename(rel) === 'login.html';
  const controller = controllerOf(rel);
  if (scripts[0] !== 'js/core.js') problems.push('js/core.js is not the first script');
  if (scripts[scripts.length - 1] !== controller) problems.push(controller + ' is not the last script');
  if (isLogin) {
    if (scripts.includes('js/shell.js')) problems.push('login must not load js/shell.js');
  } else {
    if (scripts[1] !== 'js/shell.js') problems.push('js/shell.js does not follow js/core.js');
    if (!/<header id="shell"><\/header>/.test(html)) problems.push('missing <header id="shell">');
    if (!/<main\b/.test(html)) problems.push('missing <main>');
  }
  return problems;
}

test('pageProblems flags broken page skeletons', () => {
  const head = '<head>' + HEAD_LINKS.join('') + '</head>';
  const good = head + '<header id="shell"></header><main></main>' +
    '<script src="js/core.js"></script><script src="js/shell.js"></script><script src="js/scep.js"></script>';
  assert.deepStrictEqual(pageProblems('public/scep.html', good), []);
  for (const link of HEAD_LINKS) {
    assert.ok(pageProblems('public/scep.html', good.replace(link, '')).length > 0, 'without ' + link);
  }
  // Links outside <head> don't count.
  assert.ok(pageProblems('public/scep.html', '<head></head>' + HEAD_LINKS.join('') + good.slice(head.length)).length > 0);
  for (const bad of [
    good.replace('<script src="js/core.js"></script>', ''),
    good.replace('<script src="js/shell.js"></script>', ''),
    '<header id="shell"></header><main></main><script src="js/shell.js"></script><script src="js/core.js"></script><script src="js/scep.js"></script>',
    good.replace('<script src="js/scep.js"></script>', '') + '<script src="js/scep.js"></script><script src="js/extra.js"></script>',
    good.replace('<header id="shell"></header>', ''),
    good.replace('<main></main>', ''),
  ]) assert.ok(pageProblems('public/scep.html', bad).length > 0, bad);
  assert.ok(pageProblems('public/login.html',
    '<main></main><script src="js/core.js"></script><script src="js/shell.js"></script><script src="js/login.js"></script>').length > 0);
  assert.deepStrictEqual(pageProblems('public/login.html',
    head + '<main></main><script src="js/core.js"></script><script src="js/login.js"></script>'), []);
});

test('every page loads core.js (then shell.js, except login) before its controller', () => {
  assert.ok(REDESIGNED.includes('public/login.html'));
  for (const rel of REDESIGNED) assert.deepStrictEqual(pageProblems(rel, read(rel)), [], rel);
});

test('delete, archive and restore reload the list and toast on a stale-list 404', () => {
  const src = read('public/js/certificates.js');
  for (const name of ['deleteCertificate', 'archiveCertificate', 'restoreCertificate']) {
    const start = src.indexOf(`async function ${name}(`);
    assert.ok(start >= 0, `${name} not found`);
    const body = src.slice(start, src.indexOf('\n  }\n', start));
    assert.match(body,
      /if \(model\.isStaleListError\(err\)\) \{\s*await load\(\);\s*toast\(model\.staleListMessage\(certName\), 'err'\);/,
      `${name} must reload and toast on 404`);
  }
});

test('/favicon.ico redirects to the icon in public/assets', () => {
  const src = read('server.js');
  const m = /app\.get\('\/favicon\.ico',[^)]*\)\s*=>\s*\{\s*res\.redirect\(301, '([^']+)'\);/.exec(src);
  assert.ok(m, 'server.js must redirect /favicon.ico');
  assert.ok(fs.existsSync(path.join(ROOT, 'public', m[1])), m[1] + ' must exist under public/');
});

test('the web manifest names the app and points at existing icons', () => {
  const manifest = JSON.parse(read('public/assets/site.webmanifest'));
  assert.strictEqual(manifest.name, 'mkcert Web UI');
  assert.strictEqual(manifest.short_name, 'mkcert');
  assert.ok(manifest.icons.length >= 2);
  for (const icon of manifest.icons) {
    assert.match(icon.src, /^\/assets\//);
    assert.ok(fs.existsSync(path.join(ROOT, 'public', icon.src)), icon.src);
  }
});
