// supabase/functions/whatsapp-claim-anonymous-stances/index.ts
// Epic AA — AA4.2
//
// Nightly job: for each profile where verified_phone_hash was set or updated
// in the past ~24 hours:
//   (A) backfill stance_history.user_id for that phone hash, so the person's
//       pre-verification WhatsApp longitudinal history attaches to their account
//       (and becomes visible via get_my_stance_history / RLS), and
//   (B) claim matching question_stances rows (user_id IS NULL -> set user_id).
//
// This retroactively attributes anonymous WhatsApp activity to a platform
// account when the user later verifies their phone number.
//
// Cron schedule: daily at 02:00 UTC (low-traffic window)
//
// Env secrets required:
//   SUPABASE_SERVICE_ROLE_KEY
//   SUPABASE_URL
//   CRON_SECRET
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const FUNC = "whatsapp-claim-anonymous-stances";
const LOOKBACK_HOURS = 25; // Slightly over 24h to avoid missing midnight edge cases
function log(level, msg, extra = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    func: FUNC,
    msg,
    ...extra
  }));
}
serve(async (req)=>{
  const CRON_SECRET = Deno.env.get("CRON_SECRET");
  const authHeader = req.headers.get("authorization") ?? "";
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (authHeader !== `Bearer ${SERVICE_KEY}`) {
      return new Response("Unauthorized", {
        status: 401
      });
    }
  }
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString();
  // Find profiles that recently had a phone hash set or updated
  // (covers: new verifications, hash updates after phone change)
  const { data: recentProfiles, error: profilesErr } = await supabase.from("profiles").select("user_id, verified_phone_hash").not("verified_phone_hash", "is", null).gte("updated_at", since);
  if (profilesErr) {
    log("error", "Failed to fetch profiles", {
      error: profilesErr.message
    });
    return new Response(JSON.stringify({
      error: profilesErr.message
    }), {
      status: 500
    });
  }
  if (!recentProfiles || recentProfiles.length === 0) {
    log("info", "No recently verified phones — nothing to claim");
    return new Response(JSON.stringify({
      claimed: 0,
      history_backfilled: 0,
      profiles_checked: 0
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  log("info", "Checking profiles for claimable stances", {
    count: recentProfiles.length
  });
  let totalClaimed = 0;
  let totalHistoryBackfilled = 0;
  for (const profile of recentProfiles){
    const { user_id, verified_phone_hash } = profile;
    if (!user_id || !verified_phone_hash) continue;
    try {
      // (A) Backfill stance_history identity for this phone hash. Runs regardless
      // of whether question_stances still has unclaimed rows, so a person's
      // longitudinal WhatsApp history attaches even on a later run. Idempotent:
      // the `is("user_id", null)` guard means only unclaimed rows are touched.
      const { error: histErr, count: histCount } = await supabase.from("stance_history").update({
        user_id
      }, {
        count: "exact"
      }).eq("whatsapp_phone_hash", verified_phone_hash).is("user_id", null);
      if (histErr) {
        log("warn", "Error backfilling stance_history for profile", {
          user_id,
          error: histErr.message
        });
      } else if (histCount && histCount > 0) {
        log("info", "Backfilled stance_history rows", {
          user_id,
          history_rows: histCount
        });
        totalHistoryBackfilled += histCount;
      }

      // (B) Find anonymous WhatsApp stances for this phone hash
      const { data: anonStances, error: findErr } = await supabase.from("question_stances").select("id").eq("whatsapp_phone_hash", verified_phone_hash).is("user_id", null).eq("source", "whatsapp_flow");
      if (findErr) {
        log("warn", "Error finding stances for profile", {
          user_id,
          error: findErr.message
        });
        continue;
      }
      if (!anonStances || anonStances.length === 0) continue;
      const stanceIds = anonStances.map((s)=>s.id);
      // Claim stances: set user_id — deduplicate against any native stances
      // the user may have already taken on these questions
      let claimed = 0;
      for (const stanceId of stanceIds){
        const { error: claimErr } = await supabase.from("question_stances").update({
          user_id
        }).eq("id", stanceId).is("user_id", null); // Safety: only claim if still anonymous
        if (!claimErr) claimed++;
      }
      if (claimed > 0) {
        log("info", "Claimed stances for user", {
          user_id,
          claimed
        });
        totalClaimed += claimed;
      }
    } catch (err) {
      log("warn", "Error claiming stances for profile", {
        user_id,
        error: String(err)
      });
    }
  }
  // Also purge expired whatsapp_phone_verifications (nightly cleanup)
  const { error: purgeErr } = await supabase.from("whatsapp_phone_verifications").delete().lt("expires_at", new Date().toISOString()).eq("used", false);
  if (purgeErr) {
    log("warn", "Failed to purge expired verifications", {
      error: purgeErr.message
    });
  } else {
    log("info", "Purged expired phone verifications");
  }
  log("info", "Claim job complete", {
    profiles_checked: recentProfiles.length,
    stances_claimed: totalClaimed,
    history_backfilled: totalHistoryBackfilled
  });
  return new Response(JSON.stringify({
    profiles_checked: recentProfiles.length,
    claimed: totalClaimed,
    history_backfilled: totalHistoryBackfilled
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
});
