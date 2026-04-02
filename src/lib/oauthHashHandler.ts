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
// (path = /auth/callback with #access_token or ?code= in the URL),
// it rewrites the URL to the HashRouter-compatible form:
//   /#/auth/callback#access_token=...
// so React Router sees the /auth/callback route AND Supabase can read the token.
//
// Call handleOAuthHashRedirect() at the very top of main.tsx, before ReactDOM.render.

export function handleOAuthHashRedirect(): void {
  try {
    const url = new URL(window.location.href);

    // Only act on the /auth/callback path (the redirect URI we registered with providers)
    if (!url.pathname.endsWith("/auth/callback")) return;

    const hash = url.hash; // e.g. #access_token=xxx&token_type=bearer&...
    const search = url.search; // e.g. ?code=xxx (PKCE flow)

    const isTokenHash = hash.includes("access_token=") || hash.includes("error=");
    const isCodeFlow = search.includes("code=") || search.includes("error=");

    if (!isTokenHash && !isCodeFlow) return;

    // Already in HashRouter form — don't double-redirect
    if (url.hash.startsWith("#/")) return;

    // Build the new URL: HashRouter path + Supabase token/code as secondary hash
    // We encode the auth params as the hash of the hash-route URL
    // Supabase JS SDK reads from window.location.hash, so this works.
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
