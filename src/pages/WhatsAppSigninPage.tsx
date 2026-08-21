// src/pages/WhatsAppSigninPage.tsx
//
// Landing page for the sign-in link sent in the SUBSCRIBE confirmation
// message (see getOrCreateWhatsAppSigninLink in whatsapp-flow-webhook).
// Does almost nothing by design: extracts the token, redeems it via
// whatsapp-signin-redeem, then redirects to the action_link that comes
// back. That link is Supabase's own hosted magic-link verify endpoint —
// visiting it establishes the session and redirects to /auth/callback with
// #access_token=..., landing on the EXISTING OAuthCallbackPage flow
// (finalize(), runBootstrap(), the staged-stance commit) completely
// unmodified. This page never touches session state directly, and never
// will — that's deliberate, not a TODO.
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
