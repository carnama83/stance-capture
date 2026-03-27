// supabase/functions/notify/stance-changes/index.ts
// Job 2 — generate_stance_change_notifications
//
// Cadence: daily
// Trigger: POST with Authorization: Bearer <CRON_SECRET>
//
// Logic:
//   For each user who has answered questions:
//     Find questions where global avg_score has shifted >= DELTA_THRESHOLD
//     from when the user last answered
//     Respect stance_change_enabled preference
//     Max 1 alert per user/question per 7 days (enforced via event log)
//     Dedupe key: stance_change:{user_id}:{question_id}:community_shift:{iso_week}

import {
  log,
  authCheck,
  makeAdminClient,
  tryLogEvent,
  insertNotification,
  isoWeek,
} from "../_helpers.ts";

const FUNC = "notify-stance-changes";

// Minimum absolute shift in avg_score (range: -2 to +2) to trigger notification.
// 0.75 = meaningful community movement on a -2/+2 scale.
const DELTA_THRESHOLD = parseFloat(Deno.env.get("STANCE_DELTA_THRESHOLD") ?? "0.75");

// Max questions to notify per user per run (guards against overwhelming a user
// who answered many questions that all shifted at once)
const MAX_PER_USER = parseInt(Deno.env.get("STANCE_MAX_PER_USER") ?? "3");

interface StanceRow {
  user_id: string;
  question_id: string;
  score: number; // user's own stance at time of answer (-2 to +2)
  updated_at: string;
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

interface PrefRow {
  user_id: string;
  stance_change_enabled: boolean;
}

Deno.serve(async (req: Request) => {
  const traceId = crypto.randomUUID();

  const authErr = authCheck(req);
  if (authErr) return authErr;

  log(FUNC, "info", "start", { deltaThreshold: DELTA_THRESHOLD }, traceId);

  try {
    const db = makeAdminClient();
    const week = isoWeek();

    // 1. Load all users who have opted into stance_change notifications
    //    (users with no prefs row = default true, handled below)
    const prefs = await db.from<PrefRow>(
      "notification_preferences",
      "select=user_id,stance_change_enabled&stance_change_enabled=eq.true",
    );
    const enabledUserIds = new Set(prefs.map((p) => p.user_id));

    // 2. Load all current global stance stats
    const stats = await db.from<StatsRow>(
      "question_stance_stats",
      "select=question_id,avg_score,total_responses&total_responses=gte.5",
    );
    const statsByQuestion = Object.fromEntries(
      stats.map((s) => [s.question_id, s]),
    );

    // 3. Load recent user stances (last 90 days to keep set manageable)
    const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString();
    const stances = await db.from<StanceRow>(
      "question_stances",
      `select=user_id,question_id,score,updated_at&updated_at=gte.${cutoff}&order=user_id.asc`,
    );

    // 4. Group stances by user
    const byUser = new Map<string, StanceRow[]>();
    for (const s of stances) {
      if (!byUser.has(s.user_id)) byUser.set(s.user_id, []);
      byUser.get(s.user_id)!.push(s);
    }

    // 5. Pre-fetch question text for questions that appear in stances
    const questionIds = [...new Set(stances.map((s) => s.question_id))];
    let questions: QuestionRow[] = [];
    if (questionIds.length > 0) {
      // Fetch in chunks of 100 to stay within URL length limits
      for (let i = 0; i < questionIds.length; i += 100) {
        const chunk = questionIds.slice(i, i + 100);
        const rows = await db.from<QuestionRow>(
          "questions",
          `select=id,question&id=in.(${chunk.join(",")})`,
        );
        questions = questions.concat(rows);
      }
    }
    const questionText = Object.fromEntries(questions.map((q) => [q.id, q.question]));

    let notified = 0;
    let skipped = 0;

    for (const [userId, userStances] of byUser) {
      // Skip users who have explicitly disabled stance_change notifications
      // Users with no prefs row default to enabled
      if (prefs.length > 0 && !enabledUserIds.has(userId)) {
        skipped += userStances.length;
        continue;
      }

      let userNotifyCount = 0;

      for (const stance of userStances) {
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
          week,
        });

        if (!isNew) {
          skipped++;
          continue;
        }

        const title = questionText[stance.question_id]
          ? `Community sentiment shifted on: ${questionText[stance.question_id].slice(0, 60)}${questionText[stance.question_id].length > 60 ? "…" : ""}`
          : "Community sentiment shifted on a question you answered.";

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
            regionKey: "Global",
          },
        });

        notified++;
        userNotifyCount++;
      }
    }

    log(FUNC, "info", "done", { notified, skipped }, traceId);
    return Response.json({ ok: true, notified, skipped });
  } catch (err) {
    log(FUNC, "error", "fatal", { error: (err as Error).message }, traceId);
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
});
