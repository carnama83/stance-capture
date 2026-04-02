// src/pages/OAuthCallbackPage.tsx
// Epic V — Social Authentication
//
// Extracts OAuth tokens from the HashRouter double-hash URL and calls
// setSession() manually. Uses a ref-based guard (not module-level) so
// repeated navigations to this page always work correctly.

import * as React from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "@/lib/supabaseClient";
import { Loader2 } from "lucide-react";

function extractAuthParams(): { params: URLSearchParams; source: string } | null {
  const href = window.location.href;

  // HashRouter double-hash: /#/auth/callback#access_token=...
  const idx = href.indexOf("#/auth/callback#");
  if (idx !== -1) {
    const secondary = href.slice(idx + "#/auth/callback#".length);
    return { params: new URLSearchParams(secondary), source: "double-hash" };
  }

  // Single hash fallback
  const hash = window.location.hash.replace(/^#/, "");
  if (hash.includes("access_token=") || hash.includes("error=")) {
    return { params: new URLSearchParams(hash), source: "hash" };
  }

  // PKCE code in query string
  const search = window.location.search;
  if (search.includes("code=") || search.includes("error=")) {
    return { params: new URLSearchParams(search.slice(1)), source: "query" };
  }

  return null;
}

export default function OAuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState("Completing sign-in…");
  const ranRef = React.useRef(false);

  React.useEffect(() => {
    // Ref-based guard: prevents double-run within same mount cycle
    if (ranRef.current) return;
    ranRef.current = true;

    const sb = getSupabase();

    if (!sb) {
      setError("Supabase client is not available. Check your environment variables.");
      return;
    }

    async function handleCallback() {
      const extracted = extractAuthParams();

      if (!extracted) {
        setError("No authentication data found. Please try signing in again.");
        return;
      }

      const { params, source } = extracted;
      console.log("[OAuthCallback] params source:", source);

      // Provider-level error (e.g. user denied access)
      const oauthError = params.get("error_description") || params.get("error");
      if (oauthError) {
        setError(decodeURIComponent(oauthError));
        return;
      }

      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      const code = params.get("code");

      console.log("[OAuthCallback] access_token:", !!accessToken, "refresh_token:", !!refreshToken, "code:", !!code);

      // PKCE code flow
      if (code && (!accessToken || !refreshToken)) {
        setStatus("Exchanging authorization code…");
        try {
          const { data, error: err } = await sb!.auth.exchangeCodeForSession(window.location.href);
          if (err || !data?.session) {
            setError(err?.message ?? "Code exchange failed.");
            return;
          }
          await finalize(sb!, data.session, navigate, setStatus);
        } catch (e: any) {
          setError(e?.message ?? "Code exchange threw an error.");
        }
        return;
      }

      // Implicit / token flow
      if (!accessToken || !refreshToken) {
        setError("Incomplete authentication response — missing tokens. Please try again.");
        return;
      }

      setStatus("Verifying your account…");
      console.log("[OAuthCallback] Calling setSession...");

      try {
        const result = await sb!.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        console.log("[OAuthCallback] setSession result:", {
          error: result.error?.message ?? null,
          hasSession: !!result.data?.session,
          user: result.data?.session?.user?.email ?? null,
        });

        if (result.error) {
          setError(result.error.message);
          return;
        }
        if (!result.data?.session) {
          setError("Session could not be established. Please try again.");
          return;
        }

        await finalize(sb!, result.data.session, navigate, setStatus);
      } catch (e: any) {
        console.error("[OAuthCallback] setSession threw:", e);
        setError(e?.message ?? "setSession failed unexpectedly.");
      }
    }

    handleCallback();
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md w-full rounded-xl border border-red-200 bg-white p-8 space-y-4 text-center shadow-sm">
          <div className="text-red-400 text-5xl">&times;</div>
          <h1 className="text-lg font-semibold text-slate-900">Sign-in failed</h1>
          <p className="text-sm text-slate-600">{error}</p>
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
      </div>
    </div>
  );
}

async function finalize(sb: any, session: any, navigate: any, setStatus: (s: string) => void) {
  setStatus("Setting up your profile…");
  await bootstrapSocialProfile(sb, session);

  setStatus("Saving account connection…");
  await persistProviderToken(sb, session);

  const returnTo = sessionStorage.getItem("return_to");
  sessionStorage.removeItem("return_to");
  const dest = returnTo && (returnTo.startsWith("/") || returnTo.startsWith("#/")) ? returnTo : "/";
  navigate(dest, { replace: true });
}

async function bootstrapSocialProfile(sb: any, session: any) {
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
  } catch (e: any) {
    console.warn("[OAuthCallback] Profile bootstrap (non-fatal):", e?.message);
  }
}

async function persistProviderToken(sb: any, session: any) {
  try {
    if (!session?.provider_token) return;
    const provider = session.user?.app_metadata?.provider;
    if (!provider || !["google", "facebook", "apple"].includes(provider)) return;
    const identity = session.user?.identities?.find((i: any) => i.provider === provider);
    const providerUserId = identity?.id ?? session.user?.id;
    const expiresAt = session.provider_token_expiry ? new Date(session.provider_token_expiry * 1000).toISOString() : null;
    await sb.rpc("upsert_social_auth_token", {
      p_provider: provider, p_provider_user_id: providerUserId,
      p_access_token: session.provider_token, p_refresh_token: session.provider_refresh_token ?? null,
      p_token_expires_at: expiresAt, p_scopes: [],
    });
  } catch (e: any) {
    console.warn("[OAuthCallback] Token persistence (non-fatal):", e?.message);
  }
}
