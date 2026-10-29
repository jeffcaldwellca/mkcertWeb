// Login page controller. Page controllers don't export.
(function () {
  'use strict';

  const core = window.MK.core;
  const api = core.createApiClient();

  const ERRORS = {
    invalid_credentials: 'Invalid username or password. Please try again.',
    missing_credentials: 'Please enter both username and password.',
    oidc_failed: 'Single sign-on failed. Check the server log for the reason, or sign in with a username and password.'
  };
  const DEFAULT_ERROR = 'An error occurred. Please try again.';

  function showError() {
    const code = new URLSearchParams(window.location.search).get('error');
    if (!code) return;
    const el = document.getElementById('login-error');
    el.textContent = Object.prototype.hasOwnProperty.call(ERRORS, code) ? ERRORS[code] : DEFAULT_ERROR;
    el.hidden = false;
  }

  async function checkOidc() {
    try {
      const response = await fetch('/api/auth/methods');
      const methods = await response.json();
      if (methods.oidc && methods.oidc.enabled) {
        document.getElementById('oidc-login-section').hidden = false;
      }
    } catch (error) {
      console.warn('Failed to check OIDC availability:', error);
    }
  }

  showError();
  document.getElementById('theme-toggle').addEventListener('click', () => core.toggleTheme());
  core.initTheme(api);
  checkOidc();
})();
