// notify-weekly-digest — self-contained, no external imports
// Cadence: daily at 08:00 UTC (generates only for users in their local window)
// Trigger: POST with Authorization: Bearer <CRON_SECRET>
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
function authCheck(req) {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) return null;
  if (req.headers.get("Authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", {
      status: 401
    });
  }
  return null;
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
function isInDigestWindow(pref) {
  const { day, hour } = localDayAndHour(pref.timezone);
  if (day !== pref.digest_day_of_week) return false;
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
    // 1. Users with weekly digest enabled
    const prefs = await db.from("notification_preferences", "select=user_id,weekly_digest_enabled,digest_day_of_week,digest_hour_local,timezone&weekly_digest_enabled=eq.true");
    const eligible = prefs.filter(isInDigestWindow);
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
    const eligibleIds = eligible.map((p)=>p.user_id);
    // 2. Pre-fetch shared data
    const follows = await db.from("user_topic_follows", `select=user_id,topic_id&user_id=in.(${eligibleIds.join(",")})`);
    const surgingTopics = await db.from("topic_region_trends", "select=topic_id,delta_24h_per_hour&delta_24h_per_hour=gte.0.3&order=delta_24h_per_hour.desc&limit=100");
    const surgingIds = new Set(surgingTopics.map((t)=>t.topic_id));
    const allTopicIds = [
      ...new Set(follows.map((f)=>f.topic_id))
    ];
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
    ];
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
    for (const pref of eligible){
      const isNew = await tryLogEvent(db, "weekly_digest", `weekly_digest:${pref.user_id}:${wStart}`, {
        user_id: pref.user_id,
        week_start: wStart
      });
      if (!isNew) {
        skipped++;
        continue;
      }
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
      // Skip empty digests
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
      // Insert weekly_digests row
      const digestRes = await fetch(`${db.url}/rest/v1/weekly_digests`, {
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
      if (!digestRes.ok) {
        log(FUNC, "warn", "digest_insert_failed", {
          user_id: pref.user_id,
          status: digestRes.status
        }, traceId);
        continue;
      }
      const digestRows = await digestRes.json();
      const digestId = digestRows[0]?.id ?? null;
      const nT = followedTopicUpdates.length;
      const nQ = answeredQuestionShifts.length;
      const parts = [];
      if (nT) parts.push(`${nT} followed topic${nT > 1 ? "s" : ""} moved`);
      if (nQ) parts.push(`${nQ} answered question${nQ > 1 ? "s" : ""} shifted`);
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
      generated++;
    }
    log(FUNC, "info", "done", {
      generated,
      skipped
    }, traceId);
    return Response.json({
      ok: true,
      generated,
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
