// src/hooks/useBootstrapUser.ts
//
// FIX (auth-mutex hang): this hook used to run every mutation through
// sb.auth.getSession() / sb.auth.getUser() / sb.rpc() — the exact SDK
// methods that hang under the Supabase JS auth-mutex bug (see
// src/lib/supabaseClient.ts and src/lib/env.ts). Worse, it was doing this
// *inside* the onAuthStateChange callback, which Supabase's own docs warn
// can deadlock the client. Fixed by moving every mutation to raw fetch() +
// an explicit jwt parameter (see FIX 2 below) instead of the SDK.
//
// FIX 2 (JWT-read race): raw fetch() calls used to call getJwt()
// independently at call time, reading straight out of localStorage. There's
// no guarantee the SDK has finished persisting a *just-arrived* session to
// localStorage at the exact synchronous instant onAuthStateChange fires —
// and supabaseHeaders() silently falls back to the ANON KEY if the token
// comes back empty, with no error. That anon-authenticated request then
// hits bootstrap_user_after_login()'s `if auth.uid() is null then raise
// exception 'Not authenticated'` check server-side — surfaced client-side
// as a bare 400. Fixed by threading session.access_token through the whole
// call chain explicitly instead of re-reading localStorage per call, plus a
// one-shot retry (see runBootstrap) if the token genuinely wasn't ready.
//
// FIX 3 (cross-device stash): this hook used to read a "signup_stash_v1"
// blob from localStorage (written by Signup.tsx's stashForFirstLogin()) to
// apply username/DOB/gender/location on first login. That silently broke
// whenever the email-confirmation link was opened in a different browser
// context than the one used to sign up (different device, different
// browser, even just a separate InPrivate window) — no shared localStorage,
// so the stash was empty and nothing applied, with no error anywhere.
// That data now travels via signUp()'s options.data
// (auth.users.raw_user_meta_data), applied server-side inside
// bootstrap_user_after_login() itself, on whichever device completes the
// bootstrap. This hook no longer needs resolveLocationFromStash(),
// applySignupStashIfPresent(), or any of the stash-reading logic that used
// to live here — bootstrap_user_after_login() (called below, first thing in
// runBootstrap) now does that job atomically, server-side, exactly once per
// user (gated on the users row being newly inserted, not just updated).
//
// What's left here is genuinely client-only concerns: touching
// session/device rows, merging anonymous embedded stances, and clearing
// leftover OAuth-suggestion localStorage keys once onboarding is confirmed
// complete.
//
// Also fixes a race in the "run once per user" guard: it used to check
// lastBootstrappedUserId *after* an await, so two auth events firing back
// to back (e.g. INITIAL_SESSION then SIGNED_IN) could both slip through
// before either set the guard — confirmed in location_audits as two
// identical bootstrap rows 30ms apart for the same user. The guard is now
// set synchronously before any async work starts.

import { useEffect } from "react";
import { getSupabase } from "../lib/supabaseClient";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "../lib/env";

export type CurrentUser = { id: string; email: string | null };

// ── Raw-fetch helpers (replaces sb.rpc() / sb.from() for this file) ───────
// Same { data, error } shape as the SDK, so the logic below barely changes.
// `jwt` is REQUIRED here (not optional) — every call site in this file now
// passes it explicitly, so there's no path that silently falls back to
// getJwt() without the caller deciding that's the right thing to do.

// Exported so other call sites that need the same raw-fetch-RPC pattern
// (bypassing sb.rpc()'s mutex risk) don't have to duplicate it — see
// OAuthCallbackPage.tsx's use for claim_oauth_username().
export async function rpcPost<T = any>(
  fnName: string,
  body: Record<string, any>,
  jwt: string
): Promise<{ data: T | null; error: any }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
      method: "POST",
      headers: supabaseHeaders(jwt),
      body: JSON.stringify(body),
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : null;
    if (!res.ok) {
      return { data: null, error: { ...(parsed || {}), status: res.status } };
    }
    return { data: parsed as T, error: null };
  } catch (e: any) {
    return { data: null, error: { message: e?.message ?? String(e) } };
  }
}

async function restGet<T = any>(
  pathAndQuery: string,
  jwt: string
): Promise<{ data: T | null; error: any }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
      method: "GET",
      headers: supabaseHeaders(jwt),
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : null;
    if (!res.ok) {
      return { data: null, error: { ...(parsed || {}), status: res.status } };
    }
    return { data: parsed as T, error: null };
  } catch (e: any) {
    return { data: null, error: { message: e?.message ?? String(e) } };
  }
}

// Decode { id, email } straight out of a JWT — synchronous, no lock, no
// network call. Mirrors the base64url decode OAuthCallbackPage.tsx already
// uses when it manually seeds the session into localStorage. Used only for
// the on-mount check, where localStorage is the only source available.
function decodeUserFromJwt(jwt: string): CurrentUser | null {
  try {
    if (!jwt) return null;
    const parts = jwt.split(".");
    if (parts.length < 2) return null;
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const payload = JSON.parse(atob(b64));
    if (!payload?.sub) return null;
    return {
      id: String(payload.sub),
      email: payload.email ? String(payload.email) : null,
    };
  } catch {
    return null;
  }
}

function getDeviceFingerprint(): string {
  const key = "device_fingerprint_v1";
  const existing = window.localStorage.getItem(key);
  if (existing && existing.length >= 16) return existing;

  const fp =
    globalThis.crypto?.randomUUID?.() ??
    `fp_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  window.localStorage.setItem(key, fp);
  return fp;
}

async function touchSessionAndDevice(jwt: string) {
  try {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : null;

    const s = await rpcPost("touch_session", { p_ua: ua }, jwt);
    if (s.error) console.warn("touch_session failed (non-fatal):", s.error);

    const fp = getDeviceFingerprint();
    const d = await rpcPost("touch_device", { p_device_fingerprint: fp }, jwt);
    if (d.error) console.warn("touch_device failed (non-fatal):", d.error);
  } catch (e) {
    console.warn("touchSessionAndDevice exception (non-fatal):", e);
  }
}

function isConflictError(err: any): boolean {
  // Supabase/PostgREST usually surfaces status for HTTP errors; sometimes only message/code is present.
  const status = err?.status ?? err?.cause?.status;
  if (status === 409) return true;

  // Also treat common unique-violation patterns as conflict-ish
  const code = String(err?.code ?? "");
  if (code === "23505") return true;

  const msg = String(err?.message ?? "").toLowerCase();
  if (msg.includes("409") || msg.includes("conflict") || msg.includes("duplicate")) {
    return true;
  }

  return false;
}

// Anon-key fallback produces a distinctive, recognizable shape: PostgREST/
// Postgres surfaces the SECURITY DEFINER function's `raise exception 'Not
// authenticated'` this way. Recognizing it lets runBootstrap tell a real
// server-side failure apart from "the JWT wasn't ready yet."
function isNotAuthenticatedError(err: any): boolean {
  const msg = String(err?.message ?? "").toLowerCase();
  return msg.includes("not authenticated");
}

async function applyOAuthStashIfPresent(user: CurrentUser, jwt: string) {
  // Clear oauth suggestions that were set by OAuthCallbackPage
  // These are consumed by Signup onboarding pre-fill, not applied directly here
  // (the user needs to confirm their display name / username in onboarding)
  // We only clean up stale entries if the user has already completed onboarding
  try {
    const uid = user.id;
    if (!uid) return;

    const r = await restGet<{ username: string | null }[]>(
      `profiles?select=username&user_id=eq.${uid}&limit=1`,
      jwt
    );
    if (r.data?.[0]?.username) {
      // Onboarding complete — clear any leftover oauth suggestions
      window.localStorage.removeItem("oauth_username_suggestion");
      window.localStorage.removeItem("oauth_display_name");
    }
  } catch {
    // Non-fatal
  }
}

async function mergeEmbeddedStancesIfPending(jwt: string) {
  // Epic T: Merge anonymous embedded stances to the newly created account
  const fp = window.localStorage.getItem("sc_pending_merge_fp");
  if (!fp) return;

  try {
    const { data: merged } = await rpcPost<number>(
      "merge_embedded_stances",
      { p_device_fingerprint: fp },
      jwt
    );
    if (merged && merged > 0) {
      console.info(`[bootstrap] Merged ${merged} embedded stance(s) to account`);
    }
    // Clear regardless of result
    window.localStorage.removeItem("sc_pending_merge_fp");
    window.localStorage.removeItem("sc_pending_merge_count");
  } catch (e) {
    console.warn("[bootstrap] Embedded stance merge failed (non-fatal):", e);
  }
}

// Exported so OAuthCallbackPage.tsx can call it directly and deterministically
// at the moment a social login completes, instead of relying solely on
// onAuthStateChange — which does NOT fire for the manually-seeded-session path
// that OAuth login uses (see OAuthCallbackPage.tsx's seedSessionToStorage()
// comment). bootstrap_user_after_login() is idempotent (ON CONFLICT DO
// NOTHING / DO UPDATE), so it's safe if onAuthStateChange also ends up firing
// later for the same user (e.g. on a future token refresh) — this just means
// it may run twice, harmlessly, rather than not at all.
export async function runBootstrap(user: CurrentUser, jwt: string, attempt = 1) {
  // Does everything now: creates public.users/profiles, and — on a
  // genuinely new user only — applies username/DOB/gender/location/audience
  // segment from auth.users.raw_user_meta_data. See the migration that
  // shipped alongside this file for the SQL side of this.
  const r = await rpcPost("bootstrap_user_after_login", {}, jwt);

  if (r.error) {
    if (isConflictError(r.error)) {
      // 409 generally means "already bootstrapped / idempotent conflict" —
      // safe to continue, not a real failure.
      console.warn(
        "bootstrap_user_after_login returned conflict (continuing):",
        r.error
      );
    } else if (isNotAuthenticatedError(r.error) && attempt === 1) {
      // The one retry-worthy case: the JWT we had wasn't valid server-side
      // yet (session still settling). Re-read getJwt() from localStorage —
      // by now the SDK has very likely finished persisting it — and retry
      // once. If this also fails, fall through and continue with whatever
      // JWT we've got rather than retrying forever.
      console.warn(
        "[bootstrap] bootstrap_user_after_login: not authenticated yet, retrying once with a fresh token"
      );
      const freshJwt = getJwt();
      if (freshJwt && freshJwt !== jwt) {
        return runBootstrap(user, freshJwt, attempt + 1);
      }
      console.error("bootstrap_user_after_login failed:", r.error);
    } else {
      console.error("bootstrap_user_after_login failed:", r.error);
      // Still continue — session/device touches and cleanup below are safe and useful
      // even if bootstrap itself hit a real error.
    }
  }

  await applyOAuthStashIfPresent(user, jwt);
  await mergeEmbeddedStancesIfPending(jwt);
  await touchSessionAndDevice(jwt);

  // Signal to the feed that location/profile data is now written.
  // 300ms delay ensures Supabase has committed all writes before the re-fetch fires.
  // IndexPage listens and invalidates my-region => all location-dependent queries re-fetch.
  setTimeout(() => {
    try {
      (window as any).__bootstrapComplete = true;
      window.dispatchEvent(new CustomEvent("bootstrap:complete"));
    } catch {
      /* non-fatal */
    }
  }, 300);
}

export function useBootstrapUser() {
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;

    let cancelled = false;
    let lastBootstrappedUserId: string | null = null;

    // Guard is set synchronously, before any async work starts — closes the
    // race where two auth events firing back to back (e.g. INITIAL_SESSION
    // then SIGNED_IN) could both slip past the check before either set it.
    const maybeBootstrap = (user: CurrentUser | null, jwt: string) => {
      if (cancelled || !user?.id || !jwt) return;
      if (lastBootstrappedUserId === user.id) return;
      lastBootstrappedUserId = user.id;
      void runBootstrap(user, jwt);
    };

    // Initial check on mount — page refresh with an already-established
    // session. localStorage has had time to settle by now, so it's safe to
    // read the JWT from getJwt() here (unlike inside the auth-event callback
    // below, where the session may have just this instant been written).
    const initialJwt = getJwt();
    maybeBootstrap(decodeUserFromJwt(initialJwt), initialJwt);

    // Listen for future sign-ins / sign-outs. The callback itself stays
    // synchronous (no awaited SDK calls inside it) — Supabase's own docs
    // warn that awaiting auth calls inside this callback can deadlock the
    // client, which is exactly what this hook used to do. Use the token off
    // the session object directly rather than re-reading localStorage —
    // that's the one guaranteed-fresh value available at this exact moment.
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (!session?.user) {
        lastBootstrappedUserId = null;
        return;
      }
      maybeBootstrap(
        { id: session.user.id, email: session.user.email ?? null },
        session.access_token ?? getJwt()
      );
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);
}
