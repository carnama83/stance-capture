// src/pages/OAuthCallbackPage.tsx
// Epic V — Social Authentication
//
// HashRouter creates a double-hash URL after OAuth redirect:
//   localhost:8080/#/auth/callback#access_token=...
//
// Supabase JS SDK reads window.location.hash and sees "#/auth/callback#access_token=..."
// which it cannot parse. We must manually extract the token params from the
// secondary hash and call sb.auth.setSession() ourselves.

import * as React from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "@/lib/supabaseClient";
import { Loader2 } from "lucide-react";

// Extract the token params from the secondary hash fragment.
// URL looks like: /#/auth/callback#access_token=xxx&refresh_token=yyy&...
function extractAuthParams(): URLSearchParams | null {
  const href = window.location.href;

  // Primary case: double-hash from HashRouter
  const doubleHashIdx = href.indexOf("#/auth/callback#");
  if (doubleHashIdx !== -1) {
    const secondary = href.slice(doubleHashIdx + "#/auth/callback#".length);
    return new URLSearchParams(secondary);
  }

  // Fallback: standard hash (BrowserRouter or direct landing)
  const hash = window.location.hash.replace(/^#/, "");
  if (hash.includes("access_token=") || hash.includes("error=")) {
    return new URLSearchParams(hash);
  }

  // PKCE code flow: params in query string
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

  React.useEffect(() => {
    if (!sb) return;

    let cancelled = false;

    async function handleCallback() {
      const params = extractAuthParams();

      if (!params) {
        setError("No authentication data found. Please try signing in again.");
        return;
      }

      // Check for OAuth error from provider (e.g. user denied access)
      const oauthError =
        params.get("error_description") || params.get("error");
      if (oauthError) {
        setError(decodeURIComponent(oauthError));
        return;
      }

      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      if (!accessToken || !refreshToken) {
        // Could be PKCE code flow — let Supabase handle it via exchangeCodeForSession
        const code = params.get("code");
        if (code) {
          setStatus("Exchanging authorization code\u2026");
          const { data, error: exchError } =
            await sb.auth.exchangeCodeForSession(window.location.href);
          if (exchError || !data?.session) {
            setError(exchError?.message ?? "Authorization code exchange failed.");
            return;
          }
          if (cancelled) return;
          await finalize(sb, data.session, navigate);
          return;
        }

        setError("Incomplete authentication response. Please try again.");
        return;
      }

      // Implicit flow: set session directly from access + refresh tokens
      setStatus("Verifying your account\u2026");
      const { data, error: sessionError } = await sb.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (cancelled) return;

      if (sessionError || !data?.session) {
        setError(sessionError?.message ?? "Failed to establish session.");
        return;
      }

      await finalize(sb, data.session, navigate);
    }

    handleCallback();

    return () => {
      cancelled = true;
    };
  }, [sb, navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md w-full rounded-xl border border-red-200 bg-white p-8 space-y-4 text-center shadow-sm">
          <div className="text-red-400 text-5xl">&times;</div>
          <h1 className="text-lg font-semibold text-slate-900">Sign-in failed</h1>
          <p className="text-sm text-slate-600">{error}</p>
          <a
            href="/#/login"
            className="inline-block mt-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors"
          >
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

// ─── Finalize: bootstrap profile, persist token, redirect ─────────────────────

async function finalize(sb: any, session: any, navigate: any) {
  await bootstrapSocialProfile(sb, session);
  await persistProviderToken(sb, session);

  const returnTo = sessionStorage.getItem("return_to");
  sessionStorage.removeItem("return_to");

  if (returnTo && (returnTo.startsWith("/") || returnTo.startsWith("#/"))) {
    navigate(returnTo, { replace: true });
  } else {
    navigate("/", { replace: true });
  }
}

// ─── Bootstrap social profile ─────────────────────────────────────────────────

async function bootstrapSocialProfile(sb: any, session: any) {
  try {
    const user = session.user;
    if (!user) return;

    const meta = user.user_metadata ?? {};

    const { data: profile } = await sb
      .from("profiles")
      .select("username, avatar_url")
      .eq("user_id", user.id)
      .single();

    const updates: Record<string, string> = {};

    if (!profile?.avatar_url) {
      const providerAvatar =
        meta.avatar_url || meta.picture || meta.profile_image_url || null;
      if (providerAvatar) updates.avatar_url = providerAvatar;
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      await sb.from("profiles").update(updates).eq("user_id", user.id);
    }

    if (!profile?.username) {
      const providerName =
        meta.full_name || meta.name || meta.given_name || null;
      if (providerName) {
        const suggestion = providerName
          .toLowerCase()
          .replace(/[^a-z0-9_.]/g, "_")
          .replace(/_+/g, "_")
          .slice(0, 20);
        window.localStorage.setItem("oauth_username_suggestion", suggestion);
      }
    }

    const displayName = meta.full_name || meta.name || null;
    if (displayName) {
      window.localStorage.setItem("oauth_display_name", displayName);
    }
  } catch (e) {
    console.warn("[OAuthCallback] Profile bootstrap failed (non-fatal):", e);
  }
}

// ─── Persist provider token ───────────────────────────────────────────────────

async function persistProviderToken(sb: any, session: any) {
  try {
    if (!session?.provider_token) return;

    const provider = session.user?.app_metadata?.provider;
    if (!provider || !["google", "facebook", "apple"].includes(provider)) return;

    const identity = session.user?.identities?.find(
      (i: any) => i.provider === provider
    );
    const providerUserId = identity?.id ?? session.user?.id;

    const expiresAt = session.provider_token_expiry
      ? new Date(session.provider_token_expiry * 1000).toISOString()
      : null;

    await sb.rpc("upsert_social_auth_token", {
      p_provider: provider,
      p_provider_user_id: providerUserId,
      p_access_token: session.provider_token,
      p_refresh_token: session.provider_refresh_token ?? null,
      p_token_expires_at: expiresAt,
      p_scopes: [],
    });
  } catch (e) {
    console.warn("[OAuthCallback] Token persistence failed (non-fatal):", e);
  }
}
