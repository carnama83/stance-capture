// src/hooks/useBootstrapUser.ts
import { useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Local client just for bootstrapping
const sb = createClient(supabaseUrl, supabaseAnonKey);

type SignupStashV1 = {
  username?: string;
  dob?: string;
  gender?: string;
  genderSelf?: string;
  country?: string;   // e.g. "US"
  stateCode?: string; // e.g. "NJ"
  countyCode?: string; // e.g. "34003" (matches locations.iso_code for county)
  cityId?: string;    // uuid (geo_cities_v.id)
};

type Precision = "city" | "county" | "state" | "country" | "none";

async function resolveLocationFromStash(stash: SignupStashV1): Promise<
  | { locationId: string; precision: Precision }
  | null
> {
  // City: stash stores uuid from geo_cities_v.id
  if (stash.cityId) {
    return { locationId: stash.cityId, precision: "city" };
  }

  // County: stash stores geo_counties_v.code (should match locations.iso_code)
  if (stash.countyCode) {
    const r = await sb
      .from("locations")
      .select("id")
      .eq("type", "county")
      .eq("iso_code", stash.countyCode)
      .limit(1)
      .single();

    if (!r.error && r.data?.id) {
      return { locationId: r.data.id, precision: "county" };
    }
  }

  // State: try both "NJ" and "US-NJ"
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
      return { locationId: row.id, precision: "state" };
    }
  }

  // Country
  if (stash.country) {
    const r = await sb
      .from("locations")
      .select("id")
      .eq("type", "country")
      .eq("iso_code", stash.country)
      .limit(1)
      .single();

    if (!r.error && r.data?.id) {
      return { locationId: r.data.id, precision: "country" };
    }
  }

  return null;
}

async function applySignupStashIfPresent() {
  let stash: SignupStashV1 | null = null;

  try {
    const raw = window.localStorage.getItem("signup_stash_v1");
    if (!raw) return;

    stash = JSON.parse(raw) as SignupStashV1;
  } catch {
    // corrupted stash -> clear it
    window.localStorage.removeItem("signup_stash_v1");
    return;
  }

  // Must have an authenticated user at this point
  const { data: userRes } = await sb.auth.getUser();
  const uid = userRes.user?.id;
  if (!uid) return;

  // Apply username (optional)
  if (stash.username && stash.username.trim()) {
    const uname = stash.username.trim().toLowerCase();
    const r = await sb.rpc("set_username", { p_username: uname });
    if (r.error) console.warn("set_username failed:", r.error);
  }

  // Apply DOB (optional)
  if (stash.dob && stash.dob.trim()) {
    const r = await sb.rpc("profile_set_dob_checked", { p_dob_text: stash.dob });
    if (r.error) console.warn("profile_set_dob_checked failed:", r.error);
  }

  // Apply gender (optional)
  if (stash.gender && stash.gender.trim()) {
    const r = await sb.rpc("profile_set_gender", {
      p_gender: stash.gender,
      p_gender_self:
        stash.gender === "self_described" ? stash.genderSelf ?? null : null,
    });
    if (r.error) console.warn("profile_set_gender failed:", r.error);
  }

  // Apply location (optional)
  const resolved = await resolveLocationFromStash(stash);
  if (resolved) {
    // IMPORTANT: This calls the UUID overload (p_user_id uuid, p_location_id uuid...)
    const r = await sb.rpc("set_user_location", {
      p_user_id: uid,
      p_location_id: resolved.locationId,
      p_precision: resolved.precision,
      p_override: false,
      p_source: "signup",
    });

    if (r.error) console.warn("set_user_location failed:", r.error);
  }

  // Clear stash once applied
  window.localStorage.removeItem("signup_stash_v1");
}

async function runBootstrap() {
  // Ensure public.users + public.profiles exist
  const r = await sb.rpc("bootstrap_user_after_login");
  if (r.error) {
    console.error("bootstrap_user_after_login failed:", r.error);
    return;
  }

  // Apply saved signup fields for email-confirm flow
  await applySignupStashIfPresent();
}

export function useBootstrapUser() {
  useEffect(() => {
    let isMounted = true;

    const checkInitial = async () => {
      try {
        const { data } = await sb.auth.getSession();
        if (!isMounted) return;

        if (data.session?.user) {
          await runBootstrap();
        }
      } catch (err) {
        console.error("bootstrap (initial) failed:", err);
      }
    };

    checkInitial();

    const { data: subscription } = sb.auth.onAuthStateChange(
      async (_event, session) => {
        if (session?.user) {
          try {
            await runBootstrap();
          } catch (err) {
            console.error("bootstrap (auth state change) failed:", err);
          }
        }
      }
    );

    return () => {
      isMounted = false;
      subscription?.subscription?.unsubscribe?.();
    };
  }, []);
}
