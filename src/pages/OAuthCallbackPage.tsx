// src/pages/OAuthCallbackPage.tsx
// Epic V — Social Authentication

import * as React from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "@/lib/supabaseClient";
import { Loader2 } from "lucide-react";

function extractAuthParams(): URLSearchParams | null {
  const href = window.location.href;

  // Double-hash: /#/auth/callback#access_token=...
  const doubleHashIdx = href.indexOf("#/auth/callback#");
  if (doubleHashIdx !== -1) {
    const secondary = href.slice(doubleHashIdx + "#/auth/callback#".length);
    console.log("[OAuthCallback] Extracted secondary hash params:", secondary.slice(0, 60) + "...");
    return new URLSearchParams(secondary);
  }

  // Standard hash
  const hash = window.location.hash.replace(/^#/, "");
  if (hash.includes("access_token=") || hash.includes("error=")) {
    return new URLSearchParams(hash);
  }

  // PKCE code flow
  const search = window.location.search;
  if (search.includes("code=") || search.includes("error=")) {
    return new URLSearchParams(search.slice(1));
  }

  return null;
}

export default function OAuthCallbackPage() {
  const sb = React.useMemo(getSupabase, []);
  const navigate = useNavigate();
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState("Completing sign-in\u2026");
  const [debugLines, setDebugLines] = React.useState<string[]>([]);

  const log = (msg: string) => {
    console.log("[OAuthCallback]", msg);
    setDebugLines(prev => [...prev, msg]);
  };

  React.useEffect(() => {
    if (!sb) {
      log("ERROR: Supabase client is null");
      setError("Supabase client not available.");
      return;
    }

    let cancelled = false;

    async function handleCallback() {
      log("handleCallback started");

      const params = extractAuthParams();

      if (!params) {
        log("ERROR: No auth params found in URL");
        setError("No authentication data found. Please try signing in again.");
        return;
      }

      const oauthError = params.get("error_description") || params.get("error");
      if (oauthError) {
        log("ERROR from provider: " + oauthError);
        setError(decodeURIComponent(oauthError));
        return;
      }

      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      const code = params.get("code");

      log(`access_token present: ${!!accessToken}, refresh_token present: ${!!refreshToken}, code present: ${!!code}`);

      if (code) {
        log("Using PKCE code flow...");
        setStatus("Exchanging authorization code\u2026");
        try {
          const { data, error: exchError } = await sb.auth.exchangeCodeForSession(window.location.href);
          log(`exchangeCodeForSession result: error=${exchError?.message ?? "none"}, session=${!!data?.session}`);
          if (exchError || !data?.session) {
            setError(exchError?.message ?? "Authorization code exchange failed.");
            return;
          }
          if (cancelled) return;
          await finalize(sb, data.session, navigate, log);
        } catch (e: any) {
          log("exchangeCodeForSession threw: " + e?.message);
          setError(e?.message ?? "Code exchange failed.");
        }
        return;
      }

      if (!accessToken || !refreshToken) {
        log("ERROR: Missing access_token or refresh_token");
        setError("Incomplete authentication response. Please try again.");
        return;
      }

      log("Calling sb.auth.setSession...");
      setStatus("Verifying your account\u2026");

      try {
        const { data, error: sessionError } = await sb.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        log(`setSession result: error=${sessionError?.message ?? "none"}, session=${!!data?.session}, user=${data?.session?.user?.email ?? "none"}`);

        if (cancelled) { log("Cancelled after setSession"); return; }

        if (sessionError) {
          setError(sessionError.message);
          return;
        }

        if (!data?.session) {
          log("ERROR: setSession returned no session and no error");
          setError("Session could not be established. Please try again.");
          return;
        }

        log("Session established, finalizing...");
        await finalize(sb, data.session, navigate, log);
      } catch (e: any) {
        log("setSession threw: " + e?.message);
        setError(e?.message ?? "setSession failed.");
      }
    }

    handleCallback();
    return () => { cancelled = true; };
  }, [sb, navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md w-full rounded-xl border border-red-200 bg-white p-8 space-y-4 text-center shadow-sm">
          <div className="text-red-400 text-5xl">&times;</div>
          <h1 className="text-lg font-semibold text-slate-900">Sign-in failed</h1>
          <p className="text-sm text-slate-600">{error}</p>
          {/* Debug log */}
          <div className="text-left bg-slate-50 rounded p-3 text-xs font-mono text-slate-500 max-h-40 overflow-auto">
            {debugLines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
          <a href="/#/login" className="inline-block mt-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors">
            Back to login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center space-y-4">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400 mx-auto" />
        <p className="text-sm text-slate-500">{status}</p>
        {/* Debug log — visible while loading */}
        <div className="text-left bg-white border rounded p-3 text-xs font-mono text-slate-400 max-w-sm max-h-40 overflow-auto">
          {debugLines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </div>
    </div>
  );
}

async function finalize(sb: any, session: any, navigate: any, log: (m: string) => void) {
  log("finalize: bootstrapping profile...");
  await bootstrapSocialProfile(sb, session, log);
  log("finalize: persisting token...");
  await persistProviderToken(sb, session, log);

  const returnTo = sessionStorage.getItem("return_to");
  sessionStorage.removeItem("return_to");
  const dest = (returnTo && (returnTo.startsWith("/") || returnTo.startsWith("#/"))) ? returnTo : "/";
  log("finalize: navigating to " + dest);
  navigate(dest, { replace: true });
}

async function bootstrapSocialProfile(sb: any, session: any, log: (m: string) => void) {
  try {
    const user = session.user;
    if (!user) return;
    const meta = user.user_metadata ?? {};
    const { data: profile } = await sb.from("profiles").select("username, avatar_url").eq("user_id", user.id).single();
    const updates: Record<string, string> = {};
    if (!profile?.avatar_url) {
      const avatar = meta.avatar_url || meta.picture || null;
      if (avatar) updates.avatar_url = avatar;
    }
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      await sb.from("profiles").update(updates).eq("user_id", user.id);
    }
    if (!profile?.username) {
      const name = meta.full_name || meta.name || null;
      if (name) {
        const suggestion = name.toLowerCase().replace(/[^a-z0-9_.]/g, "_").replace(/_+/g, "_").slice(0, 20);
        window.localStorage.setItem("oauth_username_suggestion", suggestion);
      }
    }
    const displayName = meta.full_name || meta.name || null;
    if (displayName) window.localStorage.setItem("oauth_display_name", displayName);
    log("bootstrapSocialProfile: done");
  } catch (e: any) {
    log("bootstrapSocialProfile error (non-fatal): " + e?.message);
  }
}

async function persistProviderToken(sb: any, session: any, log: (m: string) => void) {
  try {
    if (!session?.provider_token) { log("persistProviderToken: no provider_token, skipping"); return; }
    const provider = session.user?.app_metadata?.provider;
    if (!provider || !["google", "facebook", "apple"].includes(provider)) { log("persistProviderToken: provider not social, skipping"); return; }
    const identity = session.user?.identities?.find((i: any) => i.provider === provider);
    const providerUserId = identity?.id ?? session.user?.id;
    const expiresAt = session.provider_token_expiry ? new Date(session.provider_token_expiry * 1000).toISOString() : null;
    await sb.rpc("upsert_social_auth_token", {
      p_provider: provider, p_provider_user_id: providerUserId,
      p_access_token: session.provider_token, p_refresh_token: session.provider_refresh_token ?? null,
      p_token_expires_at: expiresAt, p_scopes: [],
    });
    log("persistProviderToken: done");
  } catch (e: any) {
    log("persistProviderToken error (non-fatal): " + e?.message);
  }
}
