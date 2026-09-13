import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const FUNC = "whatsapp-claim-anonymous-stances";
const LOOKBACK_HOURS = 25;
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
      const { data: claimResult, error: claimErr } = await supabase.rpc("claim_whatsapp_stances_for_profile", {
        p_user_id: user_id,
        p_phone_hash: verified_phone_hash
      });
      if (claimErr) {
        log("warn", "Error claiming stances for profile", {
          user_id,
          error: claimErr.message
        });
        continue;
      }
      const result = claimResult?.[0];
      if (result?.history_backfilled) {
        log("info", "Backfilled stance_history rows", {
          user_id,
          history_rows: result.history_backfilled
        });
        totalHistoryBackfilled += result.history_backfilled;
      }
      if (result?.claimed) {
        log("info", "Claimed stances for user", {
          user_id,
          claimed: result.claimed
        });
        totalClaimed += result.claimed;
      }
    } catch (err) {
      log("warn", "Error claiming stances for profile", {
        user_id,
        error: String(err)
      });
    }
  }
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
