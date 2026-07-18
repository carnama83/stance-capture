// notify-new-local-topics — self-contained, no external imports
// I4: Notify users when new topics go live in their location
// Cadence: every 6 hours
// Trigger: POST with Authorization: Bearer <CRON_SECRET>
//
// Logic:
//   Find topics published in the last 6 hours
//   Match topic tier + location against user_location_settings
//   Respect new_local_topic_enabled preference
//   Batch: group multiple new topics in same location into one notification
//   Dedupe: one notification per user per day covering all their new local topics
//
// M-I05: notification_topic_prefs checked before send.
//   Per-topic muting is applied at the individual topic level within the
//   batched user→topics map. Topics muted by the user are removed from their
//   batch before the notification is assembled. If ALL topics for a user are
//   muted, the notification is skipped entirely.
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
function authCheck(req) {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) return null;
  if (req.headers.get("Authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", {
    status: 401
  });
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
function todayBucket() {
  return new Date().toISOString().slice(0, 10);
}
// ---------------------------------------------------------------------------
// M-I05: Bulk-fetch muted topic prefs for a set of users and topics.
// Returns a Set of "userId:topicId" strings for O(1) mute-check.
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
// =============================================================================
// Job logic
// =============================================================================
const FUNC = "notify-new-local-topics";
const LOOKBACK_HOURS = parseInt(Deno.env.get("LOCAL_TOPIC_LOOKBACK_HOURS") ?? "6");
Deno.serve(async (req)=>{
  const traceId = crypto.randomUUID();
  const authErr = authCheck(req);
  if (authErr) return authErr;
  log(FUNC, "info", "start", {
    LOOKBACK_HOURS
  }, traceId);
  try {
    const db = makeAdminClient();
    const today = todayBucket();
    const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 3600_000).toISOString();
    // 1. Find new topics published in the lookback window
    const newTopics = await db.from("topics", `select=id,title,tier,location_label,published_at&published_at=gte.${cutoff}&tier=not.eq.global&order=published_at.desc&limit=100`);
    if (!newTopics.length) {
      log(FUNC, "info", "no_new_local_topics", {}, traceId);
      return Response.json({
        ok: true,
        notified: 0,
        skipped: 0
      });
    }
    const newTopicIds = newTopics.map((t)=>t.id);
    const topicById = Object.fromEntries(newTopics.map((t)=>[
        t.id,
        t
      ]));
    // 2. Find which regions each topic belongs to
    const topicRegions = await db.from("topic_regions", `select=topic_id,region_id&topic_id=in.(${newTopicIds.join(",")})`);
    if (!topicRegions.length) {
      log(FUNC, "info", "no_topic_regions", {}, traceId);
      return Response.json({
        ok: true,
        notified: 0,
        skipped: 0
      });
    }
    // Build: region_id → [topic_ids]
    const topicsByRegion = new Map();
    for (const tr of topicRegions){
      if (!topicsByRegion.has(tr.region_id)) topicsByRegion.set(tr.region_id, []);
      topicsByRegion.get(tr.region_id).push(tr.topic_id);
    }
    const allRegionIds = [
      ...topicsByRegion.keys()
    ];
    // 3. Find users whose location matches these regions
    const userLocations = await db.from("user_location_settings", `select=user_id,location_id&location_id=in.(${allRegionIds.join(",")})`);
    if (!userLocations.length) {
      return Response.json({
        ok: true,
        notified: 0,
        skipped: 0
      });
    }
    // 4. Load preferences for matching users
    const matchingUserIds = [
      ...new Set(userLocations.map((u)=>u.user_id))
    ];
    let prefs = [];
    for(let i = 0; i < matchingUserIds.length; i += 200){
      const chunk = matchingUserIds.slice(i, i + 200);
      const rows = await db.from("notification_preferences", `select=user_id,new_local_topic_enabled,inapp_enabled,quiet_hours_start,quiet_hours_end,timezone&user_id=in.(${chunk.join(",")})`);
      prefs = prefs.concat(rows);
    }
    const prefByUser = Object.fromEntries(prefs.map((p)=>[
        p.user_id,
        p
      ]));
    // 5. Build user → matching new topics map
    const topicsForUser = new Map();
    for (const ul of userLocations){
      const regionTopics = topicsByRegion.get(ul.location_id) ?? [];
      if (!topicsForUser.has(ul.user_id)) topicsForUser.set(ul.user_id, []);
      for (const tid of regionTopics){
        if (!topicsForUser.get(ul.user_id).includes(tid)) {
          topicsForUser.get(ul.user_id).push(tid);
        }
      }
    }
    // M-I05: Bulk-fetch all muted topic prefs for matching users × new topics
    const mutedSet = await buildMutedSet(db, matchingUserIds, newTopicIds);
    let notified = 0;
    let skipped = 0;
    for (const [userId, userTopicIds] of topicsForUser){
      const pref = prefByUser[userId];
      if (pref && (!pref.new_local_topic_enabled || !pref.inapp_enabled)) {
        skipped++;
        continue;
      }
      if (pref) {
        const hour = localHour(pref.timezone);
        if (isQuietHours(hour, pref.quiet_hours_start, pref.quiet_hours_end)) {
          skipped++;
          continue;
        }
      }
      // M-I05: Filter out individually muted topics for this user
      const unmutedTopicIds = userTopicIds.filter((tid)=>!mutedSet.has(`${userId}:${tid}`));
      // If all topics for this user were muted, skip entirely
      if (unmutedTopicIds.length === 0) {
        skipped++;
        continue;
      }
      // Batching: one notification per user per day covering all unmuted new local topics
      const eventKey = `new_local_topic:${userId}:${today}`;
      const isNew = await tryLogEvent(db, "new_local_topic", eventKey, {
        user_id: userId,
        topic_ids: unmutedTopicIds,
        today
      });
      if (!isNew) {
        skipped++;
        continue;
      }
      // Build title + body depending on count of unmuted topics
      const count = unmutedTopicIds.length;
      const firstTopic = topicById[unmutedTopicIds[0]];
      const locationLabel = firstTopic?.location_label ?? "your area";
      const title = count === 1 ? `New topic in ${locationLabel}: ${firstTopic?.title?.slice(0, 50) ?? ""}${(firstTopic?.title?.length ?? 0) > 50 ? "…" : ""}` : `${count} new topics in ${locationLabel}`;
      const body = count > 1 ? `Including: ${newTopics.filter((t)=>unmutedTopicIds.includes(t.id)).map((t)=>t.title).slice(0, 2).join(", ")}…` : null;
      const href = count === 1 ? `/topics/${unmutedTopicIds[0]}` : `/topics`;
      await insertNotification(db, {
        user_id: userId,
        notification_type: "new_local_topic",
        title,
        body,
        href,
        topic_id: count === 1 ? unmutedTopicIds[0] : null,
        metadata: {
          eventKind: "new_local_topics",
          topicIds: unmutedTopicIds,
          topicCount: count,
          locationLabel
        }
      });
      notified++;
    }
    log(FUNC, "info", "done", {
      notified,
      skipped,
      newTopics: newTopics.length
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
