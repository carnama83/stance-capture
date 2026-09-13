// supabase/functions/post-to-x/index.ts
// Epic W — W1: Direct X (Twitter) post via API v2
//
// Called by ShareButton when user has an authorized X OAuth token.
//
// POST body:
//   tweet_text:    string   — full tweet text including URL (max 280 chars)
//   question_id:   string   — used to log the share event
//   og_image_url:  string?  — if provided, attaches the OG image as media
//
// Flow:
//   1. Validate auth (user must be authenticated)
//   2. Load X access token from social_auth_tokens for this user
//   3. If token expired, attempt refresh via X OAuth2 token endpoint
//   4. POST to X API v2 /2/tweets
//   5. Log to share_events with platform='twitter', share_type='stance'
//   6. Return { success: true, tweet_id }
//
// Error handling:
//   - Token not found → 401
//   - Token refresh failed → 401 (client falls back to web intent)
//   - X API error → 502 with error details
//   - Rate limited (429 from X) → 429 forwarded to client
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const X_CLIENT_ID = Deno.env.get("X_CLIENT_ID"); // OAuth 2.0 client ID
const X_CLIENT_SECRET = Deno.env.get("X_CLIENT_SECRET"); // OAuth 2.0 client secret
const X_TWEETS_URL = "https://api.twitter.com/2/tweets";
const X_TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
const CRON_SECRET = Deno.env.get("CRON_SECRET");
// ── Token refresh ────────────────────────────────────────────────────────────
async function refreshXToken(refreshToken) {
  const credentials = btoa(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`);
  try {
    const res = await fetch(X_TOKEN_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken
      })
    });
    if (!res.ok) return null;
    return await res.json();
  } catch  {
    return null;
  }
}
// ── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req)=>{
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type"
  };
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      error: "Method not allowed"
    }), {
      status: 405,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  // ── Auth: get calling user from JWT ──────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({
      error: "Unauthorized"
    }), {
      status: 401,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  const jwt = authHeader.replace("Bearer ", "");
  // Use service client for DB ops but verify user JWT first
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  // Verify JWT and get user ID
  const { data: { user }, error: userErr } = await createClient(SUPABASE_URL, // Verify using anon client to check JWT validity
  Deno.env.get("SUPABASE_ANON_KEY"), {
    global: {
      headers: {
        Authorization: authHeader
      }
    }
  }).auth.getUser();
  if (userErr || !user) {
    return new Response(JSON.stringify({
      error: "Invalid token"
    }), {
      status: 401,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  // ── Parse body ────────────────────────────────────────────────────────────
  let body;
  try {
    body = await req.json();
  } catch  {
    return new Response(JSON.stringify({
      error: "Invalid JSON body"
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  const { tweet_text, question_id, og_image_url } = body;
  if (!tweet_text || !question_id) {
    return new Response(JSON.stringify({
      error: "tweet_text and question_id are required"
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  // ── Load X token for this user ────────────────────────────────────────────
  const { data: tokenRow, error: tokenErr } = await sb.from("social_auth_tokens").select("id, user_id, access_token, refresh_token, token_expires_at, scopes").eq("user_id", user.id).eq("provider", "twitter").single();
  if (tokenErr || !tokenRow) {
    return new Response(JSON.stringify({
      success: false,
      error: "No X token found. Connect your X account in Settings."
    }), {
      status: 401,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  // ── Refresh token if expired ──────────────────────────────────────────────
  let accessToken = tokenRow.access_token;
  const isExpired = tokenRow.token_expires_at ? new Date(tokenRow.token_expires_at) < new Date(Date.now() + 60_000) // 1-min buffer
   : false;
  if (isExpired && tokenRow.refresh_token) {
    const refreshed = await refreshXToken(tokenRow.refresh_token);
    if (!refreshed) {
      return new Response(JSON.stringify({
        success: false,
        error: "X token expired and refresh failed. Please reconnect your X account."
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Update stored token
    accessToken = refreshed.access_token;
    await sb.from("social_auth_tokens").update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? tokenRow.refresh_token,
      token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
    }).eq("id", tokenRow.id);
  }
  // ── Truncate tweet text to 280 chars ──────────────────────────────────────
  // X counts URLs as 23 chars regardless of actual length.
  // Simple approach: truncate raw text if over 280.
  const safeTweetText = tweet_text.length > 280 ? tweet_text.slice(0, 277) + "…" : tweet_text;
  // ── Build X API v2 payload ────────────────────────────────────────────────
  const tweetPayload = {
    text: safeTweetText
  };
  // ── POST to X API v2 /2/tweets ────────────────────────────────────────────
  const xRes = await fetch(X_TWEETS_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(tweetPayload)
  });
  const xBody = await xRes.json().catch(()=>({}));
  // ── Handle X API errors ───────────────────────────────────────────────────
  if (!xRes.ok || !xBody.data?.id) {
    const errMsg = xBody.errors?.[0]?.message ?? `X API error ${xRes.status}`;
    console.error("[post-to-x] X API error:", xRes.status, errMsg);
    // Forward 429 rate limit directly
    if (xRes.status === 429) {
      return new Response(JSON.stringify({
        success: false,
        error: "X rate limit reached. Please try again in a few minutes."
      }), {
        status: 429,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    return new Response(JSON.stringify({
      success: false,
      error: errMsg
    }), {
      status: 502,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  const tweetId = xBody.data.id;
  // ── Log to share_events ───────────────────────────────────────────────────
  await sb.from("share_events").insert({
    question_id,
    shared_by_user_id: user.id,
    platform: "twitter",
    share_type: "stance"
  }).select().single().catch((e)=>console.warn("[post-to-x] share_events insert failed:", e?.message));
  // ── Success ───────────────────────────────────────────────────────────────
  console.log(`[post-to-x] ✓ Tweet posted: ${tweetId} by user ${user.id.slice(0, 8)}`);
  return new Response(JSON.stringify({
    success: true,
    tweet_id: tweetId
  }), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
});
