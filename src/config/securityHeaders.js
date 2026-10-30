// Security headers (helmet) configuration, extracted from server.js so tests
// can mount it without booting the full server (which starts listening on
// require — see startServer() at the bottom of server.js).
const helmet = require('helmet');

// CSP allows only same-origin resources: no third-party CDNs and no inline
// code. Scripts and styles load from files under public/ (no <script> or
// <style> blocks, no style="" attributes); dynamic widths are set through
// CSSOM (el.style.x), which CSP permits. Inline event-handler ATTRIBUTES stay
// blocked: helmet's default script-src-attr 'none' is inherited via
// useDefaults, and the frontend is wired exclusively through addEventListener
// (issue #42).
const helmetOptions = {
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src':  ["'self'"],
      'style-src':   ["'self'"],
      'font-src':    ["'self'", 'data:'],
      'img-src':     ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'frame-ancestors': ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false, // we serve PEM downloads; COEP would block
  referrerPolicy: { policy: 'no-referrer' }
};

function securityHeaders() {
  return helmet(helmetOptions);
}

module.exports = { securityHeaders, helmetOptions };
