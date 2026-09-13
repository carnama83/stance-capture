// supabase/functions/generate-candidate-statement-questions/index.ts
//
// Epic EL — Phase EL-4: generate-candidate-statement-questions
//
// Like generate-party-policy-questions but for candidate-level documents.
// Key difference: questions are scoped to the candidate's single constituency.
//
// EL-QA-P07: Candidate speech → questions scoped to single constituency only
// EL-QA-P08: Non-English document already translated by detect-and-translate
// EL-QA-P10: Contradiction detection across documents for same candidate
const FUNC = "generate-candidate-statement-questions";
const QUESTIONS_PER_DOC = 3; // fewer than party — candidates have narrower scope
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
  value_tradeoff: "Frame as a tension between two genuine values. Neither option is clearly wrong.",
  risk_vs_risk: "Frame as a choice between two types of risk or harm.",
  boundary_line: "Frame as where a limit or threshold should be drawn.",
  trust_authority: "Frame as how much trust or power a specific institution or person deserves.",
  future_consequence: "Frame around a long-term outcome or trade-off over time.",
  moral_consistency: "Frame as whether a position is applied consistently across groups.",
  personal_stake: "Frame in terms of how the issue affects someone's own life or community.",
  evidence_threshold: "Frame as how much evidence is needed before taking action or making a judgment."
};
function buildCandidateSystemPrompt(candidateName, partyAbbreviation, constituencyName, tierCode, allowedTags, framingStyle) {
  const tier = tierCode === "IN_VIDHAN_SABHA" ? "Vidhan Sabha (state assembly)" : tierCode;
  return `You are a civic intelligence platform generating neutral stance questions about candidate positions for a ${tier} election in India.

CANDIDATE: ${candidateName}${partyAbbreviation ? ` (${partyAbbreviation})` : " (Independent)"}
CONSTITUENCY: ${constituencyName}
FRAMING STYLE: ${framingStyle}
FRAMING INSTRUCTION: ${FRAMING_INSTRUCTIONS[framingStyle]}
ALLOWED ISSUE TAGS: ${allowedTags.join(", ")}

MANDATORY RULES:
1. Questions must be scoped to issues relevant to ${constituencyName} constituency specifically.
2. Do NOT ask users to choose an action. Ask them to reveal the PRINCIPLE behind the action.
3. Paraphrase all positions. NEVER quote the candidate verbatim. Include "Based on statements by [candidate]" in context field only.
4. Questions must be neutral — do not favour or oppose the candidate.
5. Do not name the candidate in the question text itself.
6. Questions must make sense to a voter in ${constituencyName}.
7. Constituency scope is HARD — do not generate questions about national policy.

RESPONSE FORMAT — JSON object with "questions" array only, no other text:
{
  "questions": [
    {
      "question": "<stance question — 1-2 sentences, ends with ?>",
      "context": "<2-3 sentence paraphrase with source attribution>",
      "issue_tag": "<one tag from allowed list>",
      "framing_style": "${framingStyle}",
      "confidence_score": <float 0.0-1.0>,
      "slider_low_label": "<label for -2>",
      "slider_high_label": "<label for +2>",
      "potential_contradiction": <true/false>
    }
  ]
}

Generate exactly ${QUESTIONS_PER_DOC} questions using different issue tags where possible.`;
}
async function generateCandidateQuestions(openaiKey, systemPrompt, documentText) {
  const truncated = documentText.slice(0, 32_000); // smaller than party — candidate docs are usually shorter
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openaiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 1500,
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
          content: `Candidate document:\n\n${truncated}`
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
    return (Array.isArray(parsed) ? parsed : parsed.questions ?? []).slice(0, QUESTIONS_PER_DOC);
  } catch  {
    throw new Error(`Failed to parse GPT response: ${content.slice(0, 200)}`);
  }
}
async function isDuplicate(projectUrl, headers, electionId, candidateId, questionText) {
  const res = await fetch(`${projectUrl}/rest/v1/election_question_drafts?election_id=eq.${electionId}&candidate_id=eq.${candidateId}&select=question&limit=100`, {
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
    if (overlap / Math.max(newWords.size, 1) > 0.6) return true;
  }
  return false;
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
  // Fetch eligible candidate-level documents
  let docsUrl = `${projectUrl}/rest/v1/election_source_documents?translation_status=in.(DONE,NOT_NEEDED)&ai_processing_status=eq.PENDING&is_active=eq.true&not.candidate_id=is.null&select=id,election_id,candidate_id,extracted_text_en&limit=5`;
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
  log("info", "processing candidate docs", {
    count: docs.length
  });
  if (!docs.length) {
    return new Response(JSON.stringify({
      ok: true,
      processed: 0,
      message: "No eligible candidate documents"
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
      // Fetch candidate + party + constituency
      const candRes = await fetch(`${projectUrl}/rest/v1/election_candidates?id=eq.${doc.candidate_id}&select=id,full_name,party_id,constituency_id,election_constituencies(name),election_parties(abbreviation)`, {
        headers
      });
      const cands = await candRes.json();
      if (!cands.length) throw new Error(`Candidate not found: ${doc.candidate_id}`);
      const cand = cands[0];
      const constituencyName = cand.election_constituencies?.name ?? "Unknown Constituency";
      const partyAbbreviation = cand.election_parties?.abbreviation ?? null;
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
      // Mark in progress
      await fetch(`${projectUrl}/rest/v1/election_source_documents?id=eq.${doc.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          ai_processing_status: "IN_PROGRESS",
          ai_processing_started_at: new Date().toISOString()
        })
      });
      const styleIndex = Math.floor(Math.random() * FRAMING_STYLES.length);
      const framingStyle = FRAMING_STYLES[styleIndex];
      const systemPrompt = buildCandidateSystemPrompt(cand.full_name, partyAbbreviation, constituencyName, tierCode, allowedTags, framingStyle);
      const questions = await generateCandidateQuestions(openaiKey, systemPrompt, doc.extracted_text_en ?? "");
      let inserted = 0;
      let duplicates = 0;
      let contradictions = 0;
      for (const q of questions){
        const dup = await isDuplicate(projectUrl, headers, doc.election_id, doc.candidate_id, q.question);
        if (dup) {
          duplicates++;
          continue;
        }
        if (q.potential_contradiction) contradictions++;
        const draft = {
          election_id: doc.election_id,
          source_document_id: doc.id,
          party_id: cand.party_id ?? null,
          candidate_id: doc.candidate_id,
          constituency_id: cand.constituency_id,
          question: q.question,
          context_summary: q.context,
          issue_tag: q.issue_tag,
          framing_style: q.framing_style,
          confidence_score: Math.min(1, Math.max(0, q.confidence_score ?? 0.7)),
          slider_low_label: q.slider_low_label ?? "Strongly disagree",
          slider_high_label: q.slider_high_label ?? "Strongly agree",
          potential_contradiction: q.potential_contradiction ?? false,
          status: "DRAFT",
          question_type: "CANDIDATE_STATEMENT",
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
        else log("warn", "draft insert failed", {
          question: q.question.slice(0, 80)
        });
      }
      await fetch(`${projectUrl}/rest/v1/election_source_documents?id=eq.${doc.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          ai_processing_status: "DONE",
          ai_processing_completed_at: new Date().toISOString(),
          ai_question_drafts_count: inserted
        })
      });
      summary.processed++;
      summary.total_inserted += inserted;
      summary.total_duplicates += duplicates;
      summary.total_contradictions += contradictions;
      log("info", "candidate doc done", {
        doc_id: doc.id,
        inserted,
        duplicates,
        contradictions
      });
    } catch (err) {
      const msg = String(err?.message ?? err);
      log("error", "candidate doc failed", {
        doc_id: doc.id,
        error: msg
      });
      summary.errors.push(`${doc.id}: ${msg}`);
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
