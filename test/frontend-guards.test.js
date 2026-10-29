const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Pages that have been rebuilt on the split-pane design; each task appends its page.
const REDESIGNED = ['public/styleguide.html'];

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
