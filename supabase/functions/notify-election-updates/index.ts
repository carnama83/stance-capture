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
// H-13 (Sep 2026). The previous gate was:
//
//   const incoming = req.headers.get("x-cron-secret")
//                 ?? req.headers.get("authorization")?.replace("Bearer ","") ?? "";
//   if (cronSecret && incoming !== cronSecret && incoming !== serviceRoleKey) 401
//
// The leading `cronSecret &&` makes the whole condition short-circuit to false
// whenever CRON_SECRET is unset, admitting EVERY caller - and this function was
// deployed with verify_jwt:false, so there was no platform gate behind it. It
// writes user_notifications rows for arbitrary users. Same shape as W-01 on
// whatsapp-broadcast-dispatch.
//
// Rewritten to fail CLOSED on every path. Three accepted credentials, because
// Prod legitimately uses more than one:
//   Path A - exact match against this project's own SUPABASE_SERVICE_ROLE_KEY.
//            Covers the modern opaque sb_secret_ key, which carries no claims.
//            VERIFIED live on Prod: a bare Bearer <sb_secret_...> returns 200,
//            so the Edge env key and Vault's service_role_key are the same value.
//   Path B - a service_role JWT. Prod's private.get_secret('service_role_key')
//            is a 219-char legacy JWT and several cron jobs still send it.
//            VERIFIED live on Prod: returns 200.
//   Path C - x-cron-secret exact match. This is what
//            admin.cron_notify_election_updates() actually sends today, so it is
//            retained deliberately: removing it would break a live 6-hourly job.
//
// Every path requires its env var to be present and non-empty, so a missing
// secret denies rather than admits.
//
// Deployed with verify_jwt: TRUE. Do not set it back to false - Path B parses
// claims without verifying the signature, which is only safe because the
// platform has already validated the credential before this body runs.
// ---------------------------------------------------------------------------
function authCheck(req) {
  const deny = ()=>new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" }
  });

  const envKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";

  // Path C - x-cron-secret, fail-closed (requires the env var to exist).
  const xcron = req.headers.get("x-cron-secret") ?? "";
  if (cronSecret && xcron && xcron === cronSecret) return null;

  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!m) return deny();
  const token = m[1];

  // Path A - exact match against this project's own service role key.
  if (envKey && token === envKey) return null;

  // Path B - service_role JWT, with the project ref pinned.
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
    // H-05: a null user_id would make PostgREST reject the whole batch,
    // losing every good row alongside the bad one.
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
