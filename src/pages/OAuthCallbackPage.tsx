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
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_PROJECT_REF, getJwt } from "@/lib/env";
import { runBootstrap, rpcPost, restGet, restPatch } from "@/hooks/useBootstrapUser";
import { fetchIPLocation } from "@/lib/ipLocation";
import { getDeviceId } from "@/lib/webStance";

function extractAuthParams(): URLSearchParams | null {
  const href = window.location.href;
  const idx = href.indexOf("#/auth/callback#");
  if (idx !== -1) return new URLSearchParams(href.slice(idx + "#/auth/callback#".length));
  const hash = window.location.hash.replace(/^#/, "");
  if (hash.includes("access_token=") || hash.includes("error=")) return new URLSearchParams(hash);

    // EMAIL CONFIRMATION FIX: token_hash arrives inside the hash, not window.location.search.
  // HashRouter puts everything after # into location.hash, so the URL:
  //   localhost:8080/#/auth/callback?token_hash=...&type=signup
  // means location.hash = "#/auth/callback?token_hash=...&type=signup"
  // and location.search is EMPTY. We must parse the query string out of the hash.
  const hashStr = window.location.hash; // full hash including #/auth/callback
  const qIndex = hashStr.indexOf("?");
  if (qIndex !== -1) {
    const hashQuery = hashStr.slice(qIndex + 1);
    if (hashQuery.includes("token_hash=") || hashQuery.includes("code=") || hashQuery.includes("error=")) {
      return new URLSearchParams(hashQuery);
    }
  }

  // Fallback: check window.location.search for non-HashRouter deployments
  const search = window.location.search;
  if (search.includes("token_hash=") || search.includes("code=") || search.includes("error=")) {
    return new URLSearchParams(search.slice(1));
  }

  return null;
}

// Manually seed localStorage with the session so Supabase picks it up via getSession()
function seedSessionToStorage(accessToken: string, refreshToken: string, expiresAt: string) {
  try {
    const url = SUPABASE_URL;
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
          // Email confirmed successfully. Profile onboarding data (username, DOB,
          // gender, location) was stashed in localStorage by stashForFirstLogin()
          // during signup. useBootstrapUser picks it up and finalizes the profile
          // on first login. Navigate to login so the user explicitly signs in and
          // triggers that bootstrap flow — do NOT call finalize() here.
          navigate("/login?confirmed=1", { replace: true });
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
  // FIX: previously this relied entirely on useBootstrapUser's
  // onAuthStateChange listener to call bootstrap_user_after_login() (which
  // creates public.users/public.profiles). That listener never fires for
  // this OAuth flow, because the session here was seeded straight into
  // localStorage rather than set via setSession()/signInWith*() — so the
  // profile row was never created at all for Google/Facebook logins, not
  // just delayed. Calling it directly here, with the session we already
  // have in hand, makes bootstrap happen deterministically regardless of
  // whether any auth event fires. Safe to run even if it also fires via
  // useBootstrapUser later — bootstrap_user_after_login() is idempotent.
  if (session?.user?.id && session?.access_token) {
    await runBootstrap(
      { id: session.user.id, email: session.user.email ?? null },
      session.access_token
    );
  }
  await bootstrapSocialProfile(sb, session);
  setStatus("Saving account connection…");
  await persistProviderToken(sb, session);

  // BUG FIX: commit any web stances staged before login (WebOptInCard's
  // single-question flow, or HomeOptInPrompt's multi-question homepage
  // staging) centrally, here, once — regardless of which page the user lands
  // on next. Previously this only happened as a side effect of WebOptInCard
  // mounting on the right question page, which silently never fired at all
  // when the redirect landed elsewhere (see the return_to fix below) — and
  // never existed for HomeOptInPrompt's multi-question case in the first
  // place. commit_staged_stances_for_device_by_user() is the email-login
  // sibling of the WhatsApp fix (commit_staged_stances_for_device); it's a
  // safe no-op if there's nothing staged, or if WebOptInCard's own
  // attach_user_to_node effect already committed it.
  if (session?.user?.id && session?.access_token) {
    const deviceId = getDeviceId();
    if (deviceId) {
      const commit = await rpcPost(
        "commit_staged_stances_for_device_by_user",
        { p_device_id: deviceId, p_user_id: session.user.id },
        session.access_token
      );
      if (commit.error) {
        console.warn("[OAuthCallback] commit_staged_stances_for_device_by_user failed (non-fatal):", commit.error);
      }
    }
  }

  // BUG FIX: WebOptInCard.tsx/HomeOptInPrompt.tsx deliberately write
  // return_to to localStorage, not sessionStorage — the magic-link email
  // opens in a NEW TAB, where sessionStorage is always empty (see their own
  // comments on this). This previously checked sessionStorage only, so
  // returnTo was always null for the email opt-in flow and every magic-link
  // login landed on "/" instead of the question the person actually
  // answered. sessionStorage is still checked as a fallback: a real Google/
  // Facebook OAuth redirect stays in the SAME tab, where redirectToLogin()
  // (Index.tsx) sets it via sessionStorage and it correctly survives — the
  // two paths never fire in the same tab, so checking localStorage first is
  // safe or noop for that OAuth-redirect case.
  const returnTo = localStorage.getItem("return_to") || sessionStorage.getItem("return_to");
  localStorage.removeItem("return_to");
  sessionStorage.removeItem("return_to");
  // BUG FIX: react-router's navigate() (HashRouter) expects a plain path
  // like "/q/xyz" — it manages the "#" itself. Both callers that set
  // return_to (WebOptInCard.tsx's email flow, WhatsAppSigninPage.tsx) use
  // "#/q/xyz" format, and passing that string WITH the literal "#"
  // straight to navigate() doesn't get parsed as "the route /q/xyz" — it
  // gets appended onto the CURRENT path instead of replacing it, producing
  // a malformed nested URL like "/#/auth/callback#/q/xyz" that no route
  // matches. Confirmed live via the WhatsApp sign-in flow (stuck on this
  // page after a fully successful sign-in — everything up to this line
  // completes correctly, only the final navigate() target was wrong).
  // WebOptInCard.tsx's email flow sets the identical "#/q/..." format and
  // most likely has this exact same latent bug — just never noticed,
  // since a magic-link email always opens a genuinely fresh tab with no
  // prior in-memory router history for the malformed target to append
  // onto, so the practical symptom may differ even though the root cause
  // is the same. Strip the leading "#" here, once, at the single shared
  // consumption point, rather than editing both setters separately.
  const normalizedReturnTo = returnTo?.replace(/^#/, "") ?? null;
  const dest = normalizedReturnTo && normalizedReturnTo.startsWith("/") ? normalizedReturnTo : "/";
  navigate(dest, { replace: true });
}

async function bootstrapSocialProfile(sb: any, session: any) {
  try {
    const user = session.user;
    if (!user) return;
    const meta = user.user_metadata ?? {};
    // BUG FIX: this used to be sb.from("profiles").select(...).single() —
    // the raw SDK client, which this whole file otherwise deliberately
    // avoids (see rpcPost's usage a few lines down, and useBootstrapUser.ts's
    // header comment on the exact auth-mutex hang this caused historically).
    // .single() also throws on anything but exactly one row back, and the
    // WHOLE function shares one try/catch — so either failure mode silently
    // aborted everything after this line, including the location IP-claim
    // fallback below, DESPITE that call already correctly using rpcPost.
    // Confirmed live: a freshly-created account had zero rows in
    // user_location_settings even though claim_oauth_ip_location's own
    // logic and the ipapi.co fetch were both fine in isolation.
    const { data: profileRows } = await restGet<{ username: string | null; avatar_url: string | null }[]>(
      `profiles?select=username,avatar_url&user_id=eq.${user.id}&limit=1`,
      session.access_token
    );
    const profile = profileRows?.[0] ?? null;
    const updates: Record<string, string> = {};
    if (!profile?.avatar_url) {
      const avatar = meta.avatar_url || meta.picture || null;
      if (avatar) updates.avatar_url = avatar;
    }
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      await restPatch(`profiles?user_id=eq.${user.id}`, updates, session.access_token);
    }
    if (!profile?.username) {
      const name = meta.full_name || meta.name || meta.preferred_username || null;
      if (name) {
        const suggestion = name.toLowerCase().replace(/[^a-z0-9_.]/g, "_").replace(/_+/g, "_").slice(0, 20);
        window.localStorage.setItem("oauth_username_suggestion", suggestion);

        // FIX: previously this suggestion was only ever stashed for an
        // onboarding step to prefill and confirm — but nothing in the app
        // actually reads it back out, so OAuth users stayed on their
        // random_id handle (e.g. "@x7k2p9mabc") forever unless they found
        // Settings on their own. claim_oauth_username() re-sanitizes this
        // server-side, handles collisions with a numeric-suffix retry, and
        // no-ops if the profile already has a username — safe to call on
        // every login. Uses the raw-fetch RPC pattern (not sb.rpc()) since
        // this page is exactly the fragile-session-timing context that
        // pattern exists to avoid.
        if (session.access_token) {
          const claim = await rpcPost<string | null>(
            "claim_oauth_username",
            { p_suggested: suggestion },
            session.access_token
          );
          if (claim.error) {
            console.warn("[OAuthCallback] claim_oauth_username failed (non-fatal):", claim.error);
          }
        }
      }
    }
    const displayName = meta.full_name || meta.name || null;
    if (displayName) window.localStorage.setItem("oauth_display_name", displayName);

    // FIX: Google/Facebook OAuth metadata never has country/state/county
    // codes (those only ever come from the app's own email/password
    // Signup.tsx form), so bootstrap_user_after_login()'s location
    // resolution always misses for OAuth users — leaving zero rows in
    // user_location_settings and the user stuck seeing only "Global"
    // instead of their own country tab. Fall back to the same client-side
    // IP geolocation already used for anonymous users (ipapi.co, see
    // src/lib/ipLocation.ts) and claim a country-level location from it.
    // Gated on an existence check first so returning users — who already
    // have a location, from onboarding, a prior login, or Settings —
    // never trigger a needless IP lookup on every sign-in.
    try {
      // Same fix as the profile select above — this existence check gates
      // whether the IP claim below runs at all, so it's the more
      // consequential of the two sb.from(...) calls to have gotten wrong.
      const { data: existingLoc } = await restGet<{ location_id: string }[]>(
        `user_location_settings?select=location_id&user_id=eq.${user.id}&limit=1`,
        session.access_token
      );
      if ((!existingLoc || existingLoc.length === 0) && session.access_token) {
        const ipLoc = await fetchIPLocation();
        if (ipLoc.country_code) {
          const locClaim = await rpcPost<boolean>(
            "claim_oauth_ip_location",
            { p_country_code: ipLoc.country_code },
            session.access_token
          );
          if (locClaim.error) {
            console.warn("[OAuthCallback] claim_oauth_ip_location failed (non-fatal):", locClaim.error);
          }
        }
      }
    } catch (e: any) {
      console.warn("[OAuthCallback] IP location claim skipped (non-fatal):", e?.message);
    }
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

    // Same fix as bootstrapSocialProfile's two calls above — sb.rpc() is
    // the SDK client this file otherwise deliberately avoids. This
    // specific call never actually affects WhatsApp-created accounts
    // (session.provider_token is never set for them, so the early return
    // above already skips it) — fixed anyway for consistency, and because
    // an SDK-mutex hang here would delay finalize()'s final navigate()
    // call for real OAuth logins even though it wouldn't be silent the
    // way the location bug was.
    const upsertResult = await rpcPost("upsert_social_auth_token", {
      p_provider: provider as SocialTokenProvider,
      p_provider_user_id: providerUserId,
      p_access_token: session.provider_token,
      p_refresh_token: session.provider_refresh_token ?? null,
      p_token_expires_at: expiresAt,
      p_scopes: scopes,
    }, session.access_token);
    if (upsertResult.error) {
      console.warn("[OAuthCallback] upsert_social_auth_token failed (non-fatal):", upsertResult.error);
    }
    console.log("[OAuthCallback] Provider token persisted for:", provider);
  } catch (e: any) { console.warn("[OAuthCallback] token persistence (non-fatal):", e?.message); }
}
