// supabase/functions/notify/topic-follows/index.ts
// Job 1 — generate_topic_follow_notifications
//
// Cadence: every 4 hours (configure in cron-jobs admin or pg_cron)
// Trigger: POST with Authorization: Bearer <CRON_SECRET>
//
// Logic:
//   For each topic with strong momentum (delta_24h_per_hour > SURGE_THRESHOLD):
//     Find all users following that topic with topic_follow_enabled = true
//     Dedupe per user/topic/week
//     Insert user_notification of type topic_follow

import {
  log,
  authCheck,
  makeAdminClient,
  tryLogEvent,
  insertNotification,
  isoWeek,
} from "../_helpers.ts";

const FUNC = "notify-topic-follows";

// Momentum threshold above which a topic is considered "surging".
// delta_24h_per_hour = (responses_last_24h / 24) - (responses_last_7d / (7*24))
// A value of 0.5 means 12+ extra responses/day above the weekly baseline.
const SURGE_THRESHOLD = parseFloat(Deno.env.get("TOPIC_SURGE_THRESHOLD") ?? "0.5");

// Minimum total responses on the topic to avoid notifying on tiny noise
const MIN_TOTAL = parseInt(Deno.env.get("TOPIC_MIN_TOTAL") ?? "10");

interface TrendRow {
  topic_id: string;
  topic_title: string;
  delta_24h_per_hour: number;
  momentum_24h: number;
  total: number;
}

interface FollowRow {
  user_id: string;
  topic_follow_enabled: boolean;
}

Deno.serve(async (req: Request) => {
  const traceId = crypto.randomUUID();

  const authErr = authCheck(req);
  if (authErr) return authErr;

  log(FUNC, "info", "start", { surgeThreshold: SURGE_THRESHOLD, minTotal: MIN_TOTAL }, traceId);

  try {
    const db = makeAdminClient();
    const week = isoWeek();

    // 1. Find surging topics (global scope; region 'global')
    const trends = await db.from<TrendRow>(
      "topic_region_trends",
      [
        `select=topic_id,delta_24h_per_hour,momentum_24h,total`,
        `delta_24h_per_hour=gte.${SURGE_THRESHOLD}`,
        `total=gte.${MIN_TOTAL}`,
        `order=delta_24h_per_hour.desc`,
        `limit=50`,
      ].join("&"),
    );

    if (trends.length === 0) {
      log(FUNC, "info", "no_surging_topics", {}, traceId);
      return Response.json({ ok: true, notified: 0 });
    }

    // 2. Fetch topic titles in one shot
    const topicIds = [...new Set(trends.map((t) => t.topic_id))];
    const topicsRaw = await db.from<{ id: string; title: string }>(
      "topics",
      `select=id,title&id=in.(${topicIds.join(",")})`,
    );
    const topicTitles = Object.fromEntries(topicsRaw.map((t) => [t.id, t.title]));

    // 3. For each surging topic, notify followers
    let notified = 0;
    let skipped = 0;

    for (const trend of trends) {
      const topicTitle = topicTitles[trend.topic_id] ?? "A topic you follow";

      // Find followers with topic_follow_enabled
      // JOIN user_topic_follows + notification_preferences
      const followers = await db.from<FollowRow>(
        "user_topic_follows",
        [
          `select=user_id,notification_preferences!inner(topic_follow_enabled)`,
          `topic_id=eq.${trend.topic_id}`,
        ].join("&"),
      ) as Array<{ user_id: string; notification_preferences: { topic_follow_enabled: boolean } }>;

      for (const f of followers) {
        if (!f.notification_preferences?.topic_follow_enabled) {
          skipped++;
          continue;
        }

        const eventKey = `topic_follow:${f.user_id}:${trend.topic_id}:surge:${week}`;
        const isNew = await tryLogEvent(db, "topic_follow", eventKey, {
          topic_id: trend.topic_id,
          delta: trend.delta_24h_per_hour,
          week,
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
            regionKey: "Global",
          },
        });

        notified++;
      }
    }

    log(FUNC, "info", "done", { notified, skipped, topics: trends.length }, traceId);
    return Response.json({ ok: true, notified, skipped });
  } catch (err) {
    log(FUNC, "error", "fatal", { error: (err as Error).message }, traceId);
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
});
