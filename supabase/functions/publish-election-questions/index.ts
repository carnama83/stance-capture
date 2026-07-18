// supabase/functions/publish-election-questions/index.ts
//
// Epic EL — Phase EL-5: publish-election-questions
//
// Called by admin when approving question drafts in the Review Queue.
// Promotes approved election_question_drafts into the live questions table
// with full party branding, constituency geo-targeting, and attribution.
//
// Request body:
//   { draft_ids: string[], election_id: string }
//   or { draft_id: string, election_id: string }  (single)
//
// For each approved draft:
//   1. Validate draft is in APPROVED status
//   2. Validate election is not in SILENCE state (HTTP 451 if so)
//   3. Build questions row with all election attribution columns
//   4. Insert into questions table
//   5. Write to election_audit_log
//   6. Update draft: mark published_question_id
//
// Compliance:
//   - Word "poll" must NOT appear in question text (EL-QA-021)
//   - Disclosure text injected from election record
//   - EL-QA-G01: Lok Sabha cards frame around MP candidate, not PM
//   - EL-QA-G13: No express advocacy language (Vote for / Support / Elect)
const FUNC = "publish-election-questions";
const EXPRESS_ADVOCACY_PATTERNS = [
  /\bvote for\b/i,
  /\bvote against\b/i,
  /\bsupport\s+(the\s+)?(party|candidate|BJP|SP|BSP|INC|AAP|NDA|INDIA bloc)\b/i,
  /\belect\b/i,
  /\bdo not elect\b/i,
  /\bpoll\b/i
];
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
function checkExpressAdvocacy(text) {
  for (const pattern of EXPRESS_ADVOCACY_PATTERNS){
    if (pattern.test(text)) {
      return `Forbidden language detected matching pattern: ${pattern.toString()}`;
    }
  }
  return null;
}
async function publishDraft(draftId, electionId, projectUrl, serviceRoleKey, actorJwt) {
  const headers = sbHeaders(serviceRoleKey);
  // Fetch draft with all joins
  const draftRes = await fetch(`${projectUrl}/rest/v1/election_question_drafts?id=eq.${draftId}&select=*`, {
    headers
  });
  const drafts = await draftRes.json();
  if (!drafts.length) return {
    question_id: null,
    error: "Draft not found"
  };
  const draft = drafts[0];
  if (draft.status !== "APPROVED") {
    return {
      question_id: null,
      error: `Draft status is ${draft.status}, must be APPROVED`
    };
  }
  // Fetch election
  const elRes = await fetch(`${projectUrl}/rest/v1/elections?id=eq.${electionId}&select=*`, {
    headers
  });
  const elections = await elRes.json();
  if (!elections.length) return {
    question_id: null,
    error: "Election not found"
  };
  const election = elections[0];
  // Block if SILENCE state
  if (election.state === "SILENCE") {
    return {
      question_id: null,
      error: "HTTP 451 — Election is in SILENCE state. Publishing blocked."
    };
  }
  // Express advocacy check (EL-QA-021, EL-QA-G13)
  const advocacyError = checkExpressAdvocacy(draft.question);
  if (advocacyError) {
    return {
      question_id: null,
      error: `Compliance check failed: ${advocacyError}`
    };
  }
  if (draft.context_summary) {
    const ctxError = checkExpressAdvocacy(draft.context_summary);
    if (ctxError) {
      return {
        question_id: null,
        error: `Context compliance check failed: ${ctxError}`
      };
    }
  }
  // Fetch party details if party-attributed
  let partyColour = null;
  let partyAbbreviation = null;
  if (draft.party_id) {
    const partyRes = await fetch(`${projectUrl}/rest/v1/election_parties?id=eq.${draft.party_id}&select=abbreviation,brand_colour`, {
      headers
    });
    const parties = await partyRes.json();
    if (parties.length) {
      partyColour = parties[0].brand_colour;
      partyAbbreviation = parties[0].abbreviation;
    }
  }
  // Fetch candidate name if candidate-attributed
  let candidateName = null;
  if (draft.candidate_id) {
    const candRes = await fetch(`${projectUrl}/rest/v1/election_candidates?id=eq.${draft.candidate_id}&select=full_name`, {
      headers
    });
    const cands = await candRes.json();
    if (cands.length) candidateName = cands[0].full_name;
  }
  // Fetch constituency name
  let constituencyName = null;
  if (draft.constituency_id) {
    const conRes = await fetch(`${projectUrl}/rest/v1/election_constituencies?id=eq.${draft.constituency_id}&select=name`, {
      headers
    });
    const cons = await conRes.json();
    if (cons.length) constituencyName = cons[0].name;
  }
  // Determine topic_id: use a designated "Elections" topic or create one
  // For now use the election's governing_body_code as a tag; topic_id required by questions table
  // We'll use a sentinel approach: look for existing elections topic
  const topicRes = await fetch(`${projectUrl}/rest/v1/topics?title=eq.Elections&select=id&limit=1`, {
    headers
  });
  const topics = await topicRes.json();
  let topicId = topics[0]?.id ?? null;
  if (!topicId) {
    // Create a placeholder Elections topic
    const createTopicRes = await fetch(`${projectUrl}/rest/v1/topics`, {
      method: "POST",
      headers: {
        ...headers,
        "Prefer": "return=representation"
      },
      body: JSON.stringify({
        title: "Elections",
        description: "Election Intelligence — Epic EL",
        status: "approved",
        tags: [
          "election",
          "politics"
        ],
        tier: "country"
      })
    });
    if (createTopicRes.ok) {
      const created = await createTopicRes.json();
      topicId = created[0]?.id ?? null;
    }
  }
  if (!topicId) {
    return {
      question_id: null,
      error: "Could not resolve Elections topic_id"
    };
  }
  // Build question payload
  const disclosureText = election.disclosure_text ?? "Stance Capture is a neutral civic intelligence platform. Not affiliated with any political party.";
  const questionPayload = {
    topic_id: topicId,
    question: draft.question,
    summary: draft.context_summary,
    tags: [
      "election",
      election.tier_code.toLowerCase(),
      draft.election_issue_tag ?? ""
    ].filter(Boolean),
    status: "active",
    state: "new",
    tier: "state",
    framing_type: "tradeoff",
    framing_style: draft.framing_style,
    slider_low_label: draft.slider_low_label ?? "Strongly disagree",
    slider_high_label: draft.slider_high_label ?? "Strongly agree",
    // Election attribution
    election_id: electionId,
    election_draft_id: draft.id,
    election_party_id: draft.party_id ?? null,
    election_candidate_id: draft.candidate_id ?? null,
    election_constituency_id: draft.constituency_id ?? null,
    is_election_question: true,
    election_issue_tag: draft.issue_tag,
    election_framing_style: draft.framing_style,
    election_disclosure_text: disclosureText,
    election_party_colour: partyColour,
    election_party_abbreviation: partyAbbreviation,
    election_candidate_name: candidateName,
    election_constituency_name: constituencyName,
    election_question_type: draft.question_type,
    published_at: new Date().toISOString()
  };
  // Insert into questions
  const insertRes = await fetch(`${projectUrl}/rest/v1/questions`, {
    method: "POST",
    headers: {
      ...headers,
      "Prefer": "return=representation"
    },
    body: JSON.stringify(questionPayload)
  });
  if (!insertRes.ok) {
    const body = await insertRes.json().catch(()=>({}));
    return {
      question_id: null,
      error: body?.message ?? `HTTP ${insertRes.status}`
    };
  }
  const created = await insertRes.json();
  const questionId = created[0]?.id;
  // Write audit log
  await fetch(`${projectUrl}/rest/v1/rpc/write_audit_log`, {
    method: "POST",
    headers: {
      ...headers,
      "Authorization": `Bearer ${actorJwt}`
    },
    body: JSON.stringify({
      p_election_id: electionId,
      p_action: "QUESTION_PUBLISHED",
      p_target_table: "questions",
      p_target_id: questionId,
      p_new_value: {
        draft_id: draft.id,
        question: draft.question.slice(0, 200)
      }
    })
  });
  log("info", "published", {
    draft_id: draftId,
    question_id: questionId
  });
  return {
    question_id: questionId,
    error: null
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
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const projectUrl = (Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
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
  // Auth: require bearer token (admin JWT)
  const actorJwt = req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
  if (!actorJwt) {
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
  let body;
  try {
    body = await req.json();
  } catch  {
    return new Response(JSON.stringify({
      ok: false,
      error: "Invalid JSON body"
    }), {
      status: 400,
      headers: {
        "content-type": "application/json"
      }
    });
  }
  const electionId = body.election_id;
  const draftIds = body.draft_ids ?? (body.draft_id ? [
    body.draft_id
  ] : []);
  if (!electionId || !draftIds.length) {
    return new Response(JSON.stringify({
      ok: false,
      error: "election_id and draft_ids required"
    }), {
      status: 400,
      headers: {
        "content-type": "application/json"
      }
    });
  }
  const results = await Promise.all(draftIds.map((id)=>publishDraft(id, electionId, projectUrl, serviceRoleKey, actorJwt)));
  const succeeded = results.filter((r)=>r.question_id).length;
  const failed = results.filter((r)=>r.error).length;
  // If any election was in SILENCE → return 451
  const silenceBlocked = results.some((r)=>r.error?.includes("451"));
  if (silenceBlocked) {
    return new Response(JSON.stringify({
      ok: false,
      error: "HTTP 451 — Election silence period active. Publishing blocked.",
      results
    }), {
      status: 451,
      headers: {
        "content-type": "application/json"
      }
    });
  }
  return new Response(JSON.stringify({
    ok: true,
    succeeded,
    failed,
    results
  }), {
    headers: {
      "content-type": "application/json"
    }
  });
});
