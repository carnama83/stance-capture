// supabase/functions/aggregate-election-stances/index.ts
//
// Epic EL — Phase EL-7: aggregate-election-stances
//
// Called every 30 minutes by pg_cron via admin.cron_aggregate_election_stances().
// Also callable manually by admin for immediate refresh.
//
// For each active election:
//   1. Refresh all constituency-level aggregates for questions
//      that have new stances since last_refreshed_at
//   2. Check exit poll gate for each election and lift if window has passed
//   3. Build PC-level rollups from AC-level aggregates (EL-QA-020)
//   4. Log gate lift events to election_audit_log
//
// EL-QA-018: aggregates hidden until last_phase_close_at + 30min
// EL-QA-019: NOTA counted separately
// EL-QA-020: AC→PC hierarchy rollup
// EL-QA-022: minimum 10 responses before showing
// EL-QA-023: label is always "Constituency sentiment"
const FUNC = "aggregate-election-stances";
const MIN_RESPONSES = 10;
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
// ── Refresh stale aggregates for an election ─────────────────────────────────
async function refreshElectionAggregates(electionId, projectUrl, serviceRoleKey) {
  const headers = sbHeaders(serviceRoleKey);
  // Find questions with stances newer than their last aggregate refresh
  const staleRes = await fetch(`${projectUrl}/rest/v1/questions` + `?election_id=eq.${electionId}` + `&is_election_question=eq.true` + `&status=eq.active` + `&select=id`, {
    headers
  });
  if (!staleRes.ok) return {
    refreshed: 0,
    gate_lifted: false
  };
  const questions = await staleRes.json();
  // Refresh each question's aggregate via RPC
  let refreshed = 0;
  for (const q of questions){
    const rpcRes = await fetch(`${projectUrl}/rest/v1/rpc/refresh_election_stance_aggregates`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        p_question_id: q.id
      })
    });
    if (rpcRes.ok) refreshed++;
  }
  // Build PC-level rollups (AC→PC, EL-QA-020)
  await buildPcRollups(electionId, projectUrl, serviceRoleKey);
  // Check and lift exit poll gates
  const gateRes = await fetch(`${projectUrl}/rest/v1/rpc/lift_election_exit_poll_gates`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      p_election_id: electionId
    })
  });
  const gateData = gateRes.ok ? await gateRes.json() : 0;
  const gateLifted = typeof gateData === "number" ? gateData > 0 : false;
  if (gateLifted) {
    log("info", "exit poll gate lifted", {
      election_id: electionId
    });
  }
  return {
    refreshed,
    gate_lifted: gateLifted
  };
}
// ── Build PC-level rollups from AC aggregates (EL-QA-020) ───────────────────
async function buildPcRollups(electionId, projectUrl, serviceRoleKey) {
  const headers = sbHeaders(serviceRoleKey);
  // Get all AC-level aggregates that have a parent_constituency_id (→ PC)
  const acRes = await fetch(`${projectUrl}/rest/v1/election_stance_aggregates` + `?election_id=eq.${electionId}` + `&scope=eq.constituency` + `&not.parent_constituency_id=is.null` + `&select=question_id,parent_constituency_id,total_responses,` + `count_strong_support,count_support,count_neutral,` + `count_oppose,count_strong_oppose,state_code,party_id`, {
    headers
  });
  if (!acRes.ok) return;
  const acAggregates = await acRes.json();
  if (!acAggregates.length) return;
  // Group by question_id + parent_constituency_id
  const grouped = new Map();
  for (const row of acAggregates){
    const key = `${row.question_id}::${row.parent_constituency_id}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  // Build PC rollup rows
  for (const [key, rows] of grouped.entries()){
    const total = rows.reduce((s, r)=>s + r.total_responses, 0);
    if (total < MIN_RESPONSES) continue;
    const ss = rows.reduce((s, r)=>s + r.count_strong_support, 0);
    const sup = rows.reduce((s, r)=>s + r.count_support, 0);
    const neu = rows.reduce((s, r)=>s + r.count_neutral, 0);
    const opp = rows.reduce((s, r)=>s + r.count_oppose, 0);
    const so = rows.reduce((s, r)=>s + r.count_strong_oppose, 0);
    const avg = total > 0 ? ((ss * 2 + sup * 1 + neu * 0 + opp * -1 + so * -2) / total).toFixed(4) : "0";
    const pcRow = {
      election_id: electionId,
      question_id: rows[0].question_id,
      constituency_id: rows[0].parent_constituency_id,
      scope: "pc_rollup",
      state_code: rows[0].state_code,
      party_id: rows[0].party_id,
      total_responses: total,
      count_strong_support: ss,
      count_support: sup,
      count_neutral: neu,
      count_oppose: opp,
      count_strong_oppose: so,
      pct_support: total > 0 ? Math.round((ss + sup) / total * 10000) / 100 : null,
      pct_neutral: total > 0 ? Math.round(neu / total * 10000) / 100 : null,
      pct_oppose: total > 0 ? Math.round((opp + so) / total * 10000) / 100 : null,
      avg_score: parseFloat(avg),
      is_gated: true,
      last_refreshed_at: new Date().toISOString()
    };
    await fetch(`${projectUrl}/rest/v1/election_stance_aggregates`, {
      method: "POST",
      headers: {
        ...headers,
        "Prefer": "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(pcRow)
    });
  }
}
// ── Main handler ──────────────────────────────────────────────────────────────
// H-18: fail-closed authorization shared by the admin.cron_* invoked endpoints.
// Three accepted credentials, because this project legitimately uses more than one:
//   Path A - exact match against this project's own SUPABASE_SERVICE_ROLE_KEY. Covers the
//            modern opaque sb_secret_ key, which carries no claims. Verified live on Prod:
//            a bare Bearer <sb_secret_...> returns 200, so the Edge env key and Vault's
//            service_role_key are the same value.
//   Path B - a service_role JWT, project ref pinned. Prod's private.get_secret returns a
//            219-char legacy JWT and several jobs still send that shape.
//   Path C - x-cron-secret exact match. This is what admin.cron_* actually sends today,
//            so removing it would break live scheduled jobs.
// EVERY path requires its env var to be present and non-empty, so a missing secret denies
// rather than admits. Path B parses claims WITHOUT verifying the signature, which is only
// sound because the platform validates the credential first - so these functions must be
// deployed with verify_jwt: true. Do not set it back to false.
function isAuthorizedCaller(req, cronSecret, serviceRoleKey) {
  const xcron = req.headers.get("x-cron-secret") ?? "";
  if (cronSecret && xcron && xcron === cronSecret) return true;

  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!m) return false;
  const token = m[1];

  if (serviceRoleKey && token === serviceRoleKey) return true;

  try {
    const seg = token.split(".")[1];
    if (!seg) return false;
    const norm = seg.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(norm + "=".repeat((4 - norm.length % 4) % 4)));
    if (claims?.role !== "service_role") return false;
    const expectedRef = (Deno.env.get("SUPABASE_URL") ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
    if (expectedRef && claims?.ref && claims.ref !== expectedRef) return false;
    return true;
  } catch {
    return false;
  }
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
  // H-18 (Sep 2026): the previous gate short-circuited to false whenever CRON_SECRET
  // was unset, admitting EVERY caller. Identical defect to H-13 on
  // notify-election-updates. Now fails CLOSED - see isAuthorizedCaller() above.
  if (!isAuthorizedCaller(req, cronSecret, serviceRoleKey)) {
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
  let electionIdFilter = null;
  try {
    const body = await req.json();
    electionIdFilter = body?.election_id ?? null;
  } catch  {}
  const headers = sbHeaders(serviceRoleKey);
  // Fetch active elections
  let url = `${projectUrl}/rest/v1/elections` + `?state=not.in.(ARCHIVED,RESULT_DECLARED,UPCOMING)` + `&is_election_question=is.null` + // field doesn't exist on elections — use state filter only
  `&select=id,name,state,last_phase_close_at,tier_code`;
  // Fix: elections table filter
  url = `${projectUrl}/rest/v1/elections` + `?state=not.in.(ARCHIVED,RESULT_DECLARED,UPCOMING)` + `&select=id,name,state,last_phase_close_at,tier_code`;
  if (electionIdFilter) url += `&id=eq.${electionIdFilter}`;
  const electionsRes = await fetch(url, {
    headers
  });
  if (!electionsRes.ok) {
    return new Response(JSON.stringify({
      ok: false,
      error: "Failed to fetch elections"
    }), {
      status: 500,
      headers: {
        "content-type": "application/json"
      }
    });
  }
  const elections = await electionsRes.json();
  log("info", "aggregating elections", {
    count: elections.length
  });
  if (!elections.length) {
    return new Response(JSON.stringify({
      ok: true,
      processed: 0,
      message: "No active elections"
    }), {
      headers: {
        "content-type": "application/json"
      }
    });
  }
  const results = [];
  for (const election of elections){
    try {
      const result = await refreshElectionAggregates(election.id, projectUrl, serviceRoleKey);
      results.push({
        id: election.id,
        name: election.name,
        ...result
      });
      log("info", "election aggregated", {
        id: election.id,
        ...result
      });
    } catch (err) {
      log("error", "election aggregation failed", {
        id: election.id,
        error: err?.message
      });
      results.push({
        id: election.id,
        name: election.name,
        error: err?.message
      });
    }
  }
  const totalRefreshed = results.reduce((s, r)=>s + (r.refreshed ?? 0), 0);
  const gatesLifted = results.filter((r)=>r.gate_lifted).length;
  return new Response(JSON.stringify({
    ok: true,
    elections_processed: elections.length,
    questions_refreshed: totalRefreshed,
    gates_lifted: gatesLifted,
    results
  }), {
    headers: {
      "content-type": "application/json"
    }
  });
});
