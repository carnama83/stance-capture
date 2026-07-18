// supabase/functions/notify-election-updates/index.ts
//
// Epic EL — Phase EL-8: notify-election-updates
//
// Sends in-app notifications to users when new election questions are published
// for their primary_constituency_id.
//
// Logic:
//   1. Find users with primary_constituency_id set + election_notifications_enabled=true
//   2. Find election questions published in the last 24h for those constituencies
//   3. Skip users who have already been notified about the same question batch
//      (using notification_event_log deduplication)
//   4. Insert user_notifications rows (type='election_update')
//   5. Log to notification_event_log for deduplication
//
// Called by:
//   - pg_cron every 6 hours
//   - Manually triggered by admin after bulk question publishing
//
// EL-F-008: users can opt out via election_notifications_enabled=false
// Does NOT send emails — that is handled by Epic I email delivery (blocked
// pending email provider selection).
const FUNC = "notify-election-updates";
const LOOK_BACK_HOURS = 24;
const BATCH_SIZE = 200; // users per batch
function log(level, msg, extra = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    func: FUNC,
    msg,
    ...extra
  }));
}
function sbHeaders(key) {
  return {
    "Content-Type": "application/json",
    "apikey": key,
    "Authorization": `Bearer ${key}`
  };
}
Deno.serve(async (req)=>{
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      ok: false,
      error: "Method Not Allowed"
    }), {
      status: 405,
      headers: {
        "content-type": "application/json"
      }
    });
  }
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const projectUrl = (Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const incoming = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
  if (cronSecret && incoming !== cronSecret && incoming !== serviceRoleKey) {
    return new Response(JSON.stringify({
      ok: false,
      error: "Unauthorized"
    }), {
      status: 401,
      headers: {
        "content-type": "application/json"
      }
    });
  }
  if (!serviceRoleKey || !projectUrl) {
    return new Response(JSON.stringify({
      ok: false,
      error: "Missing env vars"
    }), {
      status: 500,
      headers: {
        "content-type": "application/json"
      }
    });
  }
  const headers = sbHeaders(serviceRoleKey);
  const lookbackStart = new Date(Date.now() - LOOK_BACK_HOURS * 60 * 60 * 1000).toISOString();
  // Fetch new election questions published in the last 24h
  const questionsRes = await fetch(`${projectUrl}/rest/v1/questions` + `?is_election_question=eq.true` + `&status=eq.active` + `&published_at=gte.${lookbackStart}` + `&select=id,question,election_constituency_id,election_constituency_name,` + `election_issue_tag,election_id,published_at` + `&order=published_at.desc` + `&limit=100`, {
    headers
  });
  if (!questionsRes.ok) {
    return new Response(JSON.stringify({
      ok: false,
      error: "Failed to fetch questions"
    }), {
      status: 500,
      headers: {
        "content-type": "application/json"
      }
    });
  }
  const newQuestions = await questionsRes.json();
  if (!newQuestions.length) {
    return new Response(JSON.stringify({
      ok: true,
      notified: 0,
      message: "No new election questions"
    }), {
      headers: {
        "content-type": "application/json"
      }
    });
  }
  log("info", "new election questions found", {
    count: newQuestions.length
  });
  // Group questions by constituency_id
  const byConstituency = new Map();
  for (const q of newQuestions){
    if (!q.election_constituency_id) continue; // party-level — skip for constituency targeting
    const key = q.election_constituency_id;
    if (!byConstituency.has(key)) byConstituency.set(key, []);
    byConstituency.get(key).push(q);
  }
  if (!byConstituency.size) {
    return new Response(JSON.stringify({
      ok: true,
      notified: 0,
      message: "No constituency-targeted questions"
    }), {
      headers: {
        "content-type": "application/json"
      }
    });
  }
  let totalNotified = 0;
  // Process per constituency
  for (const [constituencyId, questions] of byConstituency.entries()){
    // Find users with this primary_constituency_id who want notifications
    const profilesRes = await fetch(`${projectUrl}/rest/v1/profiles` + `?primary_constituency_id=eq.${constituencyId}` + `&election_notifications_enabled=eq.true` + `&select=user_id,primary_constituency_id` + `&limit=${BATCH_SIZE}`, {
      headers
    });
    if (!profilesRes.ok) continue;
    const profiles = await profilesRes.json();
    if (!profiles.length) continue;
    const constituencyName = questions[0].election_constituency_name ?? "your constituency";
    const questionCount = questions.length;
    const tags = [
      ...new Set(questions.map((q)=>q.election_issue_tag).filter(Boolean))
    ];
    const tagLabel = tags.slice(0, 3).join(", ");
    // Build deduplication key: election_id + constituency_id + date
    const today = new Date().toISOString().slice(0, 10);
    const electionId = questions[0].election_id;
    const dedupeKey = `election_update:${electionId}:${constituencyId}:${today}`;
    // Check if already notified today for this election + constituency
    const dedupeRes = await fetch(`${projectUrl}/rest/v1/notification_event_log` + `?event_type=eq.election_update` + `&event_key=eq.${dedupeKey}` + `&select=id&limit=1`, {
      headers
    });
    if (dedupeRes.ok) {
      const dupes = await dedupeRes.json();
      if (dupes.length > 0) {
        log("info", "already notified today, skipping", {
          constituencyId,
          dedupeKey
        });
        continue;
      }
    }
    // Insert notifications for all users in this constituency
    const notifications = profiles.map((p)=>({
        user_id: p.user_id,
        notification_type: "election_update",
        title: `${questionCount} new election question${questionCount > 1 ? "s" : ""} for ${constituencyName}`,
        body: tagLabel ? `Topics: ${tagLabel}. Share your stance.` : "New election questions are waiting for your stance.",
        href: `/elections/${electionId}?constituency=${constituencyId}`,
        metadata: {
          election_id: electionId,
          constituency_id: constituencyId,
          question_count: questionCount,
          issue_tags: tags
        }
      }));
    // Batch insert notifications (up to 200 at once)
    const insertRes = await fetch(`${projectUrl}/rest/v1/user_notifications`, {
      method: "POST",
      headers: {
        ...headers,
        "Prefer": "return=minimal"
      },
      body: JSON.stringify(notifications)
    });
    if (insertRes.ok) {
      totalNotified += notifications.length;
      log("info", "notifications sent", {
        constituency_id: constituencyId,
        count: notifications.length
      });
    } else {
      const err = await insertRes.json().catch(()=>({}));
      log("error", "notification insert failed", {
        constituency_id: constituencyId,
        err
      });
    }
    // Log deduplication event
    await fetch(`${projectUrl}/rest/v1/notification_event_log`, {
      method: "POST",
      headers: {
        ...headers,
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({
        event_type: "election_update",
        event_key: dedupeKey,
        payload: {
          election_id: electionId,
          constituency_id: constituencyId,
          users_notified: notifications.length,
          question_count: questionCount
        }
      })
    });
  }
  return new Response(JSON.stringify({
    ok: true,
    notified: totalNotified,
    constituencies: byConstituency.size
  }), {
    headers: {
      "content-type": "application/json"
    }
  });
});
