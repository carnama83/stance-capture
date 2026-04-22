// src/pages/OAuthCallbackPage.tsx
// Epic V — Social Authentication
//
// CHANGES (Fix 2):
//   - persistProviderToken now includes 'twitter' in the allowed provider list
//   - bootstrapSocialProfile correctly handles twitter provider
//   - No other logic changed — the X OAuth flow uses the same PKCE path
//
// EMAIL CONFIRMATION FIX (QA):
//   - extractAuthParams now detects ?token_hash=...&type=... query params
//   - handleCallback now handles token_hash+type via supabase.auth.verifyOtp()
//     before the PKCE and implicit token blocks
//
// setSession() hangs when the Supabase client has detectSessionInUrl:false
// and hasn't been "warmed up" with a prior auth call. Instead we:
//   1. Manually write the session to localStorage (same key Supabase uses)
//   2. Call getSession() to have the client pick it up from storage
//   3. Navigate on success

import * as React from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "@/lib/supabaseClient";
import { Loader2 } from "lucide-react";

function extractAuthParams(): URLSearchParams | null {
  const href = window.location.href;
  const idx = href.indexOf("#/auth/callback#");
  if (idx !== -1) return new URLSearchParams(href.slice(idx + "#/auth/callback#".length));
  const hash = window.location.hash.replace(/^#/, "");
  if (hash.includes("access_token=") || hash.includes("error=")) return new URLSearchParams(hash);

  // EMAIL CONFIRMATION FIX: token_hash arrives as a query param (?token_hash=...&type=signup)
  // because the email template uses {{ .SiteURL }}/#/auth/callback?token_hash=...
  // HashRouter exposes these as window.location.search on the /auth/callback route.
  const search = window.location.search;
  if (search.includes("token_hash=") || search.includes("code=") || search.includes("error=")) {
    return new URLSearchParams(search.slice(1));
  }

  return null;
}

// Manually seed localStorage with the session so Supabase picks it up via getSession()
function seedSessionToStorage(accessToken: string, refreshToken: string, expiresAt: string) {
  try {
    const url = import.meta.env.VITE_SUPABASE_URL as string;
    // Supabase stores session under: sb-<project-ref>-auth-token
    const ref = url.replace("https://", "").split(".")[0];
    const storageKey = `sb-${ref}-auth-token`;

    // Decode JWT payload to get user info
    const payloadB64 = accessToken.split(".")[1];
    const payload = JSON.parse(atob(payloadB64));

    const sessionObj = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: parseInt(expiresAt),
      expires_in: parseInt(expiresAt) - Math.floor(Date.now() / 1000),
      token_type: "bearer",
      user: {
        id: payload.sub,
        aud: payload.aud,
        role: payload.role,
        email: payload.email,
        app_metadata: payload.app_metadata ?? {},
        user_metadata: payload.user_metadata ?? {},
        created_at: new Date(payload.iat * 1000).toISOString(),
      },
    };

    localStorage.setItem(storageKey, JSON.stringify(sessionObj));
    console.log("[OAuthCallback] Seeded session to localStorage key:", storageKey);
    return true;
  } catch (e: any) {
    console.warn("[OAuthCallback] seedSessionToStorage failed:", e?.message);
    return false;
  }
}

export default function OAuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState("Completing sign-in…");
  const ranRef = React.useRef(false);

  React.useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const sb = getSupabase();
    if (!sb) {
      setError("Supabase client unavailable. Check environment variables.");
      return;
    }

    async function handleCallback() {
      const params = extractAuthParams();
      if (!params) { setError("No authentication data found. Please try signing in again."); return; }

      const oauthError = params.get("error_description") || params.get("error");
      if (oauthError) { setError(decodeURIComponent(oauthError)); return; }

      // EMAIL CONFIRMATION FIX: handle token_hash+type (email confirmation flow).
      // Supabase email template must use:
      //   {{ .SiteURL }}/#/auth/callback?token_hash={{ .TokenHash }}&type=signup
      const tokenHash = params.get("token_hash");
      const otpType = params.get("type");
      if (tokenHash && otpType) {
        setStatus("Confirming your email…");
        try {
          const { data, error: err } = await sb!.auth.verifyOtp({
            token_hash: tokenHash,
            type: otpType as any,
          });
          if (err || !data?.session) {
            setError(err?.message ?? "Email confirmation failed. The link may have expired — please sign up again.");
            return;
          }
          await finalize(sb!, data.session, navigate, setStatus);
        } catch (e: any) {
          setError(e?.message ?? "Email confirmation error.");
        }
        return;
      }

      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      const expiresAt = params.get("expires_at") ?? String(Math.floor(Date.now() / 1000) + 3600);
      const code = params.get("code");

      console.log("[OAuthCallback] tokens present:", { accessToken: !!accessToken, refreshToken: !!refreshToken, code: !!code });

      // PKCE code flow (used by X/Twitter OAuth 2.0 and newer Google/Apple flows)
      if (code && !accessToken) {
        setStatus("Exchanging authorization code…");
        try {
          const { data, error: err } = await sb!.auth.exchangeCodeForSession(window.location.href);
          if (err || !data?.session) { setError(err?.message ?? "Code exchange failed."); return; }
          await finalize(sb!, data.session, navigate, setStatus);
        } catch (e: any) { setError(e?.message ?? "Code exchange error."); }
        return;
      }

      if (!accessToken || !refreshToken) {
        setError("Incomplete authentication response. Please try again.");
        return;
      }

      // Seed session directly into localStorage, then let Supabase read it back
      setStatus("Verifying your account…");
      const seeded = seedSessionToStorage(accessToken, refreshToken, expiresAt);
      if (!seeded) { setError("Could not establish session. Please try again."); return; }

      // Give localStorage a tick to settle, then call getSession
      await new Promise(r => setTimeout(r, 100));

      console.log("[OAuthCallback] Calling getSession after seed...");
      const { data, error: sessionErr } = await sb!.auth.getSession();
      console.log("[OAuthCallback] getSession result:", {
        error: sessionErr?.message ?? null,
        hasSession: !!data?.session,
        user: data?.session?.user?.email ?? null,
      });

      if (sessionErr || !data?.session) {
        // Final fallback: try setSession now that storage is warm
        console.log("[OAuthCallback] Falling back to setSession...");
        try {
          const { data: sd, error: se } = await sb!.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          console.log("[OAuthCallback] setSession fallback result:", { error: se?.message ?? null, hasSession: !!sd?.session });
          if (se || !sd?.session) { setError(se?.message ?? "Session could not be established."); return; }
          await finalize(sb!, sd.session, navigate, setStatus);
        } catch (e: any) { setError(e?.message ?? "setSession failed."); }
        return;
      }

      await finalize(sb!, data.session, navigate, setStatus);
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
      const name = meta.full_name || meta.name || meta.preferred_username || null;
      if (name) {
        const suggestion = name.toLowerCase().replace(/[^a-z0-9_.]/g, "_").replace(/_+/g, "_").slice(0, 20);
        window.localStorage.setItem("oauth_username_suggestion", suggestion);
      }
    }
    const displayName = meta.full_name || meta.name || null;
    if (displayName) window.localStorage.setItem("oauth_display_name", displayName);
  } catch (e: any) { console.warn("[OAuthCallback] profile bootstrap (non-fatal):", e?.message); }
}

// FIX 2: Added 'twitter' to the allowed provider list.
// Previously ['google','facebook','apple'] — this blocked X token writes
// and meant post-to-x never found a stored token for Twitter users.
const SOCIAL_TOKEN_PROVIDERS = ["google", "facebook", "apple", "twitter"] as const;
type SocialTokenProvider = typeof SOCIAL_TOKEN_PROVIDERS[number];

async function persistProviderToken(sb: any, session: any) {
  try {
    if (!session?.provider_token) {
      console.log("[OAuthCallback] No provider_token in session — skipping token persistence");
      return;
    }
    const provider = session.user?.app_metadata?.provider as string | undefined;
    if (!provider || !(SOCIAL_TOKEN_PROVIDERS as readonly string[]).includes(provider)) {
      console.log("[OAuthCallback] Provider not in allowed list:", provider);
      return;
    }
    const identity = session.user?.identities?.find((i: any) => i.provider === provider);
    const providerUserId = identity?.id ?? session.user?.id;
    const expiresAt = session.provider_token_expiry
      ? new Date(session.provider_token_expiry * 1000).toISOString()
      : null;

    // For twitter, extract scopes from provider token if available
    const scopes: string[] = provider === "twitter"
      ? ["tweet.read", "tweet.write", "users.read", "offline.access"]
      : [];

    await sb.rpc("upsert_social_auth_token", {
      p_provider: provider as SocialTokenProvider,
      p_provider_user_id: providerUserId,
      p_access_token: session.provider_token,
      p_refresh_token: session.provider_refresh_token ?? null,
      p_token_expires_at: expiresAt,
      p_scopes: scopes,
    });
    console.log("[OAuthCallback] Provider token persisted for:", provider);
  } catch (e: any) { console.warn("[OAuthCallback] token persistence (non-fatal):", e?.message); }
}
