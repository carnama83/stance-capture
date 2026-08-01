// src/hooks/useBootstrapUser.ts
//
// FIX (auth-mutex hang): this hook used to run every mutation through
// sb.auth.getSession() / sb.auth.getUser() / sb.rpc() — the exact SDK
// methods that hang under the Supabase JS auth-mutex bug (see
// src/lib/supabaseClient.ts and src/lib/env.ts). Worse, it was doing this
// *inside* the onAuthStateChange callback, which Supabase's own docs warn
// can deadlock the client. That's why location (and username/dob/gender)
// intermittently never got written after signup — confirmed via
// location_audits: affected users have zero rows, meaning the RPC never
// completed.
//
// Fix: every mutation now goes through raw fetch() + getJwt() +
// supabaseHeaders(), matching the discipline used everywhere else in this
// app (see ProposerBadge.tsx, QuestionDetailPage.tsx). The only SDK call
// left is auth.onAuthStateChange() itself, which just registers a
// listener — it doesn't block or acquire the lock.
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

type SignupStashV1 = {
  username?: string;
  dob?: string; // YYYY-MM-DD
  gender?: string;
  genderSelf?: string;
  country?: string;
  stateCode?: string;
  countyCode?: string;
  cityId?: string;
  // Epic AG: audience intelligence signals
  campaignAudience?: string | null;  // from ?s= or ?audience= URL param at signup
  entryPath?: string | null;         // hash path at time of signup e.g. '/students'
};

type Precision = "city" | "county" | "state" | "country" | "none";

type CurrentUser = { id: string; email: string | null };

// ── Raw-fetch helpers (replaces sb.rpc() / sb.from() for this file) ───────
// Same { data, error } shape as the SDK, so the logic below barely changes.

async function rpcPost<T = any>(
  fnName: string,
  body: Record<string, any> = {}
): Promise<{ data: T | null; error: any }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
      method: "POST",
      headers: supabaseHeaders(getJwt()),
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
  pathAndQuery: string
): Promise<{ data: T | null; error: any }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
      method: "GET",
      headers: supabaseHeaders(getJwt()),
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

// Decode { id, email } straight out of the JWT — synchronous, no lock, no
// network call. Mirrors the base64url decode OAuthCallbackPage.tsx already
// uses when it manually seeds the session into localStorage.
function getCurrentUserFromJwt(): CurrentUser | null {
  try {
    const jwt = getJwt();
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

async function resolveLocationFromStash(stash: SignupStashV1) {
  // City: stash.cityId is already a locations.id (UUID) in your current Signup flow
  if (stash.cityId) {
    return { locationId: stash.cityId, precision: "city" as Precision };
  }

  // County: stash.countyCode is iso_code; resolve to locations.id
  if (stash.countyCode) {
    const r = await restGet<{ id: string }[]>(
      `locations?select=id&type=eq.county&iso_code=eq.${encodeURIComponent(
        stash.countyCode
      )}&limit=1`
    );
    if (!r.error && r.data?.[0]?.id) {
      return { locationId: r.data[0].id, precision: "county" as Precision };
    }
  }

  // State: stateCode might be "NJ" or "US-NJ" depending on your dataset
  if (stash.stateCode) {
    const guesses = stash.country
      ? [stash.stateCode, `${stash.country}-${stash.stateCode}`]
      : [stash.stateCode];

    const inList = guesses.map((g) => encodeURIComponent(g)).join(",");
    const r = await restGet<{ id: string; iso_code: string }[]>(
      `locations?select=id,iso_code&type=eq.state&iso_code=in.(${inList})&limit=1`
    );
    const row = r.data?.[0];
    if (!r.error && row?.id) {
      return { locationId: row.id, precision: "state" as Precision };
    }
  }

  // Country: stash.country is iso_code; resolve to locations.id
  if (stash.country) {
    const r = await restGet<{ id: string }[]>(
      `locations?select=id&type=eq.country&iso_code=eq.${encodeURIComponent(
        stash.country
      )}&limit=1`
    );
    if (!r.error && r.data?.[0]?.id) {
      return { locationId: r.data[0].id, precision: "country" as Precision };
    }
  }

  return null;
}

// ── Epic AG: compute age band from DOB string ─────────────────────────────
// DOB is available in the stash as plaintext (YYYY-MM-DD) before encryption.
// We compute age here so the SQL function never needs to decrypt dob_encrypted.
function computeAgeBand(dob: string | undefined | null): number | null {
  if (!dob) return null;
  try {
    const birth = new Date(dob.trim());
    if (isNaN(birth.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birth.getDate())
    ) {
      age--;
    }
    return age >= 0 && age < 150 ? age : null;
  } catch {
    return null;
  }
}

// ── Epic AG: resolve audience segment from stash signals ──────────────────
async function applyAudienceSegmentFromStash(
  stash: SignupStashV1,
  email: string | null
) {
  try {
    const dobAgeBand = computeAgeBand(stash.dob);

    const { data: resolvedKey, error } = await rpcPost<string>(
      "initialize_user_context_from_signup",
      {
        p_email: email ?? null,
        p_dob_age_band: dobAgeBand,
        p_entry_path: stash.entryPath ?? null,
        p_campaign_audience: stash.campaignAudience ?? null,
        p_share_ref: null, // reserved for future share-link inference
      }
    );

    if (error) {
      console.warn(
        "[bootstrap] initialize_user_context_from_signup failed (non-fatal):",
        error
      );
    } else {
      console.info("[bootstrap] Audience segment resolved:", resolvedKey ?? "general");
    }
  } catch (e) {
    console.warn("[bootstrap] Audience segment resolution exception (non-fatal):", e);
  }
}

async function applySignupStashIfPresent(user: CurrentUser) {
  const raw = window.localStorage.getItem("signup_stash_v1");
  if (!raw) return;

  let stash: SignupStashV1;
  try {
    stash = JSON.parse(raw);
  } catch {
    window.localStorage.removeItem("signup_stash_v1");
    return;
  }

  const uid = user.id;
  const email = user.email;

  // Username (non-fatal)
  if (stash.username && stash.username.trim()) {
    const uname = stash.username.trim().toLowerCase();
    const r = await rpcPost("set_username", { p_username: uname });
    if (r.error) console.warn("set_username failed (non-fatal):", r.error);
  }

  // DOB (non-fatal) — checks dob_encrypted is empty before setting
  if (stash.dob && stash.dob.trim()) {
    const prof = await restGet<{ dob_encrypted: string | null }[]>(
      `profiles?select=dob_encrypted&user_id=eq.${uid}&limit=1`
    );

    if (!prof.error && !prof.data?.[0]?.dob_encrypted) {
      const dob = stash.dob.trim();
      const r2 = await rpcPost("profile_set_dob_checked", { p_dob_text: dob });
      if (r2.error) {
        console.warn("profile_set_dob_checked failed (non-fatal):", r2.error);
      }
    }
  }

  // Gender (non-fatal)
  if (stash.gender && stash.gender.trim()) {
    const r = await rpcPost("profile_set_gender", {
      p_gender: stash.gender,
      p_gender_self:
        stash.gender === "self_described" ? stash.genderSelf ?? null : null,
    });
    if (r.error) console.warn("profile_set_gender failed (non-fatal):", r.error);
  }

  // ✅ Location (non-fatal) — Option 1: ALWAYS CASCADE
  // This ensures signup/confirm-email path creates 4 rows (city+county+state+country)
  const resolved = await resolveLocationFromStash(stash);
  if (resolved) {
    const r = await rpcPost("set_user_location_cascade", {
      p_user_id: uid,
      p_location_id: resolved.locationId,
      p_precision: resolved.precision,
      p_override: false,
      p_source: "bootstrap",
    });
    if (r.error) {
      console.warn("set_user_location_cascade failed (non-fatal):", r.error);
    }
  }

  // ✅ Epic AG: Audience segment resolution (non-fatal)
  // Runs after all other stash applications — order doesn't matter but
  // keeping it last ensures DOB is already set if needed for future signals.
  await applyAudienceSegmentFromStash(stash, email);

  // Clear stash only after we attempted to apply it
  window.localStorage.removeItem("signup_stash_v1");
}

async function touchSessionAndDevice() {
  try {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : null;

    const s = await rpcPost("touch_session", { p_ua: ua });
    if (s.error) console.warn("touch_session failed (non-fatal):", s.error);

    const fp = getDeviceFingerprint();
    const d = await rpcPost("touch_device", { p_device_fingerprint: fp });
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

async function applyOAuthStashIfPresent(user: CurrentUser) {
  // Clear oauth suggestions that were set by OAuthCallbackPage
  // These are consumed by Signup onboarding pre-fill, not applied directly here
  // (the user needs to confirm their display name / username in onboarding)
  // We only clean up stale entries if the user has already completed onboarding
  try {
    const uid = user.id;
    if (!uid) return;

    const r = await restGet<{ username: string | null }[]>(
      `profiles?select=username&user_id=eq.${uid}&limit=1`
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

async function mergeEmbeddedStancesIfPending() {
  // Epic T: Merge anonymous embedded stances to the newly created account
  const fp = window.localStorage.getItem("sc_pending_merge_fp");
  if (!fp) return;

  try {
    const { data: merged } = await rpcPost<number>("merge_embedded_stances", {
      p_device_fingerprint: fp,
    });
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

async function runBootstrap(user: CurrentUser) {
  const r = await rpcPost("bootstrap_user_after_login", {});

  // ✅ Important: don't abort stash application on 409
  // 409 generally means "already bootstrapped / idempotent conflict", so continue.
  if (r.error) {
    if (isConflictError(r.error)) {
      console.warn(
        "bootstrap_user_after_login returned conflict (continuing):",
        r.error
      );
    } else {
      console.error("bootstrap_user_after_login failed:", r.error);
      // Still continue — stash application and session/device touches are safe and useful
    }
  }

  await applySignupStashIfPresent(user);
  await applyOAuthStashIfPresent(user);
  await mergeEmbeddedStancesIfPending();
  await touchSessionAndDevice();

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
    const maybeBootstrap = (user: CurrentUser | null) => {
      if (cancelled || !user?.id) return;
      if (lastBootstrappedUserId === user.id) return;
      lastBootstrappedUserId = user.id;
      void runBootstrap(user);
    };

    // Initial check on mount — read straight from localStorage via the JWT,
    // no SDK network call, so nothing here can hit the auth-mutex lock.
    maybeBootstrap(getCurrentUserFromJwt());

    // Listen for future sign-ins / sign-outs. The callback itself stays
    // synchronous (no awaited SDK calls inside it) — Supabase's own docs
    // warn that awaiting auth calls inside this callback can deadlock the
    // client, which is exactly what this hook used to do.
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (!session?.user) {
        lastBootstrappedUserId = null;
        return;
      }
      maybeBootstrap({ id: session.user.id, email: session.user.email ?? null });
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);
}