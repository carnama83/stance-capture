// notify-stance-changes/index.ts  — SELF-CONTAINED (helpers inlined)
// Job 2 — generate_stance_change_notifications
// Cadence: daily
// Trigger: POST with Authorization: Bearer <CRON_SECRET>
// Passes:
//   1. Global community shift  (Epic Q Phase 5)
//   2. Regional shift          (Epic Q Phase 5)
//   3. Region divergence       (Epic S2) — city vs national avg
// ── Inlined helpers ──────────────────────────────────────────────────────────
// Shared helpers for Epic I notification jobs.
// Used by: notify-topic-follows, notify-stance-changes, notify-weekly-digest
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
// ---------------------------------------------------------------------------
// Supabase admin client (service role — bypasses RLS)
// ---------------------------------------------------------------------------
function makeAdminClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SERVICE_ROLE_KEY");
  // Thin PostgREST wrapper — avoids importing the full Supabase JS SDK in Deno
  return {
    url: url.replace(/\/+$/, ""),
    key,
    async rpc (fn, params = {}) {
      const res = await fetch(`${this.url}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify(params)
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`rpc ${fn} failed ${res.status}: ${text}`);
      }
      const data = await res.json();
      return Array.isArray(data) ? data : [
        data
      ];
    },
    async from (table, query = "") {
      const res = await fetch(`${this.url}/rest/v1/${table}${query ? `?${query}` : ""}`, {
        headers: this._headers()
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`GET ${table} failed ${res.status}: ${text}`);
      }
      return res.json();
    },
    async insert (table, rows) {
      if (rows.length === 0) return;
      const res = await fetch(`${this.url}/rest/v1/${table}`, {
        method: "POST",
        headers: {
          ...this._headers(),
          Prefer: "resolution=ignore-duplicates"
        },
        body: JSON.stringify(rows)
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`INSERT ${table} failed ${res.status}: ${text}`);
      }
    },
    _headers () {
      return {
        "Content-Type": "application/json",
        apikey: this.key,
        Authorization: `Bearer ${this.key}`
      };
    }
  };
}
// ---------------------------------------------------------------------------
// CRON_SECRET auth check
// ---------------------------------------------------------------------------
function authCheck(req) {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) return null; // no secret configured → open (dev only)
  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", {
      status: 401
    });
  }
  return null;
}
// ---------------------------------------------------------------------------
// Dedupe: insert into notification_event_log
// Returns true  → event is new, caller should create the notification
// Returns false → duplicate, skip
// ---------------------------------------------------------------------------
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
      // 409 or empty body with ignore-duplicates = already exists
      if (res.status === 409 || text === "[]" || text === "") return false;
      throw new Error(`event_log insert ${res.status}: ${text}`);
    }
    const data = await res.json();
    // ignore-duplicates returns [] when row already existed
    return Array.isArray(data) ? data.length > 0 : true;
  } catch (e) {
    // On error, be conservative — skip to avoid spam
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
// ---------------------------------------------------------------------------
// ISO week helpers (for dedupe keys)
// ---------------------------------------------------------------------------
/** Returns "YYYY-Www" — e.g. "2026-W13" */ function isoWeek(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // ISO week: Monday = day 1
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
/** Returns Monday of the current ISO week as "YYYY-MM-DD" */ function weekStart(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - (day - 1));
  return date.toISOString().slice(0, 10);
}
/** Returns Sunday of the current ISO week as "YYYY-MM-DD" */ function weekEnd(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + (7 - day));
  return date.toISOString().slice(0, 10);
}
// ── Function body ────────────────────────────────────────────────────────────
const FUNC = "notify-stance-changes";
// Minimum absolute shift in avg_score (range: -2 to +2) to trigger notification.
// 0.75 = meaningful community movement on a -2/+2 scale.
const DELTA_THRESHOLD = parseFloat(Deno.env.get("STANCE_DELTA_THRESHOLD") ?? "0.75");
// Max questions to notify per user per run (guards against overwhelming a user
// who answered many questions that all shifted at once)
const MAX_PER_USER = parseInt(Deno.env.get("STANCE_MAX_PER_USER") ?? "3");
Deno.serve(async (req)=>{
  const traceId = crypto.randomUUID();
  const authErr = authCheck(req);
  if (authErr) return authErr;
  log(FUNC, "info", "start", {
    deltaThreshold: DELTA_THRESHOLD
  }, traceId);
  try {
    const db = makeAdminClient();
    const week = isoWeek();
    // 1. Load all users who have opted into stance_change notifications
    //    (users with no prefs row = default true, handled below)
    const prefs = await db.from("notification_preferences", "select=user_id,stance_change_enabled&stance_change_enabled=eq.true");
    const enabledUserIds = new Set(prefs.map((p)=>p.user_id));
    // 2. Load all current global stance stats
    const stats = await db.from("question_stance_stats", "select=question_id,avg_score,total_responses&total_responses=gte.5");
    const statsByQuestion = Object.fromEntries(stats.map((s)=>[
        s.question_id,
        s
      ]));
    // 3. Load recent user stances (last 90 days to keep set manageable)
    const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString();
    const stances = await db.from("question_stances", `select=user_id,question_id,score,updated_at&updated_at=gte.${cutoff}&order=user_id.asc`);
    // 4. Group stances by user
    const byUser = new Map();
    for (const s of stances){
      if (!byUser.has(s.user_id)) byUser.set(s.user_id, []);
      byUser.get(s.user_id).push(s);
    }
    // 5. Pre-fetch question text for questions that appear in stances
    const questionIds = [
      ...new Set(stances.map((s)=>s.question_id))
    ];
    let questions = [];
    if (questionIds.length > 0) {
      // Fetch in chunks of 100 to stay within URL length limits
      for(let i = 0; i < questionIds.length; i += 100){
        const chunk = questionIds.slice(i, i + 100);
        const rows = await db.from("questions", `select=id,question&id=in.(${chunk.join(",")})`);
        questions = questions.concat(rows);
      }
    }
    const questionText = Object.fromEntries(questions.map((q)=>[
        q.id,
        q.question
      ]));
    // Phase 5: Load regional stance stats for the same question set
    let regionalStats = [];
    if (questionIds.length > 0) {
      for(let i = 0; i < questionIds.length; i += 100){
        const chunk = questionIds.slice(i, i + 100);
        const rows = await db.from("question_stance_stats_region", `select=question_id,region_scope,region_key,region_label,avg_score,total_responses&question_id=in.(${chunk.join(",")})&total_responses=gte.5`);
        regionalStats = regionalStats.concat(rows);
      }
    }
    // Index: question_id → array of regional rows
    const regionalByQuestion = new Map();
    for (const r of regionalStats){
      if (!regionalByQuestion.has(r.question_id)) regionalByQuestion.set(r.question_id, []);
      regionalByQuestion.get(r.question_id).push(r);
    }
    // Phase 5: Load user region dimensions for all users in byUser
    const allUserIds = [
      ...byUser.keys()
    ];
    let userRegions = [];
    if (allUserIds.length > 0) {
      for(let i = 0; i < allUserIds.length; i += 100){
        const chunk = allUserIds.slice(i, i + 100);
        const rows = await db.from("user_region_dimensions", `select=user_id,city_label,county_label,state_label,country_label&user_id=in.(${chunk.join(",")})`);
        userRegions = userRegions.concat(rows);
      }
    }
    const userRegionMap = Object.fromEntries(userRegions.map((r)=>[
        r.user_id,
        r
      ]));
    let notified = 0;
    let skipped = 0;
    for (const [userId, userStances] of byUser){
      // Skip users who have explicitly disabled stance_change notifications
      // Users with no prefs row default to enabled
      if (prefs.length > 0 && !enabledUserIds.has(userId)) {
        skipped += userStances.length;
        continue;
      }
      let userNotifyCount = 0;
      for (const stance of userStances){
        if (userNotifyCount >= MAX_PER_USER) break;
        const stat = statsByQuestion[stance.question_id];
        if (!stat || stat.avg_score == null) continue;
        // Calculate shift: community avg vs user's own stance at answer time
        const delta = Math.abs(stat.avg_score - stance.score);
        if (delta < DELTA_THRESHOLD) {
          skipped++;
          continue;
        }
        const eventKey = `stance_change:${userId}:${stance.question_id}:community_shift:${week}`;
        const isNew = await tryLogEvent(db, "stance_change", eventKey, {
          question_id: stance.question_id,
          user_score: stance.score,
          current_avg: stat.avg_score,
          delta,
          week
        });
        if (!isNew) {
          skipped++;
          continue;
        }
        const title = questionText[stance.question_id] ? `Community sentiment shifted on: ${questionText[stance.question_id].slice(0, 60)}${questionText[stance.question_id].length > 60 ? "…" : ""}` : "Community sentiment shifted on a question you answered.";
        await insertNotification(db, {
          user_id: userId,
          notification_type: "stance_change",
          title,
          body: null,
          href: `/q/${stance.question_id}`,
          question_id: stance.question_id,
          metadata: {
            eventKind: "community_shift",
            baselineScore: stance.score,
            currentAvgScore: stat.avg_score,
            delta,
            regionScope: "global",
            regionKey: "Global"
          }
        });
        notified++;
        userNotifyCount++;
      }
      // Phase 5: Regional shift pass — check user's city/state for shifts
      // Only runs if user has region data and hasn't hit MAX_PER_USER yet
      const userRegion = userRegionMap[userId];
      if (userRegion && userNotifyCount < MAX_PER_USER) {
        // Pick best available region tier: city > county > state > country
        const regionLabel = userRegion.city_label ?? userRegion.county_label ?? userRegion.state_label ?? userRegion.country_label;
        if (regionLabel) {
          for (const stance of userStances){
            if (userNotifyCount >= MAX_PER_USER) break;
            const regionalRows = regionalByQuestion.get(stance.question_id) ?? [];
            // Find the row matching the user's best region label
            const regionalStat = regionalRows.find((r)=>r.region_label === regionLabel);
            if (!regionalStat || regionalStat.avg_score == null) continue;
            const regionalDelta = Math.abs(regionalStat.avg_score - stance.score);
            if (regionalDelta < DELTA_THRESHOLD) continue;
            const eventKey = `stance_change:${userId}:${stance.question_id}:regional_shift:${week}`;
            const isNew = await tryLogEvent(db, "stance_change", eventKey, {
              question_id: stance.question_id,
              user_score: stance.score,
              current_avg: regionalStat.avg_score,
              delta: regionalDelta,
              region: regionLabel,
              week
            });
            if (!isNew) {
              skipped++;
              continue;
            }
            const qText = questionText[stance.question_id];
            const title = qText ? `Sentiment in ${regionLabel} shifted on: ${qText.slice(0, 55)}${qText.length > 55 ? "…" : ""}` : `Sentiment in ${regionLabel} shifted on a question you answered.`;
            await insertNotification(db, {
              user_id: userId,
              notification_type: "stance_change",
              title,
              body: null,
              href: `/q/${stance.question_id}`,
              question_id: stance.question_id,
              metadata: {
                eventKind: "regional_shift",
                baselineScore: stance.score,
                currentAvgScore: regionalStat.avg_score,
                delta: regionalDelta,
                regionScope: regionalStat.region_scope,
                regionKey: regionLabel
              }
            });
            notified++;
            userNotifyCount++;
          }
        }
      }
      // S2: Region divergence pass — fires when user's city avg diverges
      // meaningfully from the GLOBAL avg on a question they answered.
      // Different from the regional shift pass (which compares user score vs regional avg).
      // This compares REGIONAL avg vs GLOBAL avg — city is outlying from national sentiment.
      const DIVERGENCE_THRESHOLD = parseFloat(Deno.env.get("DIVERGENCE_THRESHOLD") ?? "0.80");
      if (userRegion && userNotifyCount < MAX_PER_USER) {
        const regionLabel = userRegion.city_label ?? userRegion.county_label ?? userRegion.state_label ?? null;
        if (regionLabel) {
          for (const stance of userStances){
            if (userNotifyCount >= MAX_PER_USER) break;
            const globalStat = statsByQuestion[stance.question_id];
            if (!globalStat || globalStat.avg_score == null) continue;
            const regionalRows = regionalByQuestion.get(stance.question_id) ?? [];
            const regionalStat = regionalRows.find((r)=>r.region_label === regionLabel);
            if (!regionalStat || regionalStat.avg_score == null) continue;
            // Divergence: how much does city differ from global?
            const divergence = Math.abs(regionalStat.avg_score - globalStat.avg_score);
            if (divergence < DIVERGENCE_THRESHOLD) continue;
            const eventKey = `stance_change:${userId}:${stance.question_id}:region_divergence:${week}`;
            const isNew = await tryLogEvent(db, "stance_change", eventKey, {
              question_id: stance.question_id,
              regional_avg: regionalStat.avg_score,
              global_avg: globalStat.avg_score,
              divergence,
              region: regionLabel,
              week
            });
            if (!isNew) {
              skipped++;
              continue;
            }
            const qText = questionText[stance.question_id];
            const direction = regionalStat.avg_score > globalStat.avg_score ? "more agreement" : "more disagreement";
            const title = qText ? `${regionLabel} sees this differently from the national trend: ${qText.slice(0, 50)}${qText.length > 50 ? "…" : ""}` : `${regionLabel} diverges from the national trend on a question you answered.`;
            await insertNotification(db, {
              user_id: userId,
              notification_type: "stance_change",
              title,
              body: `Your area leans toward ${direction} compared to the national picture.`,
              href: `/q/${stance.question_id}`,
              question_id: stance.question_id,
              metadata: {
                eventKind: "region_divergence",
                regionalAvg: regionalStat.avg_score,
                globalAvg: globalStat.avg_score,
                divergence,
                regionLabel
              }
            });
            notified++;
            userNotifyCount++;
          }
        }
      }
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
