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
      if (reduceMotion) { skip(); return resolve(); }
      var li = 0, ci = 0;
      (function tick() {
        if (skipped) return resolve();
        if (li >= lines.length) return resolve();
        var line = lines[li];
        if (ci <= line.length) {
          el.textContent = lines.slice(0, li).join('\n') +
            (li > 0 ? '\n' : '') + line.slice(0, ci);
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

    function dismiss() { boot.style.display = ''; boot.classList.add('is-hidden'); cleanup(); }
    function cleanup() {
      window.removeEventListener('keydown', onSkip);
      window.removeEventListener('click', onSkip);
    }
    var t;
    function onSkip() { if (t) t.skip(); sessionStorage.setItem('mkcertos_booted', '1'); dismiss(); }

    // Skip entirely if already booted this session or reduced motion.
    if (sessionStorage.getItem('mkcertos_booted') === '1' || reduceMotion) {
      return;
    }

    // JS is running and boot should play — show the overlay.
    boot.style.display = 'flex';

    var lines = [
      'ROBCO-STYLE TERMLINK // MKCERT-OS',
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
    t = typeLines(textEl, lines, { speed: 14, linePause: 160 });
    t.promise.then(function () {
      sessionStorage.setItem('mkcertos_booted', '1');
      setTimeout(dismiss, 650);
    });
  }

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
      if (res.clear) { out.replaceChildren(); }
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

  // expose for later tasks
  window.MKCERTOS = { typeLines: typeLines, reduceMotion: reduceMotion };

  document.addEventListener('DOMContentLoaded', function () {
    runBoot();
    var tagline = document.getElementById('hero-tagline');
    if (tagline) {
      window.MKCERTOS.typeLines(tagline, ['Local TLS, minus the pain.'],
        { speed: 38, linePause: 0 });
    }
    initCopyButtons();
    initConsole();
  });
})();
