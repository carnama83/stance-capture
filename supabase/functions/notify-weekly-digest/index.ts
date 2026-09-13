// notify-weekly-digest — self-contained, no external imports
// Cadence: daily at 08:00 UTC (generates only for users in their local window)
// Trigger: POST from pg_cron with a service_role credential as the bearer.
//
// H-04b (Sep 2026, backported from Prod). The previous gate was:
//     const secret = Deno.env.get("CRON_SECRET");
//     if (!secret) return null;              // <-- FAILS OPEN
// It now requires a service_role credential and fails CLOSED.
// PORTABLE CHECK: Path A exact-matches this project's own SUPABASE_SERVICE_ROLE_KEY (UAT's
// pg_cron sends Vault's modern sb_secret_ key and UAT has NO JWT-format service key at all);
// Path B accepts a service_role JWT (Prod's shape), trustworthy ONLY because verify_jwt:true
// means the platform verified the signature - do NOT set verify_jwt to false.
//
// Epic I QA pass (Sep 2026) fixed four defects in this file:
//
// I-03 (P1) — digest_frequency was NEVER read. The eligibility query filtered on
//   weekly_digest_enabled only, so a user who set frequency to 'off' in SettingsNotifications
//   still received digests; the preference was silently inert. Now 'off' is excluded at the
//   query, and 'daily' actually means daily (previously the weekday gate forced weekly
//   behaviour on every user regardless of their setting).
//
// I-07 (P2) — an empty digest burned the whole week. tryLogEvent() ran BEFORE the content was
//   built, so a user whose digest had no content was skipped for delivery but still had the
//   dedup key written, locking them out for the rest of the week. Dedup now rests on the
//   weekly_digests UNIQUE (user_id, week_start, week_end) + ignore-duplicates, which is only
//   reached once the digest is known to have content. The event log is written afterwards as
//   an observability record, not as the gate.
//
// I-08 (P2) — quiet hours were not honoured here (only notify-reminders and
//   notify-new-local-topics checked them). inapp_enabled was not honoured either.
//
// I-09/I-10 — per-user isolation: one failed insert no longer aborts the run, and a failed
//   delivery no longer leaves a dedup key behind.
// =============================================================================
// Helpers
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
/** Observability record only — NOT the dedup gate (see I-07). Best-effort. */
async function logEvent(db, eventType, eventKey, payload) {
  try {
    await fetch(`${db.url}/rest/v1/notification_event_log`, {
      method: "POST",
      headers: {
        ...db._headers(),
        Prefer: "resolution=ignore-duplicates"
      },
      body: JSON.stringify([
        {
          event_type: eventType,
          event_key: eventKey,
          payload
        }
      ])
    });
  } catch (e) {
    console.error("logEvent error", e);
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
      topic_id: row.topic_id ?? null,
      question_id: row.question_id ?? null,
      digest_id: row.digest_id ?? null,
      metadata: row.metadata ?? {}
    }
  ]);
}
function weekStart(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - (day - 1));
  return date.toISOString().slice(0, 10);
}
function weekEnd(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + (7 - day));
  return date.toISOString().slice(0, 10);
}
// I-08: same quiet-hours helpers notify-reminders uses, so behaviour is identical across jobs.
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
const FUNC = "notify-weekly-digest";
const WINDOW_MINUTES = parseInt(Deno.env.get("DIGEST_WINDOW_MINUTES") ?? "30");
const MAX_SECTION_ITEMS = 3;
function localDayAndHour(timezone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "numeric",
      hour12: false
    }).formatToParts(new Date());
    const weekdayMap = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6
    };
    const weekday = parts.find((p)=>p.type === "weekday")?.value ?? "Mon";
    const hourStr = parts.find((p)=>p.type === "hour")?.value ?? "9";
    return {
      day: weekdayMap[weekday] ?? 1,
      hour: parseInt(hourStr) % 24
    };
  } catch  {
    const now = new Date();
    return {
      day: now.getUTCDay(),
      hour: now.getUTCHours()
    };
  }
}
// I-03: 'daily' ignores the weekday gate; 'weekly' still requires the chosen weekday.
// 'off' never reaches here — it is excluded by the eligibility query.
function isInDigestWindow(pref) {
  const { day, hour } = localDayAndHour(pref.timezone);
  if ((pref.digest_frequency ?? "weekly") !== "daily" && day !== pref.digest_day_of_week) return false;
  const nowMinutes = hour * 60 + new Date().getMinutes();
  const targetMinutes = pref.digest_hour_local * 60;
  return Math.abs(nowMinutes - targetMinutes) <= WINDOW_MINUTES;
}
Deno.serve(async (req)=>{
  const traceId = crypto.randomUUID();
  const authErr = authCheck(req);
  if (authErr) return authErr;
  log(FUNC, "info", "start", {
    WINDOW_MINUTES
  }, traceId);
  try {
    const db = makeAdminClient();
    const wStart = weekStart();
    const wEnd = weekEnd();
    // 1. Users with digests enabled AND a frequency that is not 'off' (I-03).
    const prefs = await db.from("notification_preferences", "select=user_id,weekly_digest_enabled,digest_frequency,digest_day_of_week,digest_hour_local,timezone,inapp_enabled,quiet_hours_start,quiet_hours_end&weekly_digest_enabled=eq.true&digest_frequency=neq.off");
    const eligible = prefs.filter((p)=>{
      if (p.inapp_enabled === false) return false; // I-08
      if (isQuietHours(localHour(p.timezone), p.quiet_hours_start, p.quiet_hours_end)) return false; // I-08
      return isInDigestWindow(p);
    });
    log(FUNC, "info", "eligible", {
      total: prefs.length,
      eligible: eligible.length
    }, traceId);
    if (!eligible.length) {
      return Response.json({
        ok: true,
        generated: 0,
        skipped: 0
      });
    }
    const eligibleIds = eligible.map((p)=>p.user_id).filter(Boolean);
    if (!eligibleIds.length) {
      return Response.json({
        ok: true,
        generated: 0,
        skipped: 0
      });
    }
    // 2. Pre-fetch shared data
    const follows = await db.from("user_topic_follows", `select=user_id,topic_id&user_id=in.(${eligibleIds.join(",")})`);
    const surgingTopics = await db.from("topic_region_trends", "select=topic_id,delta_24h_per_hour&delta_24h_per_hour=gte.0.3&order=delta_24h_per_hour.desc&limit=100");
    const surgingIds = new Set(surgingTopics.map((t)=>t.topic_id));
    const allTopicIds = [
      ...new Set(follows.map((f)=>f.topic_id))
    ].filter(Boolean);
    let topicRows = [];
    if (allTopicIds.length) {
      topicRows = await db.from("topics", `select=id,title&id=in.(${allTopicIds.join(",")})`);
    }
    const topicTitles = Object.fromEntries(topicRows.map((t)=>[
        t.id,
        t.title
      ]));
    const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString();
    const stances = await db.from("question_stances", `select=user_id,question_id,score&user_id=in.(${eligibleIds.join(",")})&updated_at=gte.${cutoff}`);
    const answeredIds = [
      ...new Set(stances.map((s)=>s.question_id))
    ].filter(Boolean);
    let stats = [];
    let questionRows = [];
    for(let i = 0; i < answeredIds.length; i += 100){
      const chunk = answeredIds.slice(i, i + 100);
      const s = await db.from("question_stance_stats", `select=question_id,avg_score,total_responses&question_id=in.(${chunk.join(",")})`);
      const q = await db.from("questions", `select=id,question&id=in.(${chunk.join(",")})`);
      stats = stats.concat(s);
      questionRows = questionRows.concat(q);
    }
    const statsByQ = Object.fromEntries(stats.map((s)=>[
        s.question_id,
        s
      ]));
    const questionText = Object.fromEntries(questionRows.map((q)=>[
        q.id,
        q.question
      ]));
    let generated = 0;
    let skipped = 0;
    let failed = 0;
    for (const pref of eligible){
      // Build followed_topic_updates
      const followedTopicUpdates = follows.filter((f)=>f.user_id === pref.user_id && surgingIds.has(f.topic_id)).slice(0, MAX_SECTION_ITEMS).map((f)=>({
          topic_id: f.topic_id,
          topic_title: topicTitles[f.topic_id] ?? "A topic you follow",
          summary: "This topic is gaining momentum this week.",
          href: `/topics/${f.topic_id}`
        }));
      // Build answered_question_shifts
      const answeredQuestionShifts = stances.filter((s)=>{
        if (s.user_id !== pref.user_id) return false;
        const stat = statsByQ[s.question_id];
        return stat?.avg_score != null && Math.abs(stat.avg_score - s.score) >= 0.75;
      }).slice(0, MAX_SECTION_ITEMS).map((s)=>{
        const title = questionText[s.question_id] ?? "A question you answered";
        return {
          question_id: s.question_id,
          question_title: title.slice(0, 80) + (title.length > 80 ? "…" : ""),
          summary: "Community sentiment moved away from your stance.",
          href: `/q/${s.question_id}`
        };
      });
      // I-07: skip empty digests BEFORE anything is persisted, so the user stays eligible
      // later in the week once content appears.
      if (!followedTopicUpdates.length && !answeredQuestionShifts.length) {
        skipped++;
        continue;
      }
      const summary = {
        followed_topic_updates: followedTopicUpdates,
        answered_question_shifts: answeredQuestionShifts,
        recommended_questions: [],
        alignment_note: null
      };
      // I-07: weekly_digests UNIQUE (user_id, week_start, week_end) + ignore-duplicates IS the
      // dedup gate. An empty representation array means a digest already exists for this week.
      let digestRows;
      try {
        // I-07: on_conflict names the unique constraint - resolution=ignore-duplicates
        // otherwise only guards the PRIMARY KEY, which is a fresh uuid on every insert.
        const digestRes = await fetch(`${db.url}/rest/v1/weekly_digests?on_conflict=user_id,week_start,week_end`, {
          method: "POST",
          headers: {
            ...db._headers(),
            Prefer: "resolution=ignore-duplicates,return=representation"
          },
          body: JSON.stringify([
            {
              user_id: pref.user_id,
              week_start: wStart,
              week_end: wEnd,
              summary,
              delivered_in_app_at: new Date().toISOString()
            }
          ])
        });
        if (digestRes.status === 409) {
          // Already delivered this week - idempotent skip, not a failure.
          skipped++;
          continue;
        }
        if (!digestRes.ok) {
          log(FUNC, "warn", "digest_insert_failed", {
            user_id: pref.user_id,
            status: digestRes.status,
            body: (await digestRes.text()).slice(0, 300)
          }, traceId);
          failed++;
          continue;
        }
        digestRows = await digestRes.json();
      } catch (e) {
        log(FUNC, "warn", "digest_insert_threw", {
          user_id: pref.user_id,
          error: String(e?.message ?? e)
        }, traceId);
        failed++;
        continue;
      }
      if (!Array.isArray(digestRows) || digestRows.length === 0) {
        // Already delivered this week.
        skipped++;
        continue;
      }
      const digestId = digestRows[0]?.id ?? null;
      const nT = followedTopicUpdates.length;
      const nQ = answeredQuestionShifts.length;
      const parts = [];
      if (nT) parts.push(`${nT} followed topic${nT > 1 ? "s" : ""} moved`);
      if (nQ) parts.push(`${nQ} answered question${nQ > 1 ? "s" : ""} shifted`);
      // I-09/I-10: per-user isolation — a bad row must not abort the whole run.
      try {
        await insertNotification(db, {
          user_id: pref.user_id,
          notification_type: "weekly_digest",
          title: "Your weekly Stance Capture digest is ready.",
          body: `This week: ${parts.join(", ")}.`,
          digest_id: digestId,
          metadata: {
            digestId,
            weekStart: wStart,
            weekEnd: wEnd
          }
        });
      } catch (e) {
        log(FUNC, "warn", "notification_insert_failed", {
          user_id: pref.user_id,
          error: String(e?.message ?? e)
        }, traceId);
        failed++;
        continue;
      }
      await logEvent(db, "weekly_digest", `weekly_digest:${pref.user_id}:${wStart}`, {
        user_id: pref.user_id,
        week_start: wStart,
        digest_id: digestId
      });
      generated++;
    }
    log(FUNC, "info", "done", {
      generated,
      skipped,
      failed
    }, traceId);
    return Response.json({
      ok: true,
      generated,
      skipped,
      failed
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
