// supabase/functions/notify/weekly-digest/index.ts
// Job 3 — generate_weekly_digests
//
// Cadence: daily (runs every day, generates only for users whose local
//          day-of-week + hour window matches NOW)
// Trigger: POST with Authorization: Bearer <CRON_SECRET>
//
// Match window: ±30 minutes of the user's configured digest_hour_local
// on the configured digest_day_of_week.
//
// Dedupe key: weekly_digest:{user_id}:{week_start}
// → safe to run multiple times; only first succeeds per user/week

import {
  log,
  authCheck,
  makeAdminClient,
  tryLogEvent,
  insertNotification,
  weekStart,
  weekEnd,
} from "../_helpers.ts";

const FUNC = "notify-weekly-digest";

// ±minutes around the user's target hour to still deliver the digest
const WINDOW_MINUTES = parseInt(Deno.env.get("DIGEST_WINDOW_MINUTES") ?? "30");

// Max items per section
const MAX_SECTION_ITEMS = 3;

interface PrefRow {
  user_id: string;
  weekly_digest_enabled: boolean;
  digest_day_of_week: number;
  digest_hour_local: number;
  timezone: string;
}

interface TopicFollowRow {
  user_id: string;
  topic_id: string;
}

interface TrendRow {
  topic_id: string;
  delta_24h_per_hour: number;
  total: number;
}

interface TopicRow {
  id: string;
  title: string;
}

interface StanceRow {
  user_id: string;
  question_id: string;
  score: number;
}

interface StatsRow {
  question_id: string;
  avg_score: number | null;
  total_responses: number;
}

interface QuestionRow {
  id: string;
  question: string;
}

/** Returns local {dayOfWeek, hour} for a given IANA timezone */
function localDayAndHour(timezone: string): { day: number; hour: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "numeric",
      hour12: false,
    }).formatToParts(new Date());

    const weekdayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
    const hourStr = parts.find((p) => p.type === "hour")?.value ?? "9";
    const hour = parseInt(hourStr) % 24;

    return { day: weekdayMap[weekday] ?? 1, hour };
  } catch {
    // Fallback to UTC if timezone is invalid
    const now = new Date();
    return { day: now.getUTCDay(), hour: now.getUTCHours() };
  }
}

/** Returns true if user's local time is within the digest window */
function isInDigestWindow(pref: PrefRow): boolean {
  const { day, hour } = localDayAndHour(pref.timezone);

  if (day !== pref.digest_day_of_week) return false;

  const nowMinutes = hour * 60 + new Date().getMinutes();
  const targetMinutes = pref.digest_hour_local * 60;
  const diff = Math.abs(nowMinutes - targetMinutes);

  return diff <= WINDOW_MINUTES;
}

Deno.serve(async (req: Request) => {
  const traceId = crypto.randomUUID();

  const authErr = authCheck(req);
  if (authErr) return authErr;

  log(FUNC, "info", "start", { windowMinutes: WINDOW_MINUTES }, traceId);

  try {
    const db = makeAdminClient();
    const wStart = weekStart();
    const wEnd = weekEnd();

    // 1. Load users with weekly_digest_enabled
    const prefs = await db.from<PrefRow>(
      "notification_preferences",
      "select=user_id,weekly_digest_enabled,digest_day_of_week,digest_hour_local,timezone&weekly_digest_enabled=eq.true",
    );

    // 2. Filter to users in their delivery window right now
    const eligible = prefs.filter(isInDigestWindow);

    log(FUNC, "info", "eligible_users", { total: prefs.length, eligible: eligible.length }, traceId);

    if (eligible.length === 0) {
      return Response.json({ ok: true, generated: 0, skipped: 0 });
    }

    // 3. Pre-fetch shared data used across all users
    const eligibleIds = eligible.map((p) => p.user_id);

    // Topic follows for all eligible users
    const follows = await db.from<TopicFollowRow>(
      "user_topic_follows",
      `select=user_id,topic_id&user_id=in.(${eligibleIds.join(",")})`,
    );

    // Surging topics (same threshold as Job 1)
    const surgingTopics = await db.from<TrendRow>(
      "topic_region_trends",
      "select=topic_id,delta_24h_per_hour,total&delta_24h_per_hour=gte.0.3&total=gte.5&order=delta_24h_per_hour.desc&limit=100",
    );
    const surgingTopicIds = new Set(surgingTopics.map((t) => t.topic_id));

    // Topic titles
    const allTopicIds = [...new Set(follows.map((f) => f.topic_id))];
    let topicRows: TopicRow[] = [];
    if (allTopicIds.length > 0) {
      topicRows = await db.from<TopicRow>(
        "topics",
        `select=id,title&id=in.(${allTopicIds.join(",")})`,
      );
    }
    const topicTitles = Object.fromEntries(topicRows.map((t) => [t.id, t.title]));

    // User stances (last 90 days) for eligible users
    const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString();
    const stances = await db.from<StanceRow>(
      "question_stances",
      `select=user_id,question_id,score&user_id=in.(${eligibleIds.join(",")})&updated_at=gte.${cutoff}`,
    );

    // Stats for shifted questions
    const answeredQuestionIds = [...new Set(stances.map((s) => s.question_id))];
    let stats: StatsRow[] = [];
    if (answeredQuestionIds.length > 0) {
      for (let i = 0; i < answeredQuestionIds.length; i += 100) {
        const chunk = answeredQuestionIds.slice(i, i + 100);
        const rows = await db.from<StatsRow>(
          "question_stance_stats",
          `select=question_id,avg_score,total_responses&question_id=in.(${chunk.join(",")})`,
        );
        stats = stats.concat(rows);
      }
    }
    const statsByQuestion = Object.fromEntries(stats.map((s) => [s.question_id, s]));

    // Question text
    let questionRows: QuestionRow[] = [];
    if (answeredQuestionIds.length > 0) {
      for (let i = 0; i < answeredQuestionIds.length; i += 100) {
        const chunk = answeredQuestionIds.slice(i, i + 100);
        const rows = await db.from<QuestionRow>(
          "questions",
          `select=id,question&id=in.(${chunk.join(",")})`,
        );
        questionRows = questionRows.concat(rows);
      }
    }
    const questionText = Object.fromEntries(questionRows.map((q) => [q.id, q.question]));

    // 4. Generate digest per user
    let generated = 0;
    let skipped = 0;

    for (const pref of eligible) {
      // Dedupe: one digest per user per week
      const eventKey = `weekly_digest:${pref.user_id}:${wStart}`;
      const isNew = await tryLogEvent(db, "weekly_digest", eventKey, {
        user_id: pref.user_id,
        week_start: wStart,
      });

      if (!isNew) {
        skipped++;
        continue;
      }

      // Build followed_topic_updates
      const userFollows = follows.filter((f) => f.user_id === pref.user_id);
      const followedTopicUpdates = userFollows
        .filter((f) => surgingTopicIds.has(f.topic_id))
        .slice(0, MAX_SECTION_ITEMS)
        .map((f) => ({
          topic_id: f.topic_id,
          topic_title: topicTitles[f.topic_id] ?? "A topic you follow",
          summary: "This topic is gaining momentum this week.",
          href: `/topics/${f.topic_id}`,
        }));

      // Build answered_question_shifts
      const userStances = stances.filter((s) => s.user_id === pref.user_id);
      const answeredQuestionShifts = userStances
        .filter((s) => {
          const stat = statsByQuestion[s.question_id];
          if (!stat || stat.avg_score == null) return false;
          return Math.abs(stat.avg_score - s.score) >= 0.75;
        })
        .slice(0, MAX_SECTION_ITEMS)
        .map((s) => {
          const stat = statsByQuestion[s.question_id]!;
          const title = questionText[s.question_id] ?? "A question you answered";
          return {
            question_id: s.question_id,
            question_title: title.slice(0, 80) + (title.length > 80 ? "…" : ""),
            summary: "Community sentiment moved away from your stance.",
            href: `/q/${s.question_id}`,
          };
        });

      // Skip empty digests
      const isEmpty = followedTopicUpdates.length === 0 && answeredQuestionShifts.length === 0;
      if (isEmpty) {
        skipped++;
        continue;
      }

      // Build summary JSON (§10 shape)
      const summary = {
        followed_topic_updates: followedTopicUpdates,
        answered_question_shifts: answeredQuestionShifts,
        recommended_questions: [], // reserved for future enrichment
        alignment_note: null,
      };

      // Insert weekly_digests row
      const digestRes = await fetch(`${db.url}/rest/v1/weekly_digests`, {
        method: "POST",
        headers: {
          ...db._headers(),
          Prefer: "resolution=ignore-duplicates,return=representation",
        },
        body: JSON.stringify([{
          user_id: pref.user_id,
          week_start: wStart,
          week_end: wEnd,
          summary,
          delivered_in_app_at: new Date().toISOString(),
        }]),
      });

      if (!digestRes.ok) {
        log(FUNC, "warn", "digest_insert_failed", { user_id: pref.user_id, status: digestRes.status }, traceId);
        continue;
      }

      const digestRows = await digestRes.json() as Array<{ id: string }>;
      const digestId = digestRows[0]?.id ?? null;

      // Count items for copy
      const nTopics = followedTopicUpdates.length;
      const nQuestions = answeredQuestionShifts.length;
      const bodyParts: string[] = [];
      if (nTopics > 0) bodyParts.push(`${nTopics} followed topic${nTopics > 1 ? "s" : ""} moved`);
      if (nQuestions > 0) bodyParts.push(`${nQuestions} answered question${nQuestions > 1 ? "s" : ""} shifted`);

      // Insert user_notification
      await insertNotification(db, {
        user_id: pref.user_id,
        notification_type: "weekly_digest",
        title: "Your weekly Stance Capture digest is ready.",
        body: `This week: ${bodyParts.join(", ")}.`,
        href: null, // panel renders digest inline
        digest_id: digestId,
        metadata: {
          digestId,
          weekStart: wStart,
          weekEnd: wEnd,
        },
      });

      generated++;
    }

    log(FUNC, "info", "done", { generated, skipped }, traceId);
    return Response.json({ ok: true, generated, skipped });
  } catch (err) {
    log(FUNC, "error", "fatal", { error: (err as Error).message }, traceId);
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
});
