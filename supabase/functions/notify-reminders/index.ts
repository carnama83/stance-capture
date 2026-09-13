// notify-reminders — self-contained, no external imports
// I3: Remind users to update stance after material news on followed topics
// Cadence: daily at 07:00 UTC
// Trigger: POST from pg_cron with a service_role credential as the bearer.
//
// H-04b (Sep 2026, backported from Prod). The previous gate was:
//     const secret = Deno.env.get("CRON_SECRET");
//     if (!secret) return null;              // <-- FAILS OPEN
// If CRON_SECRET were ever unset or renamed, the endpoint became fully public. It now requires
// a service_role credential and fails CLOSED.
//
// PORTABLE CREDENTIAL CHECK - accepts either shape this codebase uses:
//   Path A - exact match against this project's own SUPABASE_SERVICE_ROLE_KEY (UAT's pg_cron
//            sends Vault's modern sb_secret_ key; UAT has NO JWT-format service key at all -
//            private.get_secret('service_role_key') is NULL here, same as Dev).
//   Path B - a service_role JWT (Prod's pg_cron sends a legacy JWT from private.get_secret).
// Path B is trustworthy ONLY because verify_jwt: true means the platform already verified the
// signature - do NOT set verify_jwt to false, or unsigned claims become forgeable.
//
// H-05 (Sep 2026): question_stances.user_id is NULLABLE - anonymous stances are a supported
// feature. A null in an in.() list is rejected by PostgREST with 22P02.
//
// Logic:
//   For each question_context_update approved in last 24h:
//     Find users who answered the linked question
//     Skip if user updated stance in last N days (SUPPRESS_DAYS)
//     Skip if quiet hours
//     Dedupe: 1 reminder per user/question per context update event
//     Insert notification of type 'reminder'
// =============================================================================
// Helpers (inlined)
// =============================================================================
function log(func, level, msg, extra = {}, traceId) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    func,
    traceId,
    msg,
    ...extra
  }));
}
function makeAdminClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SERVICE_ROLE_KEY");
  const base = url.replace(/\/+$/, "");
  const headers = ()=>({
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`
    });
  return {
    url: base,
    key,
    _headers: headers,
    async from (table, query = "") {
      const res = await fetch(`${base}/rest/v1/${table}${query ? `?${query}` : ""}`, {
        headers: headers()
      });
      if (!res.ok) throw new Error(`GET ${table} ${res.status}: ${await res.text()}`);
      return res.json();
    },
    async insert (table, rows) {
      if (!rows.length) return;
      const res = await fetch(`${base}/rest/v1/${table}`, {
        method: "POST",
        headers: {
          ...headers(),
          Prefer: "resolution=ignore-duplicates"
        },
        body: JSON.stringify(rows)
      });
      if (!res.ok) throw new Error(`INSERT ${table} ${res.status}: ${await res.text()}`);
    }
  };
}
// H-04b: caller must present a service_role credential for THIS project. Fails closed.
function authCheck(req) {
  const deny = ()=>new Response("Unauthorized", {
      status: 401
    });
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!m) return deny();
  const token = m[1];
  const envKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (envKey && token === envKey) return null;
  try {
    const seg = token.split(".")[1];
    if (!seg) return deny();
    const norm = seg.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(norm + "=".repeat((4 - norm.length % 4) % 4)));
    if (claims?.role !== "service_role") return deny();
    const expectedRef = (Deno.env.get("SUPABASE_URL") ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
    if (expectedRef && claims?.ref && claims.ref !== expectedRef) return deny();
    return null;
  } catch  {
    return deny();
  }
}
async function tryLogEvent(db, eventType, eventKey, payload) {
  try {
    const res = await fetch(`${db.url}/rest/v1/notification_event_log`, {
      method: "POST",
      headers: {
        ...db._headers(),
        Prefer: "resolution=ignore-duplicates,return=representation"
      },
      body: JSON.stringify([
        {
          event_type: eventType,
          event_key: eventKey,
          payload
        }
      ])
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 409 || text === "[]" || text === "") return false;
      throw new Error(`event_log ${res.status}: ${text}`);
    }
    const data = await res.json();
    return Array.isArray(data) ? data.length > 0 : true;
  } catch (e) {
    console.error("tryLogEvent error", e);
    return false;
  }
}
async function insertNotification(db, row) {
  await db.insert("user_notifications", [
    {
      user_id: row.user_id,
      notification_type: row.notification_type,
      title: row.title,
      body: row.body ?? null,
      href: row.href ?? null,
      question_id: row.question_id ?? null,
      metadata: row.metadata ?? {}
    }
  ]);
}
function localHour(timezone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false
    }).formatToParts(new Date());
    return parseInt(parts.find((p)=>p.type === "hour")?.value ?? "0") % 24;
  } catch  {
    return new Date().getUTCHours();
  }
}
function isQuietHours(hour, start, end) {
  if (start == null || end == null) return false;
  if (start <= end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}
// =============================================================================
// Job logic
// =============================================================================
const FUNC = "notify-reminders";
// Suppress reminder if user updated their stance within this many days
const SUPPRESS_DAYS = parseInt(Deno.env.get("REMINDER_SUPPRESS_DAYS") ?? "7");
Deno.serve(async (req)=>{
  const traceId = crypto.randomUUID();
  const authErr = authCheck(req);
  if (authErr) return authErr;
  log(FUNC, "info", "start", {
    SUPPRESS_DAYS
  }, traceId);
  try {
    const db = makeAdminClient();
    // 1. Find material context updates in last 24h
    // 'update', 'resolution', 'follow_up' phases = material news
    const cutoff24h = new Date(Date.now() - 24 * 3600_000).toISOString();
    const contextUpdates = await db.from("question_context_updates", `select=id,question_id,new_phase,new_context,updated_at&updated_at=gte.${cutoff24h}&new_phase=in.(update,resolution,follow_up)&order=updated_at.desc`);
    if (!contextUpdates.length) {
      log(FUNC, "info", "no_material_updates", {}, traceId);
      return Response.json({
        ok: true,
        notified: 0,
        skipped: 0
      });
    }
    const affectedQuestionIds = [
      ...new Set(contextUpdates.map((c)=>c.question_id))
    ];
    // 2. Find users who answered any of these questions.
    // H-05: exclude anonymous stances - user_id is nullable and a null would land in the
    // in.() lists below, which PostgREST rejects with 22P02.
    const suppressCutoff = new Date(Date.now() - SUPPRESS_DAYS * 86400_000).toISOString();
    let stances = [];
    for(let i = 0; i < affectedQuestionIds.length; i += 100){
      const chunk = affectedQuestionIds.slice(i, i + 100);
      const rows = await db.from("question_stances", `select=user_id,question_id,updated_at&question_id=in.(${chunk.join(",")})&user_id=not.is.null`);
      stances = stances.concat(rows);
    }
    if (!stances.length) {
      return Response.json({
        ok: true,
        notified: 0,
        skipped: 0
      });
    }
    // 3. Load preferences
    const userIds = [
      ...new Set(stances.map((s)=>s.user_id))
    ].filter(Boolean);
    let prefs = [];
    for(let i = 0; i < userIds.length; i += 200){
      const chunk = userIds.slice(i, i + 200);
      const rows = await db.from("notification_preferences", `select=user_id,reminder_enabled,inapp_enabled,quiet_hours_start,quiet_hours_end,timezone&user_id=in.(${chunk.join(",")})`);
      prefs = prefs.concat(rows);
    }
    const prefByUser = Object.fromEntries(prefs.map((p)=>[
        p.user_id,
        p
      ]));
    // 4. Load question text
    let questionRows = [];
    for(let i = 0; i < affectedQuestionIds.length; i += 100){
      const chunk = affectedQuestionIds.slice(i, i + 100);
      const rows = await db.from("questions", `select=id,question&id=in.(${chunk.join(",")})`);
      questionRows = questionRows.concat(rows);
    }
    const questionText = Object.fromEntries(questionRows.map((q)=>[
        q.id,
        q.question
      ]));
    // Index context updates by question
    const updatesByQ = new Map();
    for (const cu of contextUpdates)updatesByQ.set(cu.question_id, cu);
    // Index recent stance updates per user/question
    const recentByUserQ = new Map(); // key: userId:questionId → updated_at
    for (const s of stances){
      recentByUserQ.set(`${s.user_id}:${s.question_id}`, s.updated_at);
    }
    let notified = 0;
    let skipped = 0;
    for (const stance of stances){
      if (!stance.user_id) {
        skipped++;
        continue;
      } // H-05 belt-and-braces
      const pref = prefByUser[stance.user_id];
      // Respect reminder_enabled (default true for users with no row)
      if (pref && (!pref.reminder_enabled || !pref.inapp_enabled)) {
        skipped++;
        continue;
      }
      // Quiet hours
      if (pref) {
        const hour = localHour(pref.timezone);
        if (isQuietHours(hour, pref.quiet_hours_start, pref.quiet_hours_end)) {
          skipped++;
          continue;
        }
      }
      // Suppress if user updated stance recently
      const lastUpdated = recentByUserQ.get(`${stance.user_id}:${stance.question_id}`);
      if (lastUpdated && new Date(lastUpdated) > new Date(suppressCutoff)) {
        skipped++;
        continue;
      }
      const contextUpdate = updatesByQ.get(stance.question_id);
      if (!contextUpdate) {
        skipped++;
        continue;
      }
      // Dedupe: one reminder per user/question/context_update_id
      const eventKey = `reminder:${stance.user_id}:${stance.question_id}:${contextUpdate.id}`;
      const isNew = await tryLogEvent(db, "reminder", eventKey, {
        question_id: stance.question_id,
        context_update_id: contextUpdate.id,
        phase: contextUpdate.new_phase
      });
      if (!isNew) {
        skipped++;
        continue;
      }
      const qText = questionText[stance.question_id] ?? "";
      const title = qText ? `New developments on: ${qText.slice(0, 60)}${qText.length > 60 ? "…" : ""}` : "A question you answered has new developments.";
      await insertNotification(db, {
        user_id: stance.user_id,
        notification_type: "reminder",
        title,
        body: "Want to revisit your stance?",
        href: `/q/${stance.question_id}`,
        question_id: stance.question_id,
        metadata: {
          eventKind: "material_news",
          contextUpdateId: contextUpdate.id,
          phase: contextUpdate.new_phase
        }
      });
      notified++;
    }
    log(FUNC, "info", "done", {
      notified,
      skipped
    }, traceId);
    return Response.json({
      ok: true,
      notified,
      skipped
    });
  } catch (err) {
    log(FUNC, "error", "fatal", {
      error: err.message
    }, traceId);
    return Response.json({
      ok: false,
      error: err.message
    }, {
      status: 500
    });
  }
});
