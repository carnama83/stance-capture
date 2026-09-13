// notify-topic-follows/index.ts  — SELF-CONTAINED (helpers inlined)
// Job 1 — generate_topic_follow_notifications
// Cadence: every 4 hours
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
// H-05 (Sep 2026): question_stances.user_id is NULLABLE - anonymous stances are a supported
// feature. A null in an in.() list is rejected by PostgREST with 22P02.
//
// H-06 (Sep 2026): both answered-user lookups passed a SQL SUBQUERY into a PostgREST filter -
//   question_id=in.(select id from questions where topic_id=eq.<uuid>)
// PostgREST has no subquery support; it parses that text as a literal uuid and returns
// 400 22P02 (confirmed live). Replaced with an explicit two-step lookup: resolve the topic's
// question ids, then filter on those literals.
//
// Passes:
//   1. Followed topics surge    (Epic Q Phase 5)
//   2. Answered-not-followed    (Epic Q Phase 5)
//   3. Topic re-ignition        (Epic S2) — was dormant, now surging
//
// M-I05: notification_topic_prefs checked before every send.
//   Muted rows are bulk-fetched per pass and stored in a Set<"userId:topicId">
//   to avoid per-user per-topic round-trips inside hot loops.
// ── Inlined helpers ─────────────────────────────────────────────────
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
// H-04b: caller must present a service_role credential for THIS project. Fails closed.
// ---------------------------------------------------------------------------
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
/** H-06: PostgREST cannot take a subquery in a filter - resolve the ids first. */ async function questionIdsForTopic(db, topicId) {
  const rows = await db.from("questions", `select=id&topic_id=eq.${topicId}`);
  return rows.map((q)=>q.id).filter(Boolean);
}
/** H-05/H-06: distinct, non-null user ids who answered any of these questions since `since`. */ async function answeredUserIds(db, questionIds, since) {
  if (questionIds.length === 0) return [];
  let out = [];
  for(let i = 0; i < questionIds.length; i += 100){
    const chunk = questionIds.slice(i, i + 100);
    const rows = await db.from("question_stances", [
      `select=user_id`,
      `question_id=in.(${chunk.join(",")})`,
      `user_id=not.is.null`,
      `created_at=gte.${since}`,
      `limit=200`
    ].join("&"));
    out = out.concat(rows.map((r)=>r.user_id));
  }
  return [
    ...new Set(out)
  ].filter(Boolean);
}
// ---------------------------------------------------------------------------
// M-I05: Bulk-fetch muted topic prefs for a set of (user_id, topic_id) pairs.
// Returns a Set of "userId:topicId" strings for O(1) mute-check in hot loops.
// Chunked in batches of 100 user IDs to stay within PostgREST URL limits.
// ---------------------------------------------------------------------------
async function buildMutedSet(db, userIds, topicIds) {
  const muted = new Set();
  if (userIds.length === 0 || topicIds.length === 0) return muted;
  const topicFilter = `topic_id=in.(${topicIds.join(",")})`;
  for(let i = 0; i < userIds.length; i += 100){
    const chunk = userIds.slice(i, i + 100);
    const rows = await db.from("notification_topic_prefs", `select=user_id,topic_id&muted=eq.true&user_id=in.(${chunk.join(",")})&${topicFilter}`);
    for (const r of rows){
      muted.add(`${r.user_id}:${r.topic_id}`);
    }
  }
  return muted;
}
/** Returns true if the user has muted this specific topic. */ function isMutedForTopic(mutedSet, userId, topicId) {
  return mutedSet.has(`${userId}:${topicId}`);
}
// ── Function body ─────────────────────────────────────────────────
const FUNC = "notify-topic-follows";
const SURGE_THRESHOLD = parseFloat(Deno.env.get("TOPIC_SURGE_THRESHOLD") ?? "0.5");
const MIN_TOTAL = parseInt(Deno.env.get("TOPIC_MIN_TOTAL") ?? "10");
Deno.serve(async (req)=>{
  const traceId = crypto.randomUUID();
  const authErr = authCheck(req);
  if (authErr) return authErr;
  log(FUNC, "info", "start", {
    surgeThreshold: SURGE_THRESHOLD,
    minTotal: MIN_TOTAL
  }, traceId);
  try {
    const db = makeAdminClient();
    const week = isoWeek();
    // 1. Find surging topics (global scope; region 'global')
    const trends = await db.from("topic_region_trends", [
      `select=topic_id,delta_24h_per_hour,momentum_24h,total,total_24h`,
      `delta_24h_per_hour=gte.${SURGE_THRESHOLD}`,
      `total=gte.${MIN_TOTAL}`,
      `order=delta_24h_per_hour.desc`,
      `limit=50`
    ].join("&"));
    if (trends.length === 0) {
      log(FUNC, "info", "no_surging_topics", {}, traceId);
      return Response.json({
        ok: true,
        notified: 0
      });
    }
    // 2. Fetch topic titles in one shot
    const topicIds = [
      ...new Set(trends.map((t)=>t.topic_id))
    ].filter(Boolean);
    const topicsRaw = await db.from("topics", `select=id,title&id=in.(${topicIds.join(",")})`);
    const topicTitles = Object.fromEntries(topicsRaw.map((t)=>[
        t.id,
        t.title
      ]));
    // 3. For each surging topic, notify followers
    let notified = 0;
    let skipped = 0;
    for (const trend of trends){
      const topicTitle = topicTitles[trend.topic_id] ?? "A topic you follow";
      // Find followers with topic_follow_enabled
      const followers = await db.from("user_topic_follows", [
        `select=user_id,notification_preferences!inner(topic_follow_enabled)`,
        `topic_id=eq.${trend.topic_id}`
      ].join("&"));
      // M-I05: Bulk-fetch muted prefs for this topic's followers
      const followerUserIds = followers.map((f)=>f.user_id).filter(Boolean);
      const mutedFollowers = await buildMutedSet(db, followerUserIds, [
        trend.topic_id
      ]);
      for (const f of followers){
        if (!f.notification_preferences?.topic_follow_enabled) {
          skipped++;
          continue;
        }
        // M-I05: skip if user has muted this specific topic
        if (isMutedForTopic(mutedFollowers, f.user_id, trend.topic_id)) {
          skipped++;
          continue;
        }
        const eventKey = `topic_follow:${f.user_id}:${trend.topic_id}:surge:${week}`;
        const isNew = await tryLogEvent(db, "topic_follow", eventKey, {
          topic_id: trend.topic_id,
          delta: trend.delta_24h_per_hour,
          week
        });
        if (!isNew) {
          skipped++;
          continue;
        }
        await insertNotification(db, {
          user_id: f.user_id,
          notification_type: "topic_follow",
          title: `${topicTitle} is surging this week.`,
          body: null,
          href: `/topics/${trend.topic_id}`,
          topic_id: trend.topic_id,
          metadata: {
            eventKind: "topic_surge",
            topicMomentum: trend.momentum_24h,
            delta: trend.delta_24h_per_hour,
            regionScope: "global",
            regionKey: "Global"
          }
        });
        notified++;
      }
      // Phase 5: Notify users who answered questions in this topic
      // but haven't explicitly followed it — different copy, same type
      // H-06: resolve the topic's question ids first, then filter on those literals.
      const followerIds = new Set(followerUserIds);
      const topicQuestionIds = await questionIdsForTopic(db, trend.topic_id);
      const answeredIds = await answeredUserIds(db, topicQuestionIds, new Date(Date.now() - 60 * 86400_000).toISOString());
      const nonFollowerIds = answeredIds.filter((uid)=>!followerIds.has(uid));
      if (nonFollowerIds.length > 0) {
        const nonFollowerPrefs = await db.from("notification_preferences", `select=user_id,topic_follow_enabled&user_id=in.(${nonFollowerIds.join(",")})`);
        const prefMap = Object.fromEntries(nonFollowerPrefs.map((p)=>[
            p.user_id,
            p.topic_follow_enabled
          ]));
        // M-I05: Bulk-fetch muted prefs for answered-not-followed users
        const mutedAnswered = await buildMutedSet(db, nonFollowerIds, [
          trend.topic_id
        ]);
        for (const uid of nonFollowerIds){
          const enabled = prefMap[uid] !== false;
          if (!enabled) {
            skipped++;
            continue;
          }
          // M-I05: skip if user has muted this specific topic
          if (isMutedForTopic(mutedAnswered, uid, trend.topic_id)) {
            skipped++;
            continue;
          }
          const eventKey = `topic_trending:${uid}:${trend.topic_id}:${new Date().toISOString().slice(0, 10)}`;
          const isNew = await tryLogEvent(db, "topic_follow", eventKey, {
            topic_id: trend.topic_id,
            delta: trend.delta_24h_per_hour,
            source: "answered"
          });
          if (!isNew) {
            skipped++;
            continue;
          }
          await insertNotification(db, {
            user_id: uid,
            notification_type: "topic_follow",
            title: "A topic you've weighed in on is gaining attention.",
            body: topicTitle,
            href: `/topics/${trend.topic_id}`,
            topic_id: trend.topic_id,
            metadata: {
              eventKind: "topic_trending_answered",
              topicMomentum: trend.momentum_24h,
              delta: trend.delta_24h_per_hour,
              regionScope: "global",
              regionKey: "Global"
            }
          });
          notified++;
        }
      }
    }
    // S2: Topic re-ignition pass
    const DORMANT_THRESHOLD = parseFloat(Deno.env.get("TOPIC_DORMANT_THRESHOLD") ?? "0.1");
    const REIGNITION_DELTA = parseFloat(Deno.env.get("TOPIC_REIGNITION_DELTA") ?? "0.8");
    const reignitedTopics = trends.filter((t)=>t.delta_24h_per_hour >= REIGNITION_DELTA && (t.total - t.total_24h) / (6 * 24) < DORMANT_THRESHOLD);
    for (const trend of reignitedTopics){
      const topicTitle = topicTitles[trend.topic_id] ?? "A topic";
      const today = new Date().toISOString().slice(0, 10);
      // H-06: same two-step lookup as the surge pass.
      const topicQuestionIds = await questionIdsForTopic(db, trend.topic_id);
      const uniqueUserIds = await answeredUserIds(db, topicQuestionIds, new Date(Date.now() - 90 * 86400_000).toISOString());
      if (uniqueUserIds.length === 0) continue;
      const prefRows = await db.from("notification_preferences", `select=user_id,topic_follow_enabled&user_id=in.(${uniqueUserIds.join(",")})`);
      const prefMap = Object.fromEntries(prefRows.map((p)=>[
          p.user_id,
          p.topic_follow_enabled
        ]));
      // M-I05: Bulk-fetch muted prefs for re-ignition users
      const mutedReignition = await buildMutedSet(db, uniqueUserIds, [
        trend.topic_id
      ]);
      for (const uid of uniqueUserIds){
        if (prefMap[uid] === false) {
          skipped++;
          continue;
        }
        // M-I05: skip if user has muted this specific topic
        if (isMutedForTopic(mutedReignition, uid, trend.topic_id)) {
          skipped++;
          continue;
        }
        const eventKey = `topic_reignition:${uid}:${trend.topic_id}:${today}`;
        const isNew = await tryLogEvent(db, "topic_follow", eventKey, {
          topic_id: trend.topic_id,
          delta: trend.delta_24h_per_hour,
          source: "reignition"
        });
        if (!isNew) {
          skipped++;
          continue;
        }
        await insertNotification(db, {
          user_id: uid,
          notification_type: "topic_follow",
          title: `${topicTitle} is active again.`,
          body: "A topic you previously engaged with has picked up momentum after a quiet period.",
          href: `/topics/${trend.topic_id}`,
          topic_id: trend.topic_id,
          metadata: {
            eventKind: "topic_reignition",
            delta: trend.delta_24h_per_hour,
            regionScope: "global",
            regionKey: "Global"
          }
        });
        notified++;
      }
    }
    log(FUNC, "info", "done", {
      notified,
      skipped,
      topics: trends.length
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
