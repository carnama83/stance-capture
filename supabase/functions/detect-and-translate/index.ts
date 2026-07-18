// supabase/functions/detect-and-translate/index.ts
//
// Epic EL — Phase EL-4: detect-and-translate
//
// Trigger: called by admin UI or pg_cron after ingestion_status = DONE
//          on election_source_documents where translation_status = PENDING
//
// Steps:
//   1. Pull up to BATCH_SIZE documents with ingestion_status=DONE,
//      translation_status=PENDING
//   2. For each: detect language using GPT-4o-mini
//   3. If non-English: translate extracted_text → extracted_text_en
//   4. If English: set translation_status=NOT_NEEDED, copy extracted_text → extracted_text_en
//   5. Update document record with detected_language + translation result
//
// EL-QA-P08: Hindi PDF → language=hi detected, extracted_text_en populated
//
// Env secrets required:
//   OPENAI_API_KEY         — primary LLM provider
//   SERVICE_ROLE_KEY       — Supabase service role
//   PROJECT_URL            — Supabase project URL
//   CRON_SECRET            — auth header for pg_cron / admin calls
const FUNC = "detect-and-translate";
const BATCH_SIZE = 10;
const TRANSLATE_MAX_CHARS = 80_000; // ~20k tokens at 4 chars/token
function log(level, msg, extra = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    func: FUNC,
    msg,
    ...extra
  }));
}
function getSupabaseHeaders(serviceRoleKey) {
  return {
    "Content-Type": "application/json",
    "apikey": serviceRoleKey,
    "Authorization": `Bearer ${serviceRoleKey}`
  };
}
// ── Language detection via GPT-4o-mini ───────────────────────────────────────
async function detectLanguage(openaiKey, text) {
  const sample = text.slice(0, 500); // first 500 chars is enough for detection
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openaiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 10,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: "You are a language detector. Respond with ONLY the ISO 639-1 language code (2 letters). Examples: en, hi, ur, ta, te, mr, bn, gu, pa, kn, ml. No explanation."
        },
        {
          role: "user",
          content: `Detect the language of this text:\n\n${sample}`
        }
      ]
    })
  });
  if (!res.ok) throw new Error(`OpenAI detect failed: ${res.status}`);
  const data = await res.json();
  const code = data.choices?.[0]?.message?.content?.trim().toLowerCase().slice(0, 2) ?? "en";
  return code;
}
// ── Translation via GPT-4o-mini ───────────────────────────────────────────────
async function translateToEnglish(openaiKey, text, sourceLang) {
  // Chunk if needed
  const chunks = [];
  for(let i = 0; i < text.length; i += TRANSLATE_MAX_CHARS){
    chunks.push(text.slice(i, i + TRANSLATE_MAX_CHARS));
  }
  const translated = [];
  for (const chunk of chunks){
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 4096,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: `You are a professional translator specialising in political and government documents. Translate the following ${sourceLang} text to English. Preserve the meaning faithfully. Maintain paragraph structure. Do not add commentary or explanations. Output only the translated text.`
          },
          {
            role: "user",
            content: chunk
          }
        ]
      })
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI translate failed: ${res.status} — ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    translated.push(data.choices?.[0]?.message?.content ?? "");
  }
  return translated.join("\n\n");
}
// ── Process one document ──────────────────────────────────────────────────────
async function processDocument(doc, openaiKey, projectUrl, serviceRoleKey) {
  const headers = getSupabaseHeaders(serviceRoleKey);
  const text = doc.extracted_text ?? "";
  if (!text.trim()) {
    // Nothing to translate — mark as skipped
    await fetch(`${projectUrl}/rest/v1/election_source_documents?id=eq.${doc.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        translation_status: "NOT_NEEDED",
        detected_language: "en",
        extracted_text_en: "",
        translation_completed_at: new Date().toISOString()
      })
    });
    return {
      id: doc.id,
      result: "skipped_empty",
      lang: "en"
    };
  }
  // Mark in progress
  await fetch(`${projectUrl}/rest/v1/election_source_documents?id=eq.${doc.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      translation_status: "IN_PROGRESS",
      translation_started_at: new Date().toISOString()
    })
  });
  try {
    const detectedLang = await detectLanguage(openaiKey, text);
    const isEnglish = detectedLang === "en";
    let extractedTextEn;
    if (isEnglish) {
      extractedTextEn = text;
    } else {
      extractedTextEn = await translateToEnglish(openaiKey, text, detectedLang);
    }
    await fetch(`${projectUrl}/rest/v1/election_source_documents?id=eq.${doc.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        detected_language: detectedLang,
        translation_status: isEnglish ? "NOT_NEEDED" : "DONE",
        extracted_text_en: extractedTextEn,
        translation_completed_at: new Date().toISOString()
      })
    });
    return {
      id: doc.id,
      result: isEnglish ? "passthrough" : "translated",
      lang: detectedLang
    };
  } catch (err) {
    await fetch(`${projectUrl}/rest/v1/election_source_documents?id=eq.${doc.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        translation_status: "FAILED",
        translation_error: String(err?.message ?? err).slice(0, 500)
      })
    });
    throw err;
  }
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
    log("error", "missing env", {
      openaiKey: !!openaiKey,
      serviceRoleKey: !!serviceRoleKey,
      projectUrl: !!projectUrl
    });
    return new Response(JSON.stringify({
      ok: false,
      error: "Missing required env vars"
    }), {
      status: 500,
      headers: {
        "content-type": "application/json"
      }
    });
  }
  // Parse optional election_id filter from body
  let electionIdFilter = null;
  try {
    const body = await req.json();
    electionIdFilter = body?.election_id ?? null;
  } catch  {}
  // Fetch pending documents
  const headers = getSupabaseHeaders(serviceRoleKey);
  let url = `${projectUrl}/rest/v1/election_source_documents?ingestion_status=eq.DONE&translation_status=eq.PENDING&is_active=eq.true&select=id,extracted_text,original_language&limit=${BATCH_SIZE}`;
  if (electionIdFilter) url += `&election_id=eq.${electionIdFilter}`;
  const docsRes = await fetch(url, {
    headers
  });
  if (!docsRes.ok) {
    const errText = await docsRes.text();
    log("error", "fetch docs failed", {
      status: docsRes.status,
      body: errText.slice(0, 300)
    });
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
  log("info", "processing batch", {
    count: docs.length,
    electionIdFilter
  });
  if (!docs.length) {
    return new Response(JSON.stringify({
      ok: true,
      processed: 0,
      message: "No pending documents"
    }), {
      headers: {
        "content-type": "application/json"
      }
    });
  }
  // Process sequentially (translation is slow, avoid rate limits)
  const results = [];
  for (const doc of docs){
    try {
      const r = await processDocument(doc, openaiKey, projectUrl, serviceRoleKey);
      results.push(r);
      log("info", "doc processed", r);
    } catch (err) {
      log("error", "doc failed", {
        id: doc.id,
        error: err?.message
      });
      results.push({
        id: doc.id,
        error: String(err?.message ?? err)
      });
    }
  }
  const succeeded = results.filter((r)=>!("error" in r)).length;
  const failed = results.filter((r)=>"error" in r).length;
  return new Response(JSON.stringify({
    ok: true,
    processed: docs.length,
    succeeded,
    failed,
    results
  }), {
    headers: {
      "content-type": "application/json"
    }
  });
});
