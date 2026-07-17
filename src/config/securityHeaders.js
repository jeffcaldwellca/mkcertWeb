// Security headers (helmet) configuration, extracted from server.js so tests
// can mount it without booting the full server (which starts listening on
// require — see startServer() at the bottom of server.js).
const helmet = require('helmet');

// CSP allows the FontAwesome CDN and the inline style/script *blocks* the app
// currently uses. Inline event-handler ATTRIBUTES stay blocked: helmet's
// default script-src-attr 'none' is inherited via useDefaults, and the
// frontend is wired exclusively through addEventListener (issue #42).
const helmetOptions = {
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src':  ["'self'", "'unsafe-inline'"],
      'style-src':   ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      'font-src':    ["'self'", 'https://cdnjs.cloudflare.com', 'data:'],
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
