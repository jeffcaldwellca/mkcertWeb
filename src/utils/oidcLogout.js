// RP-initiated logout (OpenID Connect RP-Initiated Logout 1.0).
//
// After we destroy our own session, an SSO user is still logged in at the
// provider, so clicking "Login with SSO" again would silently sign them back
// in. If discovery advertised an `end_session_endpoint`, we send the browser
// there with the ID token as a hint and ask to be returned to our login page.
function buildEndSessionUrl(endSessionEndpoint, { idToken, postLogoutRedirectUri } = {}) {
  if (!endSessionEndpoint) return null;
  let url;
  try {
    url = new URL(endSessionEndpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (idToken) url.searchParams.set('id_token_hint', idToken);
  if (postLogoutRedirectUri) url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
  return url.toString();
}

module.exports = { buildEndSessionUrl };
