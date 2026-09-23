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
const PURGE_AFTER_HOURS = 24; // > the 1h OTP rate-limit window (AA-05); see purge below
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
  // ── Purge old OTP rows (nightly cleanup) ──────────────────────────────────
  // Epic AA-17: this ran AFTER the early return below, so it was skipped on
  // every night with no newly verified phone, and it only removed UNUSED
  // expired codes, so used ones piled up. It now runs first, and removes rows
  // of any state once they are over a day old. It deliberately does NOT purge
  // by expires_at (10 min): the AA-05 OTP rate limits count rows created in the
  // last hour, and purging sooner would reset those counters.
  const purgeBefore = new Date(Date.now() - PURGE_AFTER_HOURS * 3_600_000).toISOString();
  const { count: purged, error: purgeErr } = await supabase.from("whatsapp_phone_verifications").delete({
    count: "exact"
  }).lt("created_at", purgeBefore);
  if (purgeErr) {
    log("warn", "Failed to purge old phone verifications", {
      error: purgeErr.message
    });
  } else {
    log("info", "Purged old phone verifications", {
      purged: purged ?? 0
    });
  }
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
      // Shared with bootstrap_whatsapp_account() — which now calls this
      // same function immediately at account-creation time, so a
      // brand-new WhatsApp-first account doesn't have to wait for this
      // nightly run to see its own pre-existing anonymous activity.
      // Running it again here for every recently-touched profile is a
      // no-op for anything that immediate call already claimed (both
      // steps only ever touch rows where user_id IS NULL) — this stays as
      // the safety net for the manual verify_whatsapp_phone() path (an
      // already-logged-in user linking a phone from Settings, which
      // doesn't go through bootstrap_whatsapp_account at all) and for
      // anything the immediate call didn't catch.
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
