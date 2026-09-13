function log(level, msg, extra = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, func: "x-reply-ingestion", msg, ...extra }));
}
const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const X_BEARER_TOKEN = Deno.env.get("X_BEARER_TOKEN") ?? "";
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const CONFIDENCE_THRESHOLD = parseFloat(Deno.env.get("W4_CONFIDENCE_THRESHOLD") ?? "0.75");
const LOOKBACK_DAYS = parseInt(Deno.env.get("W4_LOOKBACK_DAYS") ?? "7");
const MAX_REPLIES_PER_TWEET = parseInt(Deno.env.get("W4_MAX_REPLIES_PER_TWEET") ?? "50");
function dbHeaders() {
  return { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
}
async function dbSelect(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: dbHeaders() });
  if (!res.ok) throw new Error(`GET ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}
async function dbInsert(table, rows, opts = "") {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...dbHeaders(), Prefer: opts || "resolution=ignore-duplicates" },
    body: JSON.stringify(rows)
  });
  if (!res.ok) throw new Error(`INSERT ${table}: ${res.status} ${await res.text()}`);
}
async function dbUpdate(table, id, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: "PATCH",
    headers: dbHeaders(),
    body: JSON.stringify(patch)
  });
  if (!res.ok) throw new Error(`PATCH ${table}: ${res.status} ${await res.text()}`);
}
async function dbRpc(fn, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: dbHeaders(),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`RPC ${fn}: ${res.status} ${await res.text()}`);
  return res.json();
}
async function fetchRepliesForTweet(tweetId) {
  if (!X_BEARER_TOKEN) { log("warn", "X_BEARER_TOKEN not set"); return []; }
  const query = encodeURIComponent(`conversation_id:${tweetId} is:reply -is:retweet`);
  const fields = "author_id,created_at,text";
  const url = `https://api.twitter.com/2/tweets/search/recent?query=${query}&tweet.fields=${fields}&max_results=${MAX_REPLIES_PER_TWEET}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` } });
  if (res.status === 429) { log("warn", "X API rate limited", { tweetId }); return []; }
  if (!res.ok) { log("warn", "X API error", { tweetId, status: res.status }); return []; }
  const data = await res.json();
  return data.data ?? [];
}
async function classifyReply(questionText, replyText) {
  if (!OPENAI_KEY) { log("warn", "OPENAI_API_KEY not set"); return null; }
  const prompt = `You are classifying social media replies to determine whether they express a clear stance on a specific question.\n\nQuestion: "${questionText}"\n\nReply: "${replyText}"\n\nThe question uses a -2 to +2 stance scale where:\n-2 = Strongly disagree / strongly oppose\n-1 = Disagree / oppose\n 0 = Neutral / no clear stance\n+1 = Agree / support\n+2 = Strongly agree / strongly support\n\nClassify this reply. Respond ONLY with valid JSON, no preamble:\n{\n  "stance_value": <integer from -2 to 2>,\n  "confidence_score": <float from 0.0 to 1.0>,\n  "classification_reason": "<one sentence explanation>"\n}\n\nConfidence scoring guide:\n- 0.9-1.0: Reply explicitly and unambiguously states a stance on the question\n- 0.75-0.89: Reply clearly implies a stance with high confidence\n- 0.5-0.74: Reply suggests a stance but with some ambiguity\n- 0.0-0.49: Reply is off-topic, unclear, or expresses no clear stance\n\nIf the reply is off-topic, spam, or contains no stance signal, set stance_value to 0 and confidence_score below 0.5.`;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini", max_tokens: 200, temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You classify social media replies for stance signals. Always respond with valid JSON only." },
          { role: "user", content: prompt }
        ]
      })
    });
    if (!res.ok) { log("warn", "OpenAI API error", { status: res.status }); return null; }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    const stance_value = Math.max(-2, Math.min(2, Math.round(parsed.stance_value ?? 0)));
    const confidence_score = Math.max(0, Math.min(1, parsed.confidence_score ?? 0));
    const classification_reason = String(parsed.classification_reason ?? "");
    return { stance_value, confidence_score, classification_reason };
  } catch (e) { log("error", "Classification failed", { error: e.message }); return null; }
}
async function lookupUserId(xUserId) {
  const tokenRows = await dbSelect("social_auth_tokens", `provider=eq.twitter&provider_user_id=eq.${encodeURIComponent(xUserId)}&select=user_id&limit=1`);
  const userId = tokenRows[0]?.user_id ?? null;
  if (!userId) return null;
  const privRows = await dbSelect("user_privacy", `user_id=eq.${userId}&select=allow_social_ingestion&limit=1`);
  if (!privRows[0] || privRows[0].allow_social_ingestion !== false) { return userId; }
  log("info", "social ingestion opt-out respected", { userId });
  return null;
}
Deno.serve(async (req)=>{
  if (CRON_SECRET && req.headers.get("Authorization") !== `Bearer ${CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const traceId = crypto.randomUUID().slice(0, 8);
  log("info", "run_start", { traceId });
  const stats = { shareEventsProcessed: 0, repliesFetched: 0, repliesNew: 0, classified: 0, accepted: 0, promoted: 0, errors: 0 };
  try {
    const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
    const shareEvents = await dbSelect("share_events", `tweet_id=not.is.null&created_at=gte.${cutoff}&select=id,question_id,tweet_id,created_at&order=created_at.desc`);
    log("info", "share_events_loaded", { count: shareEvents.length, traceId });
    const questionIds = [...new Set(shareEvents.map((e)=>e.question_id))];
    const questions = {};
    if (questionIds.length > 0) {
      const qRows = await dbSelect("questions", `id=in.(${questionIds.join(",")})&select=id,question`);
      qRows.forEach((q)=>{ questions[q.id] = q.question; });
    }
    for (const event of shareEvents){
      stats.shareEventsProcessed++;
      const questionText = questions[event.question_id] ?? "";
      try {
        const replies = await fetchRepliesForTweet(event.tweet_id);
        stats.repliesFetched += replies.length;
        if (replies.length === 0) continue;
        const inboxRows = replies.map((r)=>({
            share_event_id: event.id, question_id: event.question_id, platform: "twitter",
            external_post_id: r.id, external_user_id: r.author_id ?? null, reply_text: r.text,
            reply_timestamp: r.created_at, raw_payload: r, processing_status: "pending"
          }));
        await dbInsert("social_reply_inbox", inboxRows);
        const pendingReplies = await dbSelect("social_reply_inbox", `share_event_id=eq.${event.id}&processing_status=eq.pending&select=id,external_post_id,external_user_id,reply_text`);
        stats.repliesNew += pendingReplies.length;
        for (const reply of pendingReplies){
          try {
            const classification = await classifyReply(questionText, reply.reply_text);
            if (!classification) { await dbUpdate("social_reply_inbox", reply.id, { processing_status: "error" }); continue; }
            stats.classified++;
            const status = classification.confidence_score >= CONFIDENCE_THRESHOLD ? "accepted" : "rejected";
            const attributedUserId = reply.external_user_id ? await lookupUserId(reply.external_user_id) : null;
            await dbInsert("ingested_stances", [{
                reply_inbox_id: reply.id, question_id: event.question_id, attributed_user_id: attributedUserId,
                stance_value: classification.stance_value, confidence_score: classification.confidence_score,
                classification_reason: classification.classification_reason, status,
                reviewed_at: status === "accepted" ? new Date().toISOString() : null
              }]);
            await dbUpdate("social_reply_inbox", reply.id, { processing_status: "classified" });
            if (status === "accepted") { stats.accepted++; }
          } catch (replyErr) {
            stats.errors++;
            log("error", "reply_processing_failed", { replyId: reply.id, error: replyErr.message, traceId });
            await dbUpdate("social_reply_inbox", reply.id, { processing_status: "error" });
          }
        }
      } catch (eventErr) {
        stats.errors++;
        log("error", "share_event_failed", { shareEventId: event.id, tweetId: event.tweet_id, error: eventErr.message, traceId });
      }
    }
    const acceptedRows = await dbSelect("ingested_stances", `status=eq.accepted&promoted_at=is.null&select=id`);
    for (const row of acceptedRows){
      try { await dbRpc("promote_ingested_stance", { p_ingested_stance_id: row.id }); stats.promoted++; }
      catch (promoteErr) { stats.errors++; log("error", "promote_failed", { id: row.id, error: promoteErr.message, traceId }); }
    }
    log("info", "run_complete", { ...stats, traceId });
    return new Response(JSON.stringify({ ok: true, stats }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    log("error", "run_fatal", { error: err.message, traceId });
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
