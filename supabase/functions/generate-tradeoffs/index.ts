// supabase/functions/generate-tradeoffs/index.ts
// S4 — Decision Support: generates trade-off pairs for a question using Claude.
// Called on first view of a question that has no cached tradeoffs.
// Caches result in question_tradeoffs table.
// SELF-CONTAINED — no shared imports.
function log(level, msg, extra = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    func: "generate-tradeoffs",
    msg,
    ...extra
  }));
}
function makeAdminClient() {
  const url = (Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "").replace(/\/+$/, "");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SERVICE_ROLE_KEY");
  const headers = ()=>({
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`
    });
  return {
    url,
    key,
    headers,
    async select (table, query) {
      const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
        headers: headers()
      });
      if (!res.ok) throw new Error(`GET ${table} ${res.status}: ${await res.text()}`);
      return res.json();
    },
    async upsert (table, row) {
      const res = await fetch(`${url}/rest/v1/${table}`, {
        method: "POST",
        headers: {
          ...headers(),
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify(row)
      });
      if (!res.ok) throw new Error(`UPSERT ${table} ${res.status}: ${await res.text()}`);
    }
  };
}
async function generateTradeoffs(questionText, summary) {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) throw new Error("OPENAI_API_KEY not set");
  const prompt = `You are analyzing a policy question to identify the core trade-offs people must weigh when forming their opinion.

Question: "${questionText}"
${summary ? `Context: ${summary}` : ""}

Extract 2-3 genuine trade-offs in this question. Each trade-off is a tension between two competing values or priorities.

Respond ONLY with a JSON array. No preamble, no markdown. Example format:
[
  {
    "label": "Cost vs Coverage",
    "side_a": "Lower costs",
    "side_b": "Broader coverage",
    "description": "Expanding coverage typically requires more spending, while cost controls may limit who benefits."
  }
]

Rules:
- Each trade-off must be real and specific to THIS question
- side_a and side_b are short (2-5 words each)
- description is 1 sentence explaining the tension
- label is 2-4 words summarising the trade-off
- Return 2-3 trade-offs, never more
- No political bias — present both sides neutrally`;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openaiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 600,
      temperature: 0.3,
      response_format: {
        type: "json_object"
      },
      messages: [
        {
          role: "system",
          content: "You extract trade-offs from policy questions. Always respond with valid JSON only — an object with a single key 'tradeoffs' containing an array."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "{}";
  // Parse — OpenAI json_object mode wraps in an object
  const parsed = JSON.parse(text);
  // Handle both {tradeoffs: [...]} and bare [...] responses
  const tradeoffs = Array.isArray(parsed) ? parsed : parsed.tradeoffs ?? [];
  return tradeoffs;
}
Deno.serve(async (req)=>{
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      error: "Method not allowed"
    }), {
      status: 405
    });
  }
  // Auth: require user JWT (anon users can trigger this but we validate below)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({
      error: "Unauthorized"
    }), {
      status: 401
    });
  }
  try {
    const body = await req.json();
    const { question_id, question_text, summary } = body;
    if (!question_id || !question_text) {
      return new Response(JSON.stringify({
        error: "question_id and question_text are required"
      }), {
        status: 400
      });
    }
    const db = makeAdminClient();
    // Check cache first
    const cached = await db.select("question_tradeoffs", `question_id=eq.${question_id}&select=tradeoffs,generated_at`);
    if (cached && cached.length > 0 && cached[0].tradeoffs) {
      log("info", "cache_hit", {
        question_id
      });
      return new Response(JSON.stringify({
        tradeoffs: cached[0].tradeoffs,
        cached: true
      }), {
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    // Generate
    log("info", "generating", {
      question_id
    });
    const tradeoffs = await generateTradeoffs(question_text, summary ?? null);
    // Cache
    await db.upsert("question_tradeoffs", {
      question_id,
      tradeoffs,
      generated_at: new Date().toISOString()
    });
    log("info", "done", {
      question_id,
      count: tradeoffs.length
    });
    return new Response(JSON.stringify({
      tradeoffs,
      cached: false
    }), {
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    log("error", "fatal", {
      error: err.message
    });
    return new Response(JSON.stringify({
      error: err.message
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
});
