// src/pages/WhatsAppSigninPage.tsx
//
// Landing page for the sign-in link sent in the SUBSCRIBE confirmation
// message (see getOrCreateWhatsAppSigninLink in whatsapp-flow-webhook).
// Extracts the token, redeems it via whatsapp-signin-redeem, stashes
// return_to if the redemption returned a question_id (same key/format
// WebOptInCard.tsx's email flow already uses), then redirects to the
// action_link that comes back. That link is Supabase's own hosted
// magic-link verify endpoint — visiting it establishes the session and
// redirects to /auth/callback with #access_token=..., landing on the
// EXISTING OAuthCallbackPage flow (finalize(), runBootstrap(), the staged-
// stance commit, AND now the return_to navigation) completely unmodified
// beyond what return_to already made it do for the email flow.
import * as React from "react";
import { Loader2 } from "lucide-react";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/env";

function getTokenFromUrl(): string | null {
  // HashRouter: the query string lives inside window.location.hash, not
  // window.location.search — same extraction shape as getRefFromUrl() in
  // webStance.ts.
  const hash = window.location.hash || "";
  const qi = hash.indexOf("?");
  if (qi === -1) return null;
  return new URLSearchParams(hash.slice(qi + 1)).get("token");
}

export default function WhatsAppSigninPage() {
  const [error, setError] = React.useState<string | null>(null);
  const ranRef = React.useRef(false);

  React.useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    (async () => {
      const token = getTokenFromUrl();
      if (!token) {
        setError("This sign-in link is missing its token. Please use the link from your WhatsApp message.");
        return;
      }
      try {
        // Anon-key call, not a JWT — no session exists yet at this point,
        // by definition. Security here is the token itself (short-lived,
        // single-use), not the caller's identity — see
        // whatsapp-signin-redeem's header comment.
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-signin-redeem`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            apikey: SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ token }),
        });
        const data = await resp.json();
        if (!resp.ok || !data?.ok || !data?.action_link) {
          setError(
            data?.reason === "invalid_or_expired_token"
              ? "This sign-in link has expired or was already used. Reply SUBSCRIBE on WhatsApp to get a fresh one."
              : "Couldn't sign you in. Please try again from WhatsApp."
          );
          return;
        }
        // Same key and format WebOptInCard.tsx's email flow already uses —
        // OAuthCallbackPage.tsx's finalize() reads this after establishing
        // the session and navigates here instead of falling back to the
        // homepage. Set BEFORE the redirect below, since action_link takes
        // the browser away from this page entirely.
        //
        // Fallback to My Stances (not the homepage) when there's no
        // specific question_id: getOrCreateWhatsAppSigninLink already
        // checks both a web-staged commit AND whatsapp_active_sessions (a
        // question answered directly via WhatsApp Flow) before giving up,
        // so a null here means genuinely nothing to point at — but "here's
        // everything on your new account" is still a better landing than
        // an unrelated new trending question, even then.
        try {
          window.localStorage.setItem(
            "return_to",
            data.question_id ? `#/q/${data.question_id}` : "#/me/stances"
          );
        } catch {
          // Non-fatal — worst case this falls back to the homepage.
        }
        window.location.replace(data.action_link);
      } catch {
        setError("Couldn't reach the server. Check your connection and try again.");
      }
    })();
  }, []);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-sm space-y-2 text-center">
          <p className="text-sm font-semibold text-slate-800">Sign-in link problem</p>
          <p className="text-sm text-slate-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
        <p className="text-sm text-slate-600">Signing you in…</p>
      </div>
    </div>
  );
}
