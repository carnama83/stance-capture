// supabase/functions/notify-election-updates/index.ts
//
// Epic EL — Phase EL-8: notify-election-updates
//
// Sends in-app notifications to users when new election questions are published
// for their primary_constituency_id.
//
// EL-F-008: users can opt out via election_notifications_enabled=false
// Does NOT send emails.
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
// ---------------------------------------------------------------------------
// W-01 / H-04b (Sep 2026): this function was deployed with verify_jwt=false AND
// a guard that FAILED OPEN:
//
//     if (cronSecret && incoming !== cronSecret && incoming !== serviceRoleKey) 401
//
// The leading `cronSecret &&` means that whenever CRON_SECRET was unset the whole
// condition short-circuits to false and EVERY caller is admitted — with no platform
// gate behind it, since verify_jwt was false. This endpoint writes user_notifications
// rows for arbitrary users, so an open door here is a spam/notification-injection
// vector. It is the same defect shape already fixed on whatsapp-broadcast-dispatch.
//
// Replaced with the PORTABLE service_role check used across this project:
//   Path A — exact match against this project's own SUPABASE_SERVICE_ROLE_KEY
//            (covers the modern opaque sb_secret_... key, which carries no claims).
//   Path B — a service_role JWT (legacy shape, still used by Prod's pg_cron).
// Safe only because this is now deployed with verify_jwt=true, so the platform has
// already validated the signature before the body runs. Do NOT set verify_jwt back
// to false: unsigned claims are forgeable and Path B would become a hole.
//
// Fails CLOSED on everything else — including a missing env var.
// ---------------------------------------------------------------------------
function authCheck(req) {
  const deny = ()=>new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" }
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
  } catch {
    return deny();
  }
}
Deno.serve(async (req)=>{
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      ok: false,
      error: "Method Not Allowed"
    }), {
      status: 405,
      headers: { "content-type": "application/json" }
    });
  }
  const authErr = authCheck(req);
  if (authErr) return authErr;
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const projectUrl = (Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  if (!serviceRoleKey || !projectUrl) {
    return new Response(JSON.stringify({
      ok: false,
      error: "Missing env vars"
    }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
  const headers = sbHeaders(serviceRoleKey);
  const lookbackStart = new Date(Date.now() - LOOK_BACK_HOURS * 60 * 60 * 1000).toISOString();
  const questionsRes = await fetch(`${projectUrl}/rest/v1/questions` + `?is_election_question=eq.true` + `&status=eq.active` + `&published_at=gte.${lookbackStart}` + `&select=id,question,election_constituency_id,election_constituency_name,` + `election_issue_tag,election_id,published_at` + `&order=published_at.desc` + `&limit=100`, {
    headers
  });
  if (!questionsRes.ok) {
    return new Response(JSON.stringify({
      ok: false,
      error: "Failed to fetch questions"
    }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
  const newQuestions = await questionsRes.json();
  if (!newQuestions.length) {
    return new Response(JSON.stringify({
      ok: true,
      notified: 0,
      message: "No new election questions"
    }), {
      headers: { "content-type": "application/json" }
    });
  }
  log("info", "new election questions found", {
    count: newQuestions.length
  });
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
      headers: { "content-type": "application/json" }
    });
  }
  let totalNotified = 0;
  for (const [constituencyId, questions] of byConstituency.entries()){
    const profilesRes = await fetch(`${projectUrl}/rest/v1/profiles` + `?primary_constituency_id=eq.${constituencyId}` + `&election_notifications_enabled=eq.true` + `&user_id=not.is.null` + `&select=user_id,primary_constituency_id` + `&limit=${BATCH_SIZE}`, {
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
    const today = new Date().toISOString().slice(0, 10);
    const electionId = questions[0].election_id;
    const dedupeKey = `election_update:${electionId}:${constituencyId}:${today}`;
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
    // H-05: never let a null user_id reach the insert — PostgREST rejects the
    // whole batch, losing every good row alongside the bad one.
    const notifications = profiles.filter((p)=>Boolean(p.user_id)).map((p)=>({
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
    if (notifications.length === 0) continue;
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
    headers: { "content-type": "application/json" }
  });
});
