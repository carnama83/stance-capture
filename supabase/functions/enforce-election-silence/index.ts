// supabase/functions/enforce-election-silence/index.ts
//
// Epic EL — Phase EL-6: enforce-election-silence
//
// Called every 15 minutes by pg_cron via admin.cron_enforce_silence().
// Can also be called manually by admin for immediate effect.
//
// For each non-archived election:
//   1. Compute silence_start_at using dual-track India ECI logic:
//        MIN(mcc_start_at, polling_start_at − 48h)
//      Override from election_compliance_rules if SILENCE_OVERRIDE rule exists.
//   2. Compute exit_poll_gate_end:
//        last_phase_close_at + EXIT_POLL_GATE_MINUTES (default 30)
//        Hidden: community aggregates suppressed until this timestamp.
//   3. Advance election state machine based on current UTC time:
//        now >= silence_start_at        → SILENCE  (if currently CAMPAIGN_ACTIVE or MCC_ACTIVE)
//        now >= polling_start_at        → POLLING  (if currently SILENCE)
//        now >= polling_end_at          → COUNTING
//        now >= last_phase_close_at     → POST_ELECTION_RESULT_PENDING
//   4. Stamp silence_start_at on the elections row for fast client queries.
//   5. Write state transitions to election_audit_log.
//
// India ECI dual-track (EL-IN-007):
//   - MCC track:  silence = mcc_start_at (whenever ECI publishes it)
//   - 48h track:  silence = polling_start_at − 48h
//   - Enforced:   MIN of both — whichever comes first
//   - Section 126B methodology note injected into disclosure_text
//
// HTTP 451 enforcement:
//   The client-side stance submission path calls check_election_silence(question_id)
//   before writing to question_stances. This function transitions state — the RPC
//   is the fast-path gate.
//
// QA gates: EL-QA-011, EL-QA-012, EL-QA-013, EL-QA-014, EL-QA-018
const FUNC = "enforce-election-silence";
const DEFAULT_EXIT_POLL_GATE_MINUTES = 30;
const SILENCE_HOURS_DEFAULT = 48;
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
// ── Compute silence start for an election ────────────────────────────────────
function computeSilenceStart(election, rules) {
  if (!election.polling_start_at) return null;
  const pollingStart = new Date(election.polling_start_at);
  // Check for SILENCE_OVERRIDE rule first (takes precedence)
  const silenceOverride = rules.find((r)=>r.rule_type === "SILENCE_OVERRIDE");
  if (silenceOverride) {
    if (silenceOverride.override_start_at) {
      return new Date(silenceOverride.override_start_at);
    }
    if (silenceOverride.silence_hours !== null) {
      return new Date(pollingStart.getTime() - silenceOverride.silence_hours * 60 * 60 * 1000);
    }
  }
  // India ECI dual-track (EL-IN-007)
  const fortyEightHoursBefore = new Date(pollingStart.getTime() - SILENCE_HOURS_DEFAULT * 60 * 60 * 1000);
  // MCC track: use mcc_start_at if set
  const mccRule = rules.find((r)=>r.rule_type === "MCC_DATE_OVERRIDE");
  const mccStart = mccRule?.override_start_at ? new Date(mccRule.override_start_at) : election.mcc_start_at ? new Date(election.mcc_start_at) : null;
  if (mccStart) {
    // MIN(mcc_start_at, polling_start_at − 48h) — whichever is earlier
    return mccStart < fortyEightHoursBefore ? mccStart : fortyEightHoursBefore;
  }
  // No MCC — use 48h track only
  return fortyEightHoursBefore;
}
// ── Determine next state based on current time ───────────────────────────────
function determineNextState(election, silenceStart, exitPollGateMinutes, now) {
  const state = election.state;
  // Already terminal states — don't advance
  if ([
    "RESULT_DECLARED",
    "ARCHIVED",
    "POST_ELECTION_COALITION_FORMING"
  ].includes(state)) {
    return null;
  }
  // Must have legal review before any active state
  if (!election.legal_review_completed) return null;
  const pollingStart = election.polling_start_at ? new Date(election.polling_start_at) : null;
  const pollingEnd = election.polling_end_at ? new Date(election.polling_end_at) : pollingStart;
  const lastPhaseClose = election.last_phase_close_at ? new Date(election.last_phase_close_at) : pollingEnd;
  // POST_ELECTION: last phase closed + exit poll gate elapsed
  if (lastPhaseClose && now >= new Date(lastPhaseClose.getTime() + exitPollGateMinutes * 60 * 1000) && state === "COUNTING") {
    return "POST_ELECTION_RESULT_PENDING";
  }
  // COUNTING: polling has ended
  if (pollingEnd && now >= pollingEnd && state === "POLLING") {
    return "COUNTING";
  }
  // POLLING: polling day has started
  if (pollingStart && now >= pollingStart && state === "SILENCE") {
    return "POLLING";
  }
  // SILENCE: silence window has opened
  if (silenceStart && now >= silenceStart && [
    "CAMPAIGN_ACTIVE",
    "MCC_ACTIVE"
  ].includes(state)) {
    return "SILENCE";
  }
  // MCC_ACTIVE: MCC has started but silence hasn't yet
  const mccStart = election.mcc_start_at ? new Date(election.mcc_start_at) : null;
  if (mccStart && now >= mccStart && silenceStart && now < silenceStart && state === "CAMPAIGN_ACTIVE") {
    return "MCC_ACTIVE";
  }
  return null; // No transition needed
}
// ── Process one election ──────────────────────────────────────────────────────
async function processElection(election, projectUrl, serviceRoleKey, now) {
  const headers = sbHeaders(serviceRoleKey);
  // Fetch active compliance rules
  const rulesRes = await fetch(`${projectUrl}/rest/v1/rpc/get_active_compliance_rules`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      p_election_id: election.id
    })
  });
  const rules = rulesRes.ok ? await rulesRes.json() : [];
  // Compute silence start
  const silenceStart = computeSilenceStart(election, rules);
  // Get exit poll gate minutes from rules or default
  const exitPollRule = rules.find((r)=>r.rule_type === "EXIT_POLL_GATE");
  const exitPollGateMinutes = exitPollRule?.exit_poll_gate_minutes ?? DEFAULT_EXIT_POLL_GATE_MINUTES;
  // Stamp silence_start_at if changed
  const currentSilenceStart = election.silence_start_at ? new Date(election.silence_start_at) : null;
  const silenceStartChanged = silenceStart?.toISOString() !== (currentSilenceStart?.toISOString() ?? null);
  if (silenceStart && silenceStartChanged) {
    await fetch(`${projectUrl}/rest/v1/elections?id=eq.${election.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        silence_start_at: silenceStart.toISOString(),
        // Inject Section 126B methodology note into disclosure_text
        disclosure_text: (election.disclosure_text ?? "") + (election.disclosure_text?.includes("126B") ? "" : "\n\nDuring the silence period, stance submission is suspended in compliance with Section 126B of the Representation of the People Act, 1951.")
      })
    });
    log("info", "silence_start_at stamped", {
      election_id: election.id,
      silence_start: silenceStart.toISOString()
    });
  }
  // Determine state transition
  const nextState = determineNextState(election, silenceStart, exitPollGateMinutes, now);
  if (!nextState) {
    return {
      id: election.id,
      action: "no_change",
      old_state: election.state
    };
  }
  // Apply state transition
  const patchRes = await fetch(`${projectUrl}/rest/v1/elections?id=eq.${election.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      state: nextState,
      state_changed_at: now.toISOString()
    })
  });
  if (!patchRes.ok) {
    const body = await patchRes.text();
    log("error", "state transition failed", {
      election_id: election.id,
      next_state: nextState,
      error: body.slice(0, 300)
    });
    return {
      id: election.id,
      action: "transition_failed",
      old_state: election.state
    };
  }
  // Write audit log
  await fetch(`${projectUrl}/rest/v1/election_audit_log`, {
    method: "POST",
    headers: {
      ...headers,
      "Prefer": "return=minimal"
    },
    body: JSON.stringify({
      election_id: election.id,
      action: `STATE_CHANGED_TO_${nextState}`,
      target_table: "elections",
      target_id: election.id,
      old_value: {
        state: election.state
      },
      new_value: {
        state: nextState,
        silence_start_at: silenceStart?.toISOString() ?? null,
        enforced_by: FUNC,
        now: now.toISOString()
      },
      notes: nextState === "SILENCE" ? `Silence enforced. Track: ${election.mcc_start_at ? "ECI dual-track (MIN of MCC and 48h)" : "48h before polling"}. Legal basis: RPA 1951 §126 / §126B.` : undefined
    })
  });
  log("info", "state transition applied", {
    election_id: election.id,
    election_name: election.name,
    old_state: election.state,
    new_state: nextState
  });
  return {
    id: election.id,
    action: "transitioned",
    old_state: election.state,
    new_state: nextState
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
  // Auth: cron secret or service role
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
  // Optional filter by election_id for manual admin trigger
  let electionIdFilter = null;
  try {
    const body = await req.json();
    electionIdFilter = body?.election_id ?? null;
  } catch  {}
  const headers = sbHeaders(serviceRoleKey);
  const now = new Date();
  // Fetch all non-archived, non-result elections
  let electionsUrl = `${projectUrl}/rest/v1/elections` + `?state=not.in.(ARCHIVED,RESULT_DECLARED)` + `&legal_review_completed=eq.true` + `&select=id,name,tier_code,state,mcc_start_at,silence_start_at,` + `polling_start_at,polling_end_at,last_phase_close_at,` + `campaign_start_at,legal_review_completed,disclosure_text`;
  if (electionIdFilter) {
    electionsUrl += `&id=eq.${electionIdFilter}`;
  }
  const elRes = await fetch(electionsUrl, {
    headers
  });
  if (!elRes.ok) {
    log("error", "fetch elections failed", {
      status: elRes.status
    });
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
  const elections = await elRes.json();
  log("info", "processing elections", {
    count: elections.length,
    now: now.toISOString()
  });
  if (!elections.length) {
    return new Response(JSON.stringify({
      ok: true,
      processed: 0,
      message: "No active elections to process"
    }), {
      headers: {
        "content-type": "application/json"
      }
    });
  }
  const results = await Promise.all(elections.map((e)=>processElection(e, projectUrl, serviceRoleKey, now)));
  const transitioned = results.filter((r)=>r.action === "transitioned");
  const silenced = transitioned.filter((r)=>r.new_state === "SILENCE");
  return new Response(JSON.stringify({
    ok: true,
    processed: elections.length,
    transitioned: transitioned.length,
    silenced: silenced.length,
    results,
    ts: now.toISOString()
  }), {
    headers: {
      "content-type": "application/json"
    }
  });
});
