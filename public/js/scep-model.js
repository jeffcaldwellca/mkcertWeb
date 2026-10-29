(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.MK = root.MK || {}; root.MK.scepModel = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 'used' | 'expired' | 'pending', derived at render time from expiresAt so
  // a challenge that expires while the page is open flips without a refetch.
  // The server's fetch-time `expired` flag only ever adds expiry (it can't
  // un-expire), and is the fallback when expiresAt is unreadable.
  function challengeState(c, now) {
    if (c.used) return 'used';
    if (c.expired) return 'expired';
    const t = new Date(c.expiresAt).getTime();
    if (!isNaN(t) && t <= now.getTime()) return 'expired';
    return 'pending';
  }

  function activeCount(challenges, now) {
    return (challenges || []).filter((c) => challengeState(c, now) === 'pending').length;
  }

  function relExpiry(expiresAt, now) {
    const ms = new Date(expiresAt) - now;
    if (isNaN(ms)) return 'unknown';
    if (ms <= 0) return 'expired';
    const min = Math.floor(ms / 60000);
    if (min < 1) return '<1m';
    if (min < 60) return min + 'm';
    const h = Math.floor(min / 60);
    if (h < 48) return h + 'h ' + (min % 60) + 'm';
    const d = Math.floor(h / 24);
    return d + 'd ' + (h % 24) + 'h';
  }

  return { challengeState, activeCount, relExpiry };
});
