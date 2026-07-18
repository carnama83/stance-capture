// supabase/functions/generate-party-policy-questions/index.ts
//
// Epic EL — Phase EL-4: generate-party-policy-questions
//
// Trigger: called after translation_status = DONE on party-level documents
//          (documents where party_id IS NOT NULL, candidate_id IS NULL)
//
// For each eligible document:
//   1. Fetch document text (extracted_text_en), party details, election tier
//   2. Fetch allowed issue tags for this tier
//   3. Call GPT-4o-mini with party policy prompt (one of 8 framing styles)
//   4. Generate QUESTIONS_PER_DOC question drafts attributed to party
//   5. Run duplicate check against existing drafts for this election
//   6. Insert into question_drafts (ai_question_drafts table) as DRAFT state
//   7. Update document ai_processing_status = DONE + count
//
// Key principles (from plan):
//   - Decision #4 RESOLVED: Paraphrase with source attribution (no verbatim)
//   - "Ask users to reveal the principle behind the action, not choose an action"
//   - Eight framing styles: value_tradeoff, risk_vs_risk, boundary_line,
//     trust_authority, future_consequence, moral_consistency,
//     personal_stake, evidence_threshold
//   - Questions attributed to party_id, candidate_id=null
//   - Confidence score 0.0–1.0 on each draft
//   - Contradiction detection across documents per candidate/party
//
// EL-QA-P06: party manifesto → questions have party_id=<id>, candidate_id=null
// EL-QA-P10: contradiction flag raised for contradictory positions
// EL-QA-P11: low confidence score (0.4) shows amber flag in review queue
const FUNC = "generate-party-policy-questions";
const QUESTIONS_PER_DOC = 5;
const MAX_TOKENS = 2000;
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
// ── Framing styles ────────────────────────────────────────────────────────────
const FRAMING_STYLES = [
  "value_tradeoff",
  "risk_vs_risk",
  "boundary_line",
  "trust_authority",
  "future_consequence",
  "moral_consistency",
  "personal_stake",
  "evidence_threshold"
];
const FRAMING_INSTRUCTIONS = {
  value_tradeoff: "Frame as a tension between two genuine values both sides care about. Neither option is clearly wrong. Example: 'When government farm support helps some farmers but raises prices for urban buyers, whose interest should take priority?'",
  risk_vs_risk: "Frame as a choice between two types of risk or harm. Example: 'If cracking down on illegal mining creates unemployment but allowing it damages rivers, which risk is more acceptable?'",
  boundary_line: "Frame as where a limit should be drawn. Example: 'At what point, if any, should the government override private land rights for infrastructure development?'",
  trust_authority: "Frame as how much trust or power a specific institution deserves. Example: 'Should police be given more discretion in cognisable offences, or should judicial oversight increase?'",
  future_consequence: "Frame around a long-term outcome. Example: 'If free electricity benefits households today but strains the state grid in 10 years, is that an acceptable trade?'",
  moral_consistency: "Frame as whether a position is applied consistently. Example: 'Should the same anti-corruption standards apply to governing party MLAs as to opposition leaders?'",
  personal_stake: "Frame in terms of how the issue affects someone's own life or community. Example: 'If your area loses its reserved constituency seat in delimitation, how much weight should local sentiment carry?'",
  evidence_threshold: "Frame as how much evidence is needed before acting. Example: 'How certain should the government be about economic benefits before approving a large infrastructure project?'"
};
// ── System prompt builder ─────────────────────────────────────────────────────
function buildSystemPrompt(partyName, partyAbbreviation, tierCode, allowedTags, framingStyle) {
  const tierLabel = tierCode === "IN_VIDHAN_SABHA" ? "state assembly (Vidhan Sabha)" : tierCode;
  return `You are a civic intelligence platform generating neutral, structured stance questions about political party positions for ${tierLabel} elections in India.

PARTY: ${partyName} (${partyAbbreviation})
FRAMING STYLE: ${framingStyle}
FRAMING INSTRUCTION: ${FRAMING_INSTRUCTIONS[framingStyle]}

ALLOWED ISSUE TAGS (assign only from this list): ${allowedTags.join(", ")}

CORE PRINCIPLES — MANDATORY:
1. Do NOT ask users to choose an action. Ask them to reveal the PRINCIPLE behind the action.
2. Paraphrase all policy positions from the source document. NEVER quote verbatim. Include source attribution in the context field only.
3. Questions must be neutral. Do not imply the party's position is correct or incorrect.
4. Do not mention the party by name in the question text itself — the party attribution is stored separately.
5. Questions must be specific to the policy described, not generic.
6. Questions must make sense to a voter in Uttar Pradesh, India.

QUESTION FORMAT — respond with a JSON array only, no other text:
[
  {
    "question": "<the stance question — 1-2 sentences, ends with a question mark>",
    "context": "<2-3 sentence paraphrase of the party's stated position with source attribution — e.g. 'Based on the party manifesto, ${partyAbbreviation} proposes...'>",
    "issue_tag": "<one tag from the allowed list>",
    "framing_style": "${framingStyle}",
    "confidence_score": <float 0.0-1.0; lower if ambiguous or generic>,
    "slider_low_label": "<label for -2 end of slider, e.g. 'Strongly disagree'>",
    "slider_high_label": "<label for +2 end of slider, e.g. 'Strongly agree'>",
    "potential_contradiction": <true if this position may contradict another in the document, false otherwise>
  }
]

Generate exactly ${QUESTIONS_PER_DOC} questions. Each must use a DIFFERENT issue tag if possible.`;
}
// ── Call OpenAI ───────────────────────────────────────────────────────────────
async function generateQuestions(openaiKey, systemPrompt, documentText) {
  // Truncate document to ~12k tokens (48k chars)
  const truncated = documentText.slice(0, 48_000);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openaiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: MAX_TOKENS,
      temperature: 0.7,
      response_format: {
        type: "json_object"
      },
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: `Here is the party document to generate questions from:\n\n${truncated}\n\nRespond with a JSON object containing a "questions" array.`
        }
      ]
    })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI failed: ${res.status} — ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(content);
    const questions = Array.isArray(parsed) ? parsed : parsed.questions ?? [];
    return questions.slice(0, QUESTIONS_PER_DOC);
  } catch  {
    throw new Error(`Failed to parse GPT response: ${content.slice(0, 200)}`);
  }
}
// ── Duplicate check ───────────────────────────────────────────────────────────
async function isDuplicate(projectUrl, headers, electionId, questionText) {
  // Simple substring check: if any existing draft for this election
  // contains more than 60% of the same words, flag as duplicate
  const res = await fetch(`${projectUrl}/rest/v1/ai_question_drafts?election_id=eq.${electionId}&select=question&limit=200`, {
    headers
  });
  if (!res.ok) return false;
  const existing = await res.json();
  const newWords = new Set(questionText.toLowerCase().split(/\s+/).filter((w)=>w.length > 3));
  for (const ex of existing){
    const exWords = new Set(ex.question.toLowerCase().split(/\s+/).filter((w)=>w.length > 3));
    const overlap = [
      ...newWords
    ].filter((w)=>exWords.has(w)).length;
    if (overlap / newWords.size > 0.6) return true;
  }
  return false;
}
// ── Process one document ──────────────────────────────────────────────────────
async function processDocument(doc, party, tier_code, allowedTags, openaiKey, projectUrl, serviceRoleKey) {
  const headers = sbHeaders(serviceRoleKey);
  // Mark in progress
  await fetch(`${projectUrl}/rest/v1/election_source_documents?id=eq.${doc.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      ai_processing_status: "IN_PROGRESS",
      ai_processing_started_at: new Date().toISOString()
    })
  });
  // Pick framing style (rotate through styles based on doc index)
  const styleIndex = Math.floor(Math.random() * FRAMING_STYLES.length);
  const framingStyle = FRAMING_STYLES[styleIndex];
  const systemPrompt = buildSystemPrompt(party.name, party.abbreviation, tier_code, allowedTags, framingStyle);
  const questions = await generateQuestions(openaiKey, systemPrompt, doc.extracted_text_en);
  let inserted = 0;
  let duplicates = 0;
  let contradictions = 0;
  for (const q of questions){
    // Duplicate check
    const dup = await isDuplicate(projectUrl, headers, doc.election_id, q.question);
    if (dup) {
      duplicates++;
      continue;
    }
    if (q.potential_contradiction) contradictions++;
    // Insert draft
    const draft = {
      election_id: doc.election_id,
      source_document_id: doc.id,
      party_id: doc.party_id,
      candidate_id: null,
      question: q.question,
      context_summary: q.context,
      issue_tag: q.issue_tag,
      framing_style: q.framing_style,
      confidence_score: Math.min(1, Math.max(0, q.confidence_score ?? 0.7)),
      slider_low_label: q.slider_low_label ?? "Strongly disagree",
      slider_high_label: q.slider_high_label ?? "Strongly agree",
      potential_contradiction: q.potential_contradiction ?? false,
      status: "DRAFT",
      question_type: "PARTY_POLICY",
      created_at: new Date().toISOString()
    };
    const insertRes = await fetch(`${projectUrl}/rest/v1/election_question_drafts`, {
      method: "POST",
      headers: {
        ...headers,
        "Prefer": "return=minimal"
      },
      body: JSON.stringify(draft)
    });
    if (insertRes.ok) inserted++;
    else {
      const err = await insertRes.json().catch(()=>({}));
      log("warn", "draft insert failed", {
        question: q.question.slice(0, 80),
        err
      });
    }
  }
  // Mark document done
  await fetch(`${projectUrl}/rest/v1/election_source_documents?id=eq.${doc.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      ai_processing_status: "DONE",
      ai_processing_completed_at: new Date().toISOString(),
      ai_question_drafts_count: inserted
    })
  });
  return {
    inserted,
    duplicates,
    contradictions
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
  const incoming = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
  if (cronSecret && incoming !== cronSecret) {
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
  const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const projectUrl = (Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  if (!openaiKey || !serviceRoleKey || !projectUrl) {
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
  let documentIdFilter = null;
  try {
    const body = await req.json();
    electionIdFilter = body?.election_id ?? null;
    documentIdFilter = body?.document_id ?? null;
  } catch  {}
  const headers = sbHeaders(serviceRoleKey);
  // Fetch eligible party-level documents
  let docsUrl = `${projectUrl}/rest/v1/election_source_documents?translation_status=in.(DONE,NOT_NEEDED)&ai_processing_status=eq.PENDING&is_active=eq.true&not.party_id=is.null&select=id,election_id,party_id,extracted_text_en&limit=5`;
  if (electionIdFilter) docsUrl += `&election_id=eq.${electionIdFilter}`;
  if (documentIdFilter) docsUrl += `&id=eq.${documentIdFilter}`;
  const docsRes = await fetch(docsUrl, {
    headers
  });
  if (!docsRes.ok) {
    return new Response(JSON.stringify({
      ok: false,
      error: "Failed to fetch documents"
    }), {
      status: 500,
      headers: {
        "content-type": "application/json"
      }
    });
  }
  const docs = await docsRes.json();
  log("info", "processing party docs", {
    count: docs.length
  });
  if (!docs.length) {
    return new Response(JSON.stringify({
      ok: true,
      processed: 0,
      message: "No eligible documents"
    }), {
      headers: {
        "content-type": "application/json"
      }
    });
  }
  const summary = {
    processed: 0,
    total_inserted: 0,
    total_duplicates: 0,
    total_contradictions: 0,
    errors: []
  };
  for (const doc of docs){
    try {
      // Fetch party details
      const partyRes = await fetch(`${projectUrl}/rest/v1/election_parties?id=eq.${doc.party_id}&select=id,name,abbreviation,brand_colour`, {
        headers
      });
      const parties = await partyRes.json();
      if (!parties.length) throw new Error(`Party not found: ${doc.party_id}`);
      const party = parties[0];
      // Fetch election tier
      const elRes = await fetch(`${projectUrl}/rest/v1/elections?id=eq.${doc.election_id}&select=tier_code`, {
        headers
      });
      const elections = await elRes.json();
      if (!elections.length) throw new Error(`Election not found: ${doc.election_id}`);
      const tierCode = elections[0].tier_code;
      // Fetch allowed tags
      const tagsRes = await fetch(`${projectUrl}/rest/v1/rpc/get_issue_tags_for_tier`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          p_tier_code: tierCode
        })
      });
      const tags = await tagsRes.json();
      const allowedTags = tags.map((t)=>t.tag);
      if (!allowedTags.length) throw new Error(`No issue tags for tier: ${tierCode}`);
      const result = await processDocument(doc, party, tierCode, allowedTags, openaiKey, projectUrl, serviceRoleKey);
      summary.processed++;
      summary.total_inserted += result.inserted;
      summary.total_duplicates += result.duplicates;
      summary.total_contradictions += result.contradictions;
      log("info", "doc done", {
        doc_id: doc.id,
        ...result
      });
    } catch (err) {
      const msg = String(err?.message ?? err);
      log("error", "doc failed", {
        doc_id: doc.id,
        error: msg
      });
      summary.errors.push(`${doc.id}: ${msg}`);
      // Mark failed
      await fetch(`${projectUrl}/rest/v1/election_source_documents?id=eq.${doc.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          ai_processing_status: "FAILED",
          ai_processing_error: msg.slice(0, 500)
        })
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
