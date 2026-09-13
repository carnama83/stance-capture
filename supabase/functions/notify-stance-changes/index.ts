// notify-stance-changes/index.ts  — SELF-CONTAINED (helpers inlined)
// Job 2 — generate_stance_change_notifications
// Cadence: daily
// Trigger: POST with Authorization: Bearer <service_role key or service_role JWT>
// Passes:
//   1. Global community shift  (Epic Q Phase 5)
//   2. Regional shift          (Epic Q Phase 5)
//   3. Region divergence       (Epic S2) — city vs national avg
// ── Inlined helpers ──────────────────────────────────────────────────────────
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
      return Array.isArray(data) ? data : [ data ];
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
// H-04b: service_role authorization check (portable across credential shapes).
// Path A — caller presents the exact SUPABASE_SERVICE_ROLE_KEY from the Edge env
//          (covers the modern opaque sb_secret_… key, which has no claims).
// Path B — caller presents a JWT carrying role=service_role. Safe only because
//          this function is deployed with verify_jwt=true, so the platform has
//          already validated the signature before the body runs.
// Replaces the old CRON_SECRET shared-secret check, which failed open when the
// secret was unset and was a static credential in cron.job command text.
// ---------------------------------------------------------------------------
function authCheck(req) {
  const deny = ()=>new Response("Unauthorized", { status: 401 });
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
  } catch {
    return deny();
  }
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
      if (res.status === 409 || text === "[]" || text === "") return false;
      throw new Error(`event_log insert ${res.status}: ${text}`);
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
// ---------------------------------------------------------------------------
// ISO week helpers (for dedupe keys)
// ---------------------------------------------------------------------------
/** Returns "YYYY-Www" — e.g. "2026-W13" */ function isoWeek(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
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
const DELTA_THRESHOLD = parseFloat(Deno.env.get("STANCE_DELTA_THRESHOLD") ?? "0.75");
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
    const prefs = await db.from("notification_preferences", "select=user_id,stance_change_enabled&stance_change_enabled=eq.true");
    const enabledUserIds = new Set(prefs.map((p)=>p.user_id));
    const stats = await db.from("question_stance_stats", "select=question_id,avg_score,total_responses&total_responses=gte.5");
    const statsByQuestion = Object.fromEntries(stats.map((s)=>[ s.question_id, s ]));
    const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString();
    // H-05: question_stances.user_id is NULLABLE — anonymous stances are a product
    // feature. A null reaching an id=in.(…) list renders as an empty element and
    // PostgREST rejects the whole request with 22P02 (invalid input syntax for uuid).
    // Anonymous stances have no one to notify, so exclude them at the source.
    const stances = await db.from("question_stances", `select=user_id,question_id,score,updated_at&updated_at=gte.${cutoff}&user_id=not.is.null&order=user_id.asc`);
    const byUser = new Map();
    for (const s of stances){
      if (!s.user_id) continue; // H-05 belt-and-braces
      if (!byUser.has(s.user_id)) byUser.set(s.user_id, []);
      byUser.get(s.user_id).push(s);
    }
    // H-05: filter(Boolean) so a null question_id can never produce an empty
    // element inside in.(…).
    const questionIds = [
      ...new Set(stances.map((s)=>s.question_id).filter(Boolean))
    ];
    let questions = [];
    if (questionIds.length > 0) {
      for(let i = 0; i < questionIds.length; i += 100){
        const chunk = questionIds.slice(i, i + 100);
        const rows = await db.from("questions", `select=id,question&id=in.(${chunk.join(",")})`);
        questions = questions.concat(rows);
      }
    }
    const questionText = Object.fromEntries(questions.map((q)=>[ q.id, q.question ]));
    let regionalStats = [];
    if (questionIds.length > 0) {
      for(let i = 0; i < questionIds.length; i += 100){
        const chunk = questionIds.slice(i, i + 100);
        const rows = await db.from("question_stance_stats_region", `select=question_id,region_scope,region_key,region_label,avg_score,total_responses&question_id=in.(${chunk.join(",")})&total_responses=gte.5`);
        regionalStats = regionalStats.concat(rows);
      }
    }
    const regionalByQuestion = new Map();
    for (const r of regionalStats){
      if (!regionalByQuestion.has(r.question_id)) regionalByQuestion.set(r.question_id, []);
      regionalByQuestion.get(r.question_id).push(r);
    }
    // H-05: filter(Boolean) — byUser keys are non-null by construction now, but
    // the guard is kept so a future change upstream cannot reintroduce 22P02.
    const allUserIds = [
      ...byUser.keys()
    ].filter(Boolean);
    let userRegions = [];
    if (allUserIds.length > 0) {
      for(let i = 0; i < allUserIds.length; i += 100){
        const chunk = allUserIds.slice(i, i + 100);
        const rows = await db.from("user_region_dimensions", `select=user_id,city_label,county_label,state_label,country_label&user_id=in.(${chunk.join(",")})`);
        userRegions = userRegions.concat(rows);
      }
    }
    const userRegionMap = Object.fromEntries(userRegions.map((r)=>[ r.user_id, r ]));
    let notified = 0;
    let skipped = 0;
    for (const [userId, userStances] of byUser){
      if (prefs.length > 0 && !enabledUserIds.has(userId)) {
        skipped += userStances.length;
        continue;
      }
      let userNotifyCount = 0;
      for (const stance of userStances){
        if (userNotifyCount >= MAX_PER_USER) break;
        const stat = statsByQuestion[stance.question_id];
        if (!stat || stat.avg_score == null) continue;
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
      const userRegion = userRegionMap[userId];
      if (userRegion && userNotifyCount < MAX_PER_USER) {
        const regionLabel = userRegion.city_label ?? userRegion.county_label ?? userRegion.state_label ?? userRegion.country_label;
        if (regionLabel) {
          for (const stance of userStances){
            if (userNotifyCount >= MAX_PER_USER) break;
            const regionalRows = regionalByQuestion.get(stance.question_id) ?? [];
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
      // S2: Region divergence pass — REGIONAL avg vs GLOBAL avg.
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
