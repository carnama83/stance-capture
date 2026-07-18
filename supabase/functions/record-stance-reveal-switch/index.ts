// supabase/functions/record-stance-reveal-switch/index.ts
//
// Epic EL — Phase EL-5: record-stance-reveal-switch (v3.1)
//
// Called when a user completes Step 2 (reveal) of an election question card
// and optionally changes their stance.
//
// Atomically writes:
//   - original_stance_before_reveal  — the blind-step stance (Step 1)
//   - switched_after_reveal           — true if user changed after reveal
//   - reveal_timing_ms               — ms from reveal render to interaction
//   - score                          — final stance value (may equal original if no switch)
//
// MIRROR RULE (v3.1): This function OBSERVES and RECORDS only.
// It NEVER interprets the divergence or nudges the user.
// No coaching, no recommendations, no "here's why you might reconsider".
// Code review must verify this boundary before EL-5 ships.
//
// EL-QA-027: blind step captures original_stance_before_reveal
// EL-QA-028: switched_after_reveal=true when user changes after reveal
// EL-QA-029: switched_after_reveal=false when user confirms original
// EL-QA-031: reflexive timing flag (reveal_timing_ms < 800ms) — recorded, NOT excluded
//
// Request body:
//   {
//     question_id:                   string,
//     original_stance_before_reveal: number (-2 to 2),
//     final_stance:                  number (-2 to 2),
//     reveal_timing_ms:              number
//   }
const FUNC = "record-stance-reveal-switch";
function log(level, msg, extra = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    func: FUNC,
    msg,
    ...extra
  }));
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
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  // Extract user JWT from Authorization header
  const userJwt = req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
  if (!userJwt || userJwt === anonKey) {
    return new Response(JSON.stringify({
      ok: false,
      error: "Authentication required"
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
      error: "Invalid JSON"
    }), {
      status: 400,
      headers: {
        "content-type": "application/json"
      }
    });
  }
  const { question_id, original_stance_before_reveal, final_stance, reveal_timing_ms } = body;
  // Validate inputs
  if (!question_id) {
    return new Response(JSON.stringify({
      ok: false,
      error: "question_id required"
    }), {
      status: 400,
      headers: {
        "content-type": "application/json"
      }
    });
  }
  for (const v of [
    original_stance_before_reveal,
    final_stance
  ]){
    if (typeof v !== "number" || v < -2 || v > 2 || !Number.isInteger(v)) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Stance values must be integers -2 to 2"
      }), {
        status: 400,
        headers: {
          "content-type": "application/json"
        }
      });
    }
  }
  // Get user ID from JWT via Supabase auth
  const userRes = await fetch(`${projectUrl}/auth/v1/user`, {
    headers: {
      "apikey": anonKey,
      "Authorization": `Bearer ${userJwt}`
    }
  });
  if (!userRes.ok) {
    return new Response(JSON.stringify({
      ok: false,
      error: "Invalid auth token"
    }), {
      status: 401,
      headers: {
        "content-type": "application/json"
      }
    });
  }
  const userObj = await userRes.json();
  const userId = userObj?.id;
  if (!userId) {
    return new Response(JSON.stringify({
      ok: false,
      error: "Could not resolve user ID"
    }), {
      status: 401,
      headers: {
        "content-type": "application/json"
      }
    });
  }
  const srHeaders = {
    "Content-Type": "application/json",
    "apikey": serviceRoleKey,
    "Authorization": `Bearer ${serviceRoleKey}`,
    "Prefer": "return=representation"
  };
  const switchedAfterReveal = final_stance !== original_stance_before_reveal;
  // Upsert question_stances with Switch Mechanic fields
  // Uses service role to bypass RLS for the atomic write
  const upsertRes = await fetch(`${projectUrl}/rest/v1/question_stances`, {
    method: "POST",
    headers: {
      ...srHeaders,
      "Prefer": "return=representation,resolution=merge-duplicates"
    },
    body: JSON.stringify({
      user_id: userId,
      question_id,
      score: final_stance,
      source: "native",
      original_stance_before_reveal,
      switched_after_reveal: switchedAfterReveal,
      reveal_timing_ms: typeof reveal_timing_ms === "number" ? Math.round(reveal_timing_ms) : null,
      updated_at: new Date().toISOString()
    })
  });
  if (!upsertRes.ok) {
    const errBody = await upsertRes.json().catch(()=>({}));
    log("error", "upsert failed", {
      question_id,
      userId,
      error: errBody
    });
    return new Response(JSON.stringify({
      ok: false,
      error: errBody?.message ?? `HTTP ${upsertRes.status}`
    }), {
      status: 500,
      headers: {
        "content-type": "application/json"
      }
    });
  }
  const stance = await upsertRes.json();
  // Flag reflexive timing for research audit (EL-QA-031)
  // OBSERVE only — stance is ALWAYS recorded regardless of timing
  const isReflexive = typeof reveal_timing_ms === "number" && reveal_timing_ms < 800;
  log("info", "stance recorded", {
    question_id,
    userId,
    original: original_stance_before_reveal,
    final: final_stance,
    switched: switchedAfterReveal,
    reveal_ms: reveal_timing_ms,
    reflexive_flag: isReflexive
  });
  // MIRROR RULE: Return only factual data. No interpretation. No coaching.
  // Do NOT include messages like "You changed your mind!" or "Your party holds a different view."
  return new Response(JSON.stringify({
    ok: true,
    stance_id: stance[0]?.id ?? null,
    switched_after_reveal: switchedAfterReveal,
    reveal_timing_ms: reveal_timing_ms ?? null,
    reflexive_flag: isReflexive
  }), {
    headers: {
      "content-type": "application/json"
    }
  });
});
