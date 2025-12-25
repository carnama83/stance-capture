// src/hooks/useBootstrapUser.ts
import { useEffect } from "react";
import { getSupabase } from "../lib/supabaseClient";

type SignupStashV1 = {
  username?: string;
  dob?: string; // YYYY-MM-DD
  gender?: string;
  genderSelf?: string;
  country?: string;
  stateCode?: string;
  countyCode?: string;
  cityId?: string;
};

type Precision = "city" | "county" | "state" | "country" | "none";

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

async function resolveLocationFromStash(sb: any, stash: SignupStashV1) {
  // City: stash.cityId is already a locations.id (UUID) in your current Signup flow
  if (stash.cityId) {
    return { locationId: stash.cityId, precision: "city" as Precision };
  }

  // County: stash.countyCode is iso_code; resolve to locations.id
  if (stash.countyCode) {
    const r = await sb
      .from("locations")
      .select("id")
      .eq("type", "county")
      .eq("iso_code", stash.countyCode)
      .limit(1)
      .single();

    if (!r.error && r.data?.id) {
      return { locationId: r.data.id, precision: "county" as Precision };
    }
  }

  // State: stateCode might be "NJ" or "US-NJ" depending on your dataset
  if (stash.stateCode) {
    const guesses = stash.country
      ? [stash.stateCode, `${stash.country}-${stash.stateCode}`]
      : [stash.stateCode];

    const r = await sb
      .from("locations")
      .select("id, iso_code")
      .eq("type", "state")
      .in("iso_code", guesses)
      .limit(1);

    const row = r.data?.[0];
    if (!r.error && row?.id) {
      return { locationId: row.id, precision: "state" as Precision };
    }
  }

  // Country: stash.country is iso_code; resolve to locations.id
  if (stash.country) {
    const r = await sb
      .from("locations")
      .select("id")
      .eq("type", "country")
      .eq("iso_code", stash.country)
      .limit(1)
      .single();

    if (!r.error && r.data?.id) {
      return { locationId: r.data.id, precision: "country" as Precision };
    }
  }

  return null;
}

async function applySignupStashIfPresent(sb: any) {
  const raw = window.localStorage.getItem("signup_stash_v1");
  if (!raw) return;

  let stash: SignupStashV1;
  try {
    stash = JSON.parse(raw);
  } catch {
    window.localStorage.removeItem("signup_stash_v1");
    return;
  }

  const { data: userRes } = await sb.auth.getUser();
  const uid = userRes.user?.id;
  if (!uid) return;

  // Username (non-fatal)
  if (stash.username && stash.username.trim()) {
    const uname = stash.username.trim().toLowerCase();
    const r = await sb.rpc("set_username", { p_username: uname });
    if (r.error) console.warn("set_username failed (non-fatal):", r.error);
  }

  // DOB (non-fatal) — checks dob_encrypted is empty before setting
  if (stash.dob && stash.dob.trim()) {
    const prof = await sb
      .from("profiles")
      .select("dob_encrypted")
      .eq("user_id", uid)
      .single();

    if (!prof.error && !prof.data?.dob_encrypted) {
      const dob = stash.dob.trim();
      const r2 = await sb.rpc("profile_set_dob_checked", { p_dob_text: dob });
      if (r2.error) {
        console.warn("profile_set_dob_checked failed (non-fatal):", r2.error);
      }
    }
  }

  // Gender (non-fatal)
  if (stash.gender && stash.gender.trim()) {
    const r = await sb.rpc("profile_set_gender", {
      p_gender: stash.gender,
      p_gender_self:
        stash.gender === "self_described" ? stash.genderSelf ?? null : null,
    });
    if (r.error) console.warn("profile_set_gender failed (non-fatal):", r.error);
  }

  // ✅ Location (non-fatal) — Option 1: ALWAYS CASCADE
  // This ensures signup/confirm-email path creates 4 rows (city+county+state+country)
  const resolved = await resolveLocationFromStash(sb, stash);
  if (resolved) {
    const r = await sb.rpc("set_user_location_cascade", {
      p_user_id: uid,
      p_location_id: resolved.locationId,
      p_precision: resolved.precision,
      p_override: false,
      p_source: "bootstrap",
    });
    if (r.error) {
      console.warn(
        "set_user_location_cascade failed (non-fatal):",
        r.error
      );
    }
  }

  // Clear stash only after we attempted to apply it
  window.localStorage.removeItem("signup_stash_v1");
}

async function touchSessionAndDevice(sb: any) {
  try {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : null;

    const s = await sb.rpc("touch_session", { p_ua: ua });
    if (s.error) console.warn("touch_session failed (non-fatal):", s.error);

    const fp = getDeviceFingerprint();
    const d = await sb.rpc("touch_device", { p_device_fingerprint: fp });
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

async function runBootstrap(sb: any) {
  const r = await sb.rpc("bootstrap_user_after_login");

  // ✅ Important: don’t abort stash application on 409
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

  await applySignupStashIfPresent(sb);
  await touchSessionAndDevice(sb);
}

export function useBootstrapUser() {
  useEffect(() => {
    const sb = getSupabase();
    let cancelled = false;
    let unsub: (() => void) | null = null;

    let lastBootstrappedUserId: string | null = null;

    const maybeBootstrap = async () => {
      const { data } = await sb.auth.getUser();
      const uid = data.user?.id;
      if (!uid) return;

      // prevent duplicate bootstrap runs per user per mount
      if (lastBootstrappedUserId === uid) return;
      lastBootstrappedUserId = uid;

      await runBootstrap(sb);
    };

    (async () => {
      const { data: sess } = await sb.auth.getSession();
      if (cancelled) return;

      if (sess.session?.user) {
        await maybeBootstrap();
      }

      const { data: sub } = sb.auth.onAuthStateChange(async (_event, session) => {
        if (!session?.user) {
          lastBootstrappedUserId = null;
          return;
        }
        await maybeBootstrap();
      });

      unsub = () => sub?.subscription?.unsubscribe?.();
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);
}
