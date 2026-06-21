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
