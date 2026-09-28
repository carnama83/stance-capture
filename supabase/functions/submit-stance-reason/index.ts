// supabase/functions/submit-stance-reason/index.ts
//
// Epic Report R3 — save why a respondent chose their position, then check any
// free text before it can ever be quoted.
//
// Body: { question_id, option_keys: string[], text?: string, language_code?, device_id? }
//
//   signed-in caller (JWT with a sub) -> set_my_stance_reason, run AS the user
//   anyone else                        -> record_web_stance_reason with device_id
//
// Both RPCs validate everything that matters (the answer exists, option keys
// belong to the side of that answer, text <= 280 chars). This function adds
// moderation of the free text and records the result with the service role:
//
//   pii      a phone number, email, URL or ID-like number was found
//   flagged  OpenAI moderation flagged it
//   clean    neither
//   error    moderation could not run — the text stays unquotable
//
// Moderation never blocks the save: every reason counts in the option tallies;
// only 'clean' free text is ever eligible to be quoted in a report.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// The gateway has already verified this JWT (verify_jwt = true); we only read
// whether it belongs to a signed-in user.
function jwtSubject(authHeader: string): string | null {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.role === "authenticated" && typeof payload?.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

const PII_PATTERNS: RegExp[] = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, // email
  /(?:https?:\/\/|www\.)\S+/i, // url
  /(?:\+?\d[\s-]?){10,}/, // phone-like: 10+ digits with optional separators
  /\b\d{4}\s?\d{4}\s?\d{4}\b/, // 12-digit ID (e.g. Aadhaar)
  /\b[A-Z]{5}\d{4}[A-Z]\b/, // PAN
];

async function moderate(text: string): Promise<{ status: string; score: number | null }> {
  if (PII_PATTERNS.some((p) => p.test(text))) return { status: "pii", score: null };
  if (!OPENAI_API_KEY) return { status: "error", score: null };
  try {
    const res = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: "omni-moderation-latest", input: text }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { status: "error", score: null };
    const data = await res.json();
    const result = data?.results?.[0];
    const scores = Object.values(result?.category_scores ?? {}).map(Number).filter(Number.isFinite);
    const score = scores.length ? Math.round(Math.max(...scores) * 1000) / 1000 : null;
    return { status: result?.flagged ? "flagged" : "clean", score };
  } catch {
    return { status: "error", score: null };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const questionId = typeof body?.question_id === "string" ? body.question_id : "";
  const optionKeys = Array.isArray(body?.option_keys) ? body.option_keys.filter((k: unknown) => typeof k === "string").slice(0, 8) : [];
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, 280) : "";
  const languageCode = typeof body?.language_code === "string" ? body.language_code.slice(0, 10) : null;
  const deviceId = typeof body?.device_id === "string" ? body.device_id : null;
  if (!/^[0-9a-f-]{36}$/i.test(questionId)) return json({ error: "question_id required" }, 400);

  const authHeader = req.headers.get("Authorization") ?? "";
  const signedIn = !!jwtSubject(authHeader);

  const rpc = signedIn ? "set_my_stance_reason" : "record_web_stance_reason";
  const args = signedIn
    ? { p_question_id: questionId, p_option_keys: optionKeys, p_text: text || null, p_language_code: languageCode }
    : { p_question_id: questionId, p_device_id: deviceId, p_option_keys: optionKeys, p_text: text || null, p_language_code: languageCode };

  // Run as the caller (their JWT, or the anon key), so auth.uid() and the
  // RPC grants apply exactly as they would from the browser.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpc}`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = String(err?.message ?? "");
    const code = /no_stance/.test(msg) ? "no_stance"
      : /empty_reason/.test(msg) ? "empty_reason"
      : /invalid_device/.test(msg) ? "invalid_device"
      : /not_signed_in/.test(msg) ? "not_signed_in"
      : "save_failed";
    const status = code === "save_failed" ? 500 : code === "no_stance" ? 409 : 400;
    if (code === "save_failed") console.error("[submit-stance-reason] rpc failed", rpc, res.status, err);
    return json({ error: code }, status);
  }
  const saved = await res.json();

  let moderationStatus = saved?.moderation_status ?? "none";
  if (text && saved?.id) {
    const m = await moderate(text);
    moderationStatus = m.status;
    const table = signedIn ? "question_stance_reasons" : "question_stance_reasons_pending";
    const upd = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${saved.id}`, {
      method: "PATCH",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ moderation_status: m.status, moderation_score: m.score }),
    });
    if (!upd.ok) {
      // Row stays 'pending' — never quotable — which is the safe failure.
      console.error("[submit-stance-reason] moderation write failed", upd.status, await upd.text());
      moderationStatus = "pending";
    }
  }

  return json({ ok: true, kind: saved?.kind, option_keys: saved?.option_keys ?? [], moderation_status: moderationStatus });
});
