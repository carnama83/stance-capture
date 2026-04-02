// src/pages/OAuthCallbackPage.tsx
// Epic V — Social Authentication
//
// Handles the OAuth provider redirect after user authenticates.
// Works with HashRouter: the oauthHashHandler rewrites the URL to
//   /#/auth/callback#access_token=...
// so this component receives the token in a secondary hash fragment.
//
// Flow:
//   1. Parse token/code from URL (Supabase does this automatically via setSession)
//   2. Wait for SIGNED_IN auth event
//   3. Bootstrap social profile (display name, avatar from provider)
//   4. Persist provider token for Epic W
//   5. Redirect to intended destination or home

import * as React from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "@/lib/supabaseClient";
import { Loader2 } from "lucide-react";

export default function OAuthCallbackPage() {
  const sb = React.useMemo(getSupabase, []);
  const navigate = useNavigate();
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState("Completing sign-in\u2026");

  React.useEffect(() => {
    if (!sb) return;

    // Parse error from URL params (e.g. user denied access)
    const rawHref = window.location.href;
    const secondaryHash = rawHref.includes("#/auth/callback#")
      ? rawHref.split("#/auth/callback#")[1] ?? ""
      : window.location.hash.replace(/^#/, "");

    const params = new URLSearchParams(secondaryHash);
    const urlError = params.get("error_description") || params.get("error");
    if (urlError) {
      setError(decodeURIComponent(urlError));
      return;
    }

    let handled = false;

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange(async (event: string, session: any) => {
      if (handled) return;

      if (event === "SIGNED_IN" && session) {
        handled = true;

        setStatus("Setting up your profile\u2026");
        await bootstrapSocialProfile(sb, session);

        setStatus("Saving account connection\u2026");
        await persistProviderToken(sb, session);

        const returnTo = sessionStorage.getItem("return_to");
        sessionStorage.removeItem("return_to");

        if (returnTo && (returnTo.startsWith("/") || returnTo.startsWith("#/"))) {
          navigate(returnTo, { replace: true });
        } else {
          navigate("/", { replace: true });
        }
      }

      if (event === "SIGNED_OUT") {
        navigate("/login", { replace: true });
      }
    });

    // Safety timeout: if auth event never fires, bail
    const timeout = setTimeout(() => {
      if (!handled) {
        setError("Sign-in timed out. Please try again.");
      }
    }, 15_000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [sb, navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md w-full rounded-xl border border-red-200 bg-white p-8 space-y-4 text-center shadow-sm">
          <div className="text-5xl">&times;</div>
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

// Bootstrap social profile — pre-populate avatar + username suggestion from provider
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

    // Stash suggestions for onboarding pre-fill
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

// Persist provider token to social_auth_tokens for Epic W downstream use
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
