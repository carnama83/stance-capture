// src/lib/oauthHashHandler.ts
// Epic V — Social Authentication
//
// Problem: The app uses HashRouter (#/path). Supabase OAuth redirects return
// the access token in the URL hash fragment: /auth/callback#access_token=...
//
// HashRouter sees "auth/callback" as a path fragment and strips the token
// params before Supabase can parse them, breaking the OAuth flow.
//
// Solution: This module runs ONCE at app startup, before any React rendering.
// If the current URL looks like a Supabase OAuth callback
// (path = /auth/callback with #access_token or ?code= or ?token_hash= in the URL),
// it rewrites the URL to the HashRouter-compatible form:
//   /#/auth/callback#access_token=...  (implicit flow)
//   /#/auth/callback#code=...          (PKCE flow)
//   /#/auth/callback#token_hash=...    (email confirmation flow)
// so React Router sees the /auth/callback route AND OAuthCallbackPage can parse params.
//
// FIX: Added token_hash= to isCodeFlow detection. Previously, email confirmation
// links (https://site.com/auth/callback?token_hash=xxx&type=signup) were not
// rewritten because only code= and error= were matched. This meant HashRouter
// rendered "/" instead of OAuthCallbackPage, so emails were never confirmed and
// users could not log in ("Email not confirmed" error).
//
// Call handleOAuthHashRedirect() at the very top of main.tsx, before ReactDOM.render.

export function handleOAuthHashRedirect(): void {
  try {
    const url = new URL(window.location.href);

    // Only act on the /auth/callback path (the redirect URI we registered with providers)
    if (!url.pathname.endsWith("/auth/callback")) return;

    const hash = url.hash; // e.g. #access_token=xxx&token_type=bearer&...
    const search = url.search; // e.g. ?code=xxx (PKCE) or ?token_hash=xxx (email confirm)

    const isTokenHash = hash.includes("access_token=") || hash.includes("error=");

    // FIX: token_hash= added alongside code= and error=.
    // All three arrive as query params (?...) not hash fragments, so they all
    // take the search.slice(1) branch below and are passed through correctly.
    const isCodeFlow =
      search.includes("code=") ||
      search.includes("token_hash=") ||
      search.includes("error=");

    if (!isTokenHash && !isCodeFlow) return;

    // Already in HashRouter form — don't double-redirect
    if (url.hash.startsWith("#/")) return;

    // Build the new URL: HashRouter path + Supabase params as secondary hash.
    // OAuthCallbackPage's extractAuthParams() reads from window.location.hash
    // and handles both formats:
    //   /#/auth/callback#access_token=...  (implicit — hash fragment)
    //   /#/auth/callback#code=...          (PKCE — originally a query param)
    //   /#/auth/callback#token_hash=...    (email confirm — originally a query param)
    const authParams = isCodeFlow
      ? search.slice(1) // strip leading ?
      : hash.slice(1);  // strip leading #

    const newUrl = `${url.origin}${url.pathname.replace("/auth/callback", "")}#/auth/callback#${authParams}`;

    window.location.replace(newUrl);
  } catch (e) {
    // Never block app startup
    console.warn("[oauthHashHandler] Error processing OAuth redirect:", e);
  }
}
