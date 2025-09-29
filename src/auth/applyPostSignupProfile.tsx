// src/auth/applyPostSignupProfile.ts
import { getSupabase } from "../lib/supabaseClient";
type Payload = {
  dob?: string | null;
  username?: string | null;
  gender?: string;
  gender_self?: string | null;
  loc?: { country?: string|null; state?: string|null; county?: string|null; city?: string|null };
};

export async function applyPostSignupProfile() {
  const raw = localStorage.getItem("postSignupProfile");
  if (!raw) return;
  const sb = getSupabase();
  if (!sb) return;

  try {
    const p = JSON.parse(raw) as Payload;
    await sb.rpc("init_user_after_signup");

    if (p.username) {
      await sb.rpc("set_username", { p_username: p.username }).catch(()=>{});
    }
    if (p.dob) {
      await sb.rpc("profile_set_dob_checked", { p_dob_text: p.dob }).catch(()=>{});
    }
    if (p.gender) {
      await sb.rpc("profile_set_gender", {
        p_gender: p.gender,
        p_gender_self: p.gender === "self_described" ? (p.gender_self || null) : null,
      }).catch(async () => {
        await sb.from("profiles").update({
          gender: p.gender,
          gender_self: p.gender === "self_described" ? (p.gender_self || null) : null,
          updated_at: new Date().toISOString(),
        }).select("user_id").single().catch(()=>{});
      });
    }
    if (p.loc && (p.loc.city || p.loc.county || p.loc.state || p.loc.country)) {
      const who = await sb.rpc("whoami");
      const userId = who?.data ? String(who.data) : null;
      if (userId) {
        // resolve to UUID location like in your Signup
        // (reuse your resolveLocationForSelection if exported)
        // For brevity, assume you have a util:
        // const { locationId, precision } = await resolveFromCodes(p.loc);
        // await sb.rpc("set_user_location", { p_user_id: userId, p_location_id: locationId, p_precision: precision, p_override: false, p_source: "login" });
      }
    }
  } finally {
    // clear regardless; the ops above are idempotent due to RPC guards
    localStorage.removeItem("postSignupProfile");
  }
}
