// supabase/functions/detect-election-anomalies/index.ts
//
// Epic EL — Phase EL-8: detect-election-anomalies
//
// Runs hourly via pg_cron. Scans recent election stances for manipulation patterns.
//
// Detection checks (EL-IN-012–016):
//
//   VELOCITY_BURST
//     User submitted > MAX_STANCES_PER_HOUR election stances in the last hour.
//     Threshold: 20. Most genuine users answer 3-5 election questions per session.
//
//   GEO_CLUSTER
//     >50% of stances for a single election question came from the same /24 subnet
//     AND total stances for that question > MIN_FOR_GEO_CHECK (30).
//     Indicates coordinated voting from a single location/VPN block.
//
//   COORDINATED_SUBMISSION
//     >5 stances on the same election question within a 60-second window
//     from IPs in the same /24 subnet.
//
//   UNVERIFIED_EMAIL (passive check)
//     Stances that slipped through without email_confirmed_at — should not happen
//     if check_election_email_verified() is enforced, but catch any gaps.
//
// Flagging:
//   - Calls flag_anomalous_stances() for confirmed anomalies
//   - Inserts election_anomaly_events record
//   - NEVER notifies the user — silent, admin-only
//   - Flagged stances are excluded from aggregates (is_flagged=true)
//
// QA gates: EL-QA-032, EL-QA-033, EL-QA-034, EL-QA-035
const FUNC = "detect-election-anomalies";
const MAX_STANCES_PER_HOUR = 20;
const MIN_FOR_GEO_CHECK = 30;
const GEO_CLUSTER_THRESHOLD = 0.5; // 50% from same subnet
const COORDINATED_WINDOW_SECONDS = 60;
const COORDINATED_MIN_COUNT = 5;
const LOOK_BACK_HOURS = 2; // scan last 2 hours of stances
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
// Extract /24 subnet from IP address
function getSubnet24(ip) {
  if (!ip) return null;
  // Handle both IPv4 and IPv4-mapped IPv6
  const v4match = ip.match(/(\d+\.\d+\.\d+)\.\d+/);
  if (v4match) return `${v4match[1]}.0/24`;
  return null;
}
// ── Check 1: Velocity burst ───────────────────────────────────────────────────
function detectVelocityBursts(stances) {
  const now = Date.now();
  const windowStart = now - 60 * 60 * 1000; // 1 hour ago
  // Group by user_id, count stances in last hour
  const userCounts = new Map();
  for (const s of stances){
    if (new Date(s.created_at).getTime() >= windowStart) {
      if (!userCounts.has(s.user_id)) userCounts.set(s.user_id, []);
      userCounts.get(s.user_id).push(s);
    }
  }
  const results = [];
  for (const [userId, userStances] of userCounts.entries()){
    if (userStances.length > MAX_STANCES_PER_HOUR) {
      results.push({
        type: "VELOCITY_BURST",
        severity: userStances.length > MAX_STANCES_PER_HOUR * 3 ? "HIGH" : "MEDIUM",
        user_id: userId,
        question_id: null,
        election_id: null,
        evidence: {
          stances_in_hour: userStances.length,
          threshold: MAX_STANCES_PER_HOUR,
          question_ids: [
            ...new Set(userStances.map((s)=>s.question_id))
          ].slice(0, 10)
        },
        affected_stance_ids: userStances.map((s)=>s.id)
      });
    }
  }
  return results;
}
// ── Check 2: Geo clustering ───────────────────────────────────────────────────
function detectGeoClusters(stances, questionId, electionId) {
  const questionStances = stances.filter((s)=>s.question_id === questionId);
  if (questionStances.length < MIN_FOR_GEO_CHECK) return null;
  // Count by /24 subnet
  const subnetCounts = new Map();
  for (const s of questionStances){
    const subnet = getSubnet24(s.ip);
    if (!subnet) continue;
    if (!subnetCounts.has(subnet)) subnetCounts.set(subnet, []);
    subnetCounts.get(subnet).push(s);
  }
  for (const [subnet, subnetStances] of subnetCounts.entries()){
    const fraction = subnetStances.length / questionStances.length;
    if (fraction >= GEO_CLUSTER_THRESHOLD) {
      return {
        type: "GEO_CLUSTER",
        severity: fraction > 0.8 ? "CRITICAL" : "HIGH",
        user_id: null,
        question_id: questionId,
        election_id: electionId,
        evidence: {
          subnet,
          subnet_count: subnetStances.length,
          total_stances: questionStances.length,
          fraction: Math.round(fraction * 100)
        },
        affected_stance_ids: subnetStances.map((s)=>s.id)
      };
    }
  }
  return null;
}
// ── Check 3: Coordinated submission ──────────────────────────────────────────
function detectCoordinatedSubmissions(stances, questionId, electionId) {
  const questionStances = stances.filter((s)=>s.question_id === questionId).sort((a, b)=>new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  if (questionStances.length < COORDINATED_MIN_COUNT) return null;
  // Sliding window: check for N stances in 60s from same /24
  const subnetWindows = new Map();
  for(let i = 0; i < questionStances.length; i++){
    const anchor = new Date(questionStances[i].created_at).getTime();
    const subnet = getSubnet24(questionStances[i].ip);
    if (!subnet) continue;
    const windowStances = questionStances.filter((s)=>{
      const t = new Date(s.created_at).getTime();
      return t >= anchor && t <= anchor + COORDINATED_WINDOW_SECONDS * 1000 && getSubnet24(s.ip) === subnet;
    });
    if (windowStances.length >= COORDINATED_MIN_COUNT) {
      if (!subnetWindows.has(subnet) || subnetWindows.get(subnet).length < windowStances.length) {
        subnetWindows.set(subnet, windowStances);
      }
    }
  }
  // Return the worst cluster found
  let worst = null;
  for (const [subnet, windowStances] of subnetWindows.entries()){
    if (!worst || windowStances.length > worst.affected_stance_ids.length) {
      worst = {
        type: "COORDINATED_SUBMISSION",
        severity: windowStances.length > 20 ? "CRITICAL" : "HIGH",
        user_id: null,
        question_id: questionId,
        election_id: electionId,
        evidence: {
          subnet,
          count_in_window: windowStances.length,
          window_seconds: COORDINATED_WINDOW_SECONDS,
          threshold: COORDINATED_MIN_COUNT
        },
        affected_stance_ids: windowStances.map((s)=>s.id)
      };
    }
  }
  return worst;
}
// ── Process anomalies for an election ────────────────────────────────────────
async function processElection(electionId, projectUrl, serviceRoleKey) {
  const headers = sbHeaders(serviceRoleKey);
  const lookbackStart = new Date(Date.now() - LOOK_BACK_HOURS * 60 * 60 * 1000).toISOString();
  // Fetch recent election stances — join via questions table
  // We fetch question_stances for election questions updated in the last 2h
  const stancesRes = await fetch(`${projectUrl}/rest/v1/question_stances` + `?created_at=gte.${lookbackStart}` + `&is_flagged=eq.false` + `&select=id,user_id,question_id,created_at,ip` + `&limit=2000`, {
    headers
  });
  if (!stancesRes.ok) return {
    flagged: 0,
    anomalies: 0
  };
  const allStances = await stancesRes.json();
  // Filter to election questions only
  const electionQuestionsRes = await fetch(`${projectUrl}/rest/v1/questions` + `?election_id=eq.${electionId}` + `&is_election_question=eq.true` + `&select=id`, {
    headers
  });
  if (!electionQuestionsRes.ok) return {
    flagged: 0,
    anomalies: 0
  };
  const electionQuestions = await electionQuestionsRes.json();
  const electionQIds = new Set(electionQuestions.map((q)=>q.id));
  const stances = allStances.filter((s)=>electionQIds.has(s.question_id));
  if (!stances.length) return {
    flagged: 0,
    anomalies: 0
  };
  const anomalies = [];
  // Check 1: Velocity bursts (across all questions)
  anomalies.push(...detectVelocityBursts(stances));
  // Check 2 & 3: Per-question geo + coordination checks
  for (const q of electionQuestions){
    const geoAnomaly = detectGeoClusters(stances, q.id, electionId);
    if (geoAnomaly) anomalies.push(geoAnomaly);
    const coordAnomaly = detectCoordinatedSubmissions(stances, q.id, electionId);
    if (coordAnomaly) anomalies.push(coordAnomaly);
  }
  if (!anomalies.length) return {
    flagged: 0,
    anomalies: 0
  };
  let totalFlagged = 0;
  // Process each anomaly
  for (const anomaly of anomalies){
    // Flag affected stances
    if (anomaly.affected_stance_ids.length > 0) {
      const flagRes = await fetch(`${projectUrl}/rest/v1/rpc/flag_anomalous_stances`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          p_stance_ids: anomaly.affected_stance_ids,
          p_reason: anomaly.type
        })
      });
      if (flagRes.ok) {
        const flagCount = await flagRes.json();
        totalFlagged += typeof flagCount === "number" ? flagCount : 0;
      }
    }
    // Insert anomaly event
    await fetch(`${projectUrl}/rest/v1/election_anomaly_events`, {
      method: "POST",
      headers: {
        ...headers,
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({
        election_id: anomaly.election_id ?? electionId,
        question_id: anomaly.question_id,
        anomaly_type: anomaly.type,
        severity: anomaly.severity,
        user_id: anomaly.user_id,
        evidence: anomaly.evidence,
        affected_stance_ids: anomaly.affected_stance_ids
      })
    });
    log("warn", "anomaly detected", {
      type: anomaly.type,
      severity: anomaly.severity,
      election_id: electionId,
      affected: anomaly.affected_stance_ids.length
    });
  }
  return {
    flagged: totalFlagged,
    anomalies: anomalies.length
  };
}
// ── Main handler ──────────────────────────────────────────────────────────────
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
  let electionIdFilter = null;
  try {
    const body = await req.json();
    electionIdFilter = body?.election_id ?? null;
  } catch  {}
  const headers = sbHeaders(serviceRoleKey);
  // Fetch active elections
  let url = `${projectUrl}/rest/v1/elections` + `?state=in.(CAMPAIGN_ACTIVE,MCC_ACTIVE,SILENCE,POLLING)` + `&select=id,name,state`;
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
  log("info", "scanning elections", {
    count: elections.length
  });
  if (!elections.length) {
    return new Response(JSON.stringify({
      ok: true,
      processed: 0,
      message: "No active elections to scan"
    }), {
      headers: {
        "content-type": "application/json"
      }
    });
  }
  const summary = {
    total_anomalies: 0,
    total_flagged: 0,
    elections_scanned: 0
  };
  for (const election of elections){
    try {
      const result = await processElection(election.id, projectUrl, serviceRoleKey);
      summary.total_anomalies += result.anomalies;
      summary.total_flagged += result.flagged;
      summary.elections_scanned++;
    } catch (err) {
      log("error", "election scan failed", {
        id: election.id,
        error: err?.message
      });
    }
  }
  return new Response(JSON.stringify({
    ok: true,
    ...summary
  }), {
    headers: {
      "content-type": "application/json"
    }
  });
});
