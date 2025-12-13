// src/hooks/useBootstrapUser.ts
import { useEffect } from "react";
import { getSupabase } from "../lib/supabaseClient";

type SignupStashV1 = {
  username?: string;
  dob?: string;
  gender?: string;
  genderSelf?: string;
  country?: string;     // e.g. "US"
  stateCode?: string;   // e.g. "NJ"
  countyCode?: string;  // e.g. "34003" (matches locations.iso_code for county)
  cityId?: string;      // uuid from geo_cities_v.id
};

type Precision = "city" | "county" | "state" | "country" | "none";

async function resolveLocationFromStash(sb: any, stash: SignupStashV1) {
  if (stash.cityId) {
    return { locationId: stash.cityId, precision: "city" as Precision };
  }

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

  // username
  if (stash.username && stash.username.trim()) {
    const uname = stash.username.trim().toLowerCase();
    const r = await sb.rpc("set_username", { p_username: uname });
    if (r.error) console.warn("set_username failed:", r.error);
  }

  // dob
  if (stash.dob && stash.dob.trim()) {
    const r = await sb.rpc("profile_set_dob_checked", { p_dob_text: stash.dob });
    if (r.error) console.warn("profile_set_dob_checked failed:", r.error);
  }

  // gender
  if (stash.gender && stash.gender.trim()) {
    const r = await sb.rpc("profile_set_gender", {
      p_gender: stash.gender,
      p_gender_self:
        stash.gender === "self_described" ? stash.genderSelf ?? null : null,
    });
    if (r.error) console.warn("profile_set_gender failed:", r.error);
  }

  // location
  const resolved = await resolveLocationFromStash(sb, stash);
  if (resolved) {
    const r = await sb.rpc("set_user_location", {
      p_user_id: uid,
      p_location_id: resolved.locationId,
      p_precision: resolved.precision,
      p_override: false,
      p_source: "signup",
    });
    if (r.error) console.warn("set_user_location failed:", r.error);
  }

  // clear stash only after we attempted to apply
  window.localStorage.removeItem("signup_stash_v1");
}

async function runBootstrap(sb: any) {
  // Ensure public.users + public.profiles exist
  const r = await sb.rpc("bootstrap_user_after_login");
  if (r.error) {
    console.error("bootstrap_user_after_login failed:", r.error);
    return;
  }

  // Apply stashed signup fields after confirm-email login
  await applySignupStashIfPresent(sb);
}

export function useBootstrapUser() {
  useEffect(() => {
    const sb = getSupabase();

    let unsub: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      // initial check
      const { data } = await sb.auth.getSession();
      if (cancelled) return;

      if (data.session?.user) {
        await runBootstrap(sb);
      }

      // subscribe
      const { data: sub } = sb.auth.onAuthStateChange(async (event, session) => {
        if (!session?.user) {
          // SIGNED_OUT etc. -> do nothing (prevents “logout undo” behavior)
          return;
        }
        // SIGNED_IN / TOKEN_REFRESHED / USER_UPDATED
        await runBootstrap(sb);
      });

      unsub = () => sub?.subscription?.unsubscribe?.();
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);
}
