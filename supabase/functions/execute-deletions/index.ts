// supabase/functions/execute-deletions/index.ts
// M-N01 — GDPR Deletion Execution Edge Function
//
// Triggered by pg_cron (daily at 03:00 UTC) or manually by admin.
// Auth: CRON_SECRET header required.
//
// Flow:
//   1. Call execute_pending_deletions() RPC — wipes all public data
//      and marks deletion_requests.status='executed'
//   2. For each executed user_id: call Supabase Admin API to delete
//      the auth.users record (pg function cannot reach auth schema)
//
// Returns: { executed: N, errors: N, auth_deleted: N, auth_errors: N }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
function log(level, msg, extra = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    func: "execute-deletions",
    msg,
    ...extra
  }));
}
Deno.serve(async (req)=>{
  // Auth gate
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.includes(CRON_SECRET) || !CRON_SECRET) {
    return new Response(JSON.stringify({
      error: "Unauthorized"
    }), {
      status: 401
    });
  }
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false
    }
  });
  try {
    // ── Step 1: collect user_ids about to be executed ────────
    const { data: pending, error: fetchErr } = await sb.from("deletion_requests").select("user_id").eq("status", "pending").lte("execute_after", new Date().toISOString()).is("cancelled_at", null);
    if (fetchErr) throw fetchErr;
    const pendingUserIds = (pending ?? []).map((r)=>r.user_id);
    log("info", "pending deletions found", {
      count: pendingUserIds.length
    });
    // ── Step 2: run the DB-level data wipe ───────────────────
    const { data: result, error: rpcErr } = await sb.rpc("execute_pending_deletions");
    if (rpcErr) throw rpcErr;
    log("info", "execute_pending_deletions complete", result);
    // ── Step 3: delete auth.users for each executed user ─────
    let authDeleted = 0;
    let authErrors = 0;
    for (const userId of pendingUserIds){
      try {
        const { error: authErr } = await sb.auth.admin.deleteUser(userId);
        if (authErr) {
          log("warn", "auth.deleteUser failed", {
            userId,
            error: authErr.message
          });
          authErrors++;
        } else {
          authDeleted++;
        }
      } catch (e) {
        log("warn", "auth.deleteUser exception", {
          userId,
          error: e.message
        });
        authErrors++;
      }
    }
    log("info", "auth deletions complete", {
      authDeleted,
      authErrors
    });
    return new Response(JSON.stringify({
      ...result,
      auth_deleted: authDeleted,
      auth_errors: authErrors
    }), {
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    log("error", "fatal", {
      error: err.message
    });
    return new Response(JSON.stringify({
      error: err.message
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
});
