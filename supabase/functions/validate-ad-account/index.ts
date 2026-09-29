// supabase/functions/validate-ad-account/index.ts
// Epic Y — Y1: Ad Account Management (Y1.1 connect Meta, Y1.2 connect LinkedIn,
//          Y1.3 one-click test connection)
//
// Admin-only. Two modes:
//   mode="connect" — validate provided credentials against the platform API,
//                    and on success upsert into ad_account_connections
//                    (status='active'). Credentials are stored server-side in
//                    the credentials jsonb and NEVER returned to the client.
//   mode="test"    — re-validate an existing connection's stored credentials
//                    with a lightweight API call; update status + last_sync_at.
//
// Auth: caller must present a user JWT belonging to an admin (is_admin_me).
//       Writes use the service role (bypasses RLS).
//
// Env secrets:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//   META_ADS_ACCESS_TOKEN   — Meta system-user token (ads_management scope).
//                             Used when a Meta account has no per-account token.
//   META_GRAPH_VERSION      — optional, default "v21.0"
//   LINKEDIN_API_VERSION    — optional, default "202401" (LinkedIn-Version hdr)
//
// Never returns the credentials column. The response carries only the
// credentials-free "safe" shape.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FUNC = "validate-ad-account";
const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v21.0";
const LINKEDIN_VERSION = Deno.env.get("LINKEDIN_API_VERSION") ?? "202401";

function log(level, msg, extra = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, func: FUNC, msg, ...extra }));
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isAdminResult(v) {
  if (v === true) return true;
  if (v?.is_admin === true) return true;
  if (Array.isArray(v) && v[0]?.is_admin === true) return true;
  return false;
}

// fetch with timeout + exponential backoff on 429/5xx (Core Principle 5).
async function fetchWithRetry(url, init = {}, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 3;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(t);
      if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
        const backoff = Math.min(2 ** attempt * 400, 4000);
        log("warn", "retryable_response", { status: res.status, attempt, backoff });
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(t);
      lastErr = err;
      if (attempt < maxAttempts) {
        const backoff = Math.min(2 ** attempt * 400, 4000);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
    }
  }
  throw lastErr ?? new Error("request failed");
}

// ── Meta validation ──────────────────────────────────────────────────────────
// Returns { ok, status, account_name, reason }. status is a valid
// ad_account_connections.status value.
async function validateMeta(accountId, token) {
  if (!token) {
    return { ok: false, status: "disconnected", reason: "No Meta access token available (set META_ADS_ACCESS_TOKEN or provide a per-account token)." };
  }
  // Meta act ids are prefixed with act_. Accept either form from the admin.
  const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${actId}` +
    `?fields=id,name,account_status,disable_reason&access_token=${encodeURIComponent(token)}`;
  let res;
  try {
    res = await fetchWithRetry(url, { method: "GET" });
  } catch (err) {
    return { ok: false, status: "disconnected", reason: `Network error contacting Meta: ${String(err)}` };
  }
  const bodyText = await res.text();
  let body = {};
  try { body = JSON.parse(bodyText); } catch { /* leave as {} */ }

  if (!res.ok) {
    const err = body?.error ?? {};
    // OAuth/token problems → token_expired; everything else → clear message.
    if (err.code === 190 || err.type === "OAuthException") {
      return { ok: false, status: "token_expired", reason: "Meta token is invalid or expired. Re-authenticate." };
    }
    if (err.code === 100 || res.status === 404) {
      return { ok: false, status: "disconnected", reason: "Ad account not found or not accessible with these credentials." };
    }
    if (err.code === 200 || err.code === 10 || res.status === 403) {
      return { ok: false, status: "disconnected", reason: "Insufficient permissions on this ad account (ads_management required)." };
    }
    return { ok: false, status: "disconnected", reason: err.message ?? `Meta API error (HTTP ${res.status}).` };
  }

  // Map Meta account_status → connection health.
  // 1 ACTIVE, 9 IN_GRACE_PERIOD → active; 2 DISABLED, 101 CLOSED, 100 PENDING_CLOSURE,
  // 3 UNSETTLED, 7 PENDING_RISK_REVIEW → suspended.
  const s = Number(body.account_status);
  if (s === 1 || s === 9) {
    return { ok: true, status: "active", account_name: body.name ?? null };
  }
  return {
    ok: false,
    status: "suspended",
    account_name: body.name ?? null,
    reason: `Meta reports this account is not active (account_status=${s}).`,
  };
}

// ── LinkedIn validation ──────────────────────────────────────────────────────
async function validateLinkedIn(accountId, token) {
  if (!token) {
    return { ok: false, status: "disconnected", reason: "LinkedIn access token is required." };
  }
  // Accept a numeric id or an adAccount URN; the REST path wants the numeric id.
  const numericId = String(accountId).replace(/^urn:li:sponsoredAccount:/, "");
  const url = `https://api.linkedin.com/rest/adAccounts/${encodeURIComponent(numericId)}` +
    `?fields=id,name,status`;
  let res;
  try {
    res = await fetchWithRetry(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "LinkedIn-Version": LINKEDIN_VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });
  } catch (err) {
    return { ok: false, status: "disconnected", reason: `Network error contacting LinkedIn: ${String(err)}` };
  }
  const bodyText = await res.text();
  let body = {};
  try { body = JSON.parse(bodyText); } catch { /* leave as {} */ }

  if (res.status === 401) {
    return { ok: false, status: "token_expired", reason: "LinkedIn token is invalid or expired (60-day lifecycle). Re-authenticate." };
  }
  if (res.status === 403) {
    return { ok: false, status: "disconnected", reason: "This token does not have an admin role on the ad account." };
  }
  if (res.status === 404) {
    return { ok: false, status: "disconnected", reason: "LinkedIn ad account not found for this ID." };
  }
  if (!res.ok) {
    return { ok: false, status: "disconnected", reason: body?.message ?? `LinkedIn API error (HTTP ${res.status}).` };
  }

  const status = String(body.status ?? "").toUpperCase();
  if (status && status !== "ACTIVE") {
    return { ok: false, status: "suspended", account_name: body.name ?? null, reason: `LinkedIn reports account status ${status}.` };
  }
  return { ok: true, status: "active", account_name: body.name ?? null };
}

// Inspect a Meta token with /debug_token (a token may debug itself) and /me.
// Returns { ok, type, user_name, expires_at (ISO | null = never), scopes, reason }.
async function inspectMetaToken(token) {
  const q = (path) => `https://graph.facebook.com/${GRAPH_VERSION}/${path}`;
  let dbg = {};
  try {
    const res = await fetchWithRetry(
      q(`debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`),
      { method: "GET" },
    );
    dbg = (await res.json().catch(() => ({})))?.data ?? {};
  } catch (err) {
    return { ok: false, reason: `Network error contacting Meta: ${String(err)}` };
  }
  if (!dbg.is_valid) return { ok: false, reason: "Meta says this token is invalid or expired." };
  const scopes = Array.isArray(dbg.scopes) ? dbg.scopes : [];
  if (!scopes.includes("ads_management")) {
    return { ok: false, reason: "Token is missing the ads_management permission." };
  }
  let userName = null;
  try {
    const res = await fetchWithRetry(q(`me?fields=name&access_token=${encodeURIComponent(token)}`), { method: "GET" });
    userName = (await res.json().catch(() => ({})))?.name ?? null;
  } catch { /* name is display-only */ }
  const exp = Number(dbg.expires_at);
  return {
    ok: true,
    type: String(dbg.type ?? "").toUpperCase() || null, // USER | SYSTEM_USER | PAGE …
    user_name: userName,
    expires_at: exp > 0 ? new Date(exp * 1000).toISOString() : null,
    scopes,
  };
}

// Token metadata kept alongside credentials.access_token (display-only; the
// safe view exposes these, never the token).
const TOKEN_META_KEYS = ["access_token", "token_type", "token_user_name", "token_expires_at", "token_set_at", "token_set_by"];

const SAFE_COLUMNS = "id, platform, account_id, account_name, status, last_sync_at, created_at, updated_at, created_by";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    return json(500, { ok: false, error: "Missing SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY env" });
  }

  // ── Admin auth (user JWT → is_admin_me) ─────────────────────────────────────
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json(401, { ok: false, error: "Missing or invalid Authorization header" });
  }
  const userToken = authHeader.replace("Bearer ", "");
  const userSb = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
    auth: { persistSession: false },
  });
  const { data: adminCheck, error: adminErr } = await userSb.rpc("is_admin_me");
  if (adminErr || !isAdminResult(adminCheck)) {
    return json(403, { ok: false, error: "Forbidden – admin only" });
  }
  const { data: userData } = await userSb.auth.getUser();
  const adminUid = userData?.user?.id ?? null;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  const mode = body?.mode === "test" ? "test" : body?.mode === "set_token" ? "set_token" : "connect";

  try {
    if (mode === "set_token") {
      // ── Set or clear a per-account Meta token ───────────────────────────────
      // Political/social-issue ads must be placed by an ID-confirmed *person*;
      // a system-user token can't be, so an admin's own user token is stored
      // on the account. clear:true reverts to META_ADS_ACCESS_TOKEN.
      const connectionId = body?.connection_id;
      if (!connectionId) return json(400, { ok: false, error: "connection_id is required for mode=set_token" });
      const { data: conn, error: connErr } = await admin
        .from("ad_account_connections")
        .select("id, platform, account_id, credentials")
        .eq("id", connectionId)
        .single();
      if (connErr || !conn) return json(404, { ok: false, error: "Ad account connection not found" });
      if (conn.platform !== "meta") return json(400, { ok: false, error: "Only Meta accounts take a per-account token here" });

      const creds = { ...(conn.credentials ?? {}) };
      for (const k of TOKEN_META_KEYS) delete creds[k];
      let result;

      if (body?.clear === true) {
        result = await validateMeta(conn.account_id, Deno.env.get("META_ADS_ACCESS_TOKEN"));
      } else {
        const token = typeof body?.access_token === "string" ? body.access_token.trim() : "";
        if (!token) return json(400, { ok: false, error: "access_token is required (or pass clear:true)" });
        const info = await inspectMetaToken(token);
        if (!info.ok) return json(400, { ok: false, error: info.reason });
        result = await validateMeta(conn.account_id, token);
        if (!result.ok) return json(400, { ok: false, error: result.reason ?? "Token cannot access this ad account" });
        Object.assign(creds, {
          access_token: token,
          token_type: info.type,
          token_user_name: info.user_name,
          token_expires_at: info.expires_at,
          token_set_at: new Date().toISOString(),
          token_set_by: adminUid,
        });
      }

      const patch = { credentials: creds, status: result.status };
      if (result.ok) patch.last_sync_at = new Date().toISOString();
      const { data: updated, error: updErr } = await admin
        .from("ad_account_connections")
        .update(patch)
        .eq("id", connectionId)
        .select(SAFE_COLUMNS)
        .single();
      if (updErr) {
        log("error", "set_token_failed", { err: updErr.message });
        return json(500, { ok: false, error: "Failed to save the token" });
      }
      log("info", body?.clear === true ? "token_cleared" : "token_set", { connectionId, type: creds.token_type ?? null });
      return json(200, { ok: result.ok, status: result.status, reason: result.reason ?? null, account: updated });
    }

    if (mode === "test") {
      // ── Y1.3 test connection ────────────────────────────────────────────────
      const connectionId = body?.connection_id;
      if (!connectionId) return json(400, { ok: false, error: "connection_id is required for mode=test" });

      const { data: conn, error: connErr } = await admin
        .from("ad_account_connections")
        .select("id, platform, account_id, credentials")
        .eq("id", connectionId)
        .single();
      if (connErr || !conn) return json(404, { ok: false, error: "Ad account connection not found" });

      const creds = conn.credentials ?? {};
      const result = conn.platform === "meta"
        ? await validateMeta(conn.account_id, creds.access_token ?? Deno.env.get("META_ADS_ACCESS_TOKEN"))
        : await validateLinkedIn(conn.account_id, creds.access_token);

      const patch = { status: result.status };
      if (result.ok) patch.last_sync_at = new Date().toISOString();
      if (result.account_name) patch.account_name = result.account_name;

      const { data: updated, error: updErr } = await admin
        .from("ad_account_connections")
        .update(patch)
        .eq("id", connectionId)
        .select(SAFE_COLUMNS)
        .single();
      if (updErr) {
        log("error", "status_update_failed", { err: updErr.message });
        return json(500, { ok: false, error: "Failed to update connection status" });
      }
      return json(200, { ok: result.ok, status: result.status, reason: result.reason ?? null, account: updated });
    }

    // ── mode=connect (Y1.1 / Y1.2) ────────────────────────────────────────────
    const platform = body?.platform;
    const accountId = body?.account_id;
    if (platform !== "meta" && platform !== "linkedin") {
      return json(400, { ok: false, error: "platform must be 'meta' or 'linkedin'" });
    }
    if (!accountId || typeof accountId !== "string") {
      return json(400, { ok: false, error: "account_id is required" });
    }

    // Build the credentials object stored server-side (never returned).
    let creds = {};
    let result;
    if (platform === "meta") {
      // Optional per-account token override; else fall back to system-user token.
      const token = body?.access_token || Deno.env.get("META_ADS_ACCESS_TOKEN");
      creds = {};
      if (body?.access_token) {
        const info = await inspectMetaToken(body.access_token);
        if (!info.ok) return json(400, { ok: false, error: info.reason });
        Object.assign(creds, {
          access_token: body.access_token,
          token_type: info.type,
          token_user_name: info.user_name,
          token_expires_at: info.expires_at,
          token_set_at: new Date().toISOString(),
          token_set_by: adminUid,
        });
      }
      if (body?.business_id) creds.business_id = body.business_id;
      result = await validateMeta(accountId, token);
    } else {
      const token = body?.access_token;
      if (!token || !body?.client_id || !body?.client_secret) {
        return json(400, { ok: false, error: "LinkedIn requires client_id, client_secret and access_token" });
      }
      creds = {
        client_id: body.client_id,
        client_secret: body.client_secret,
        access_token: token,
      };
      result = await validateLinkedIn(accountId, token);
    }

    if (!result.ok) {
      // Do not store on validation failure — surface a clear reason.
      return json(400, { ok: false, error: result.reason ?? "Validation failed", status: result.status });
    }

    const normalizedAccountId = platform === "meta" && !accountId.startsWith("act_")
      ? `act_${accountId}` : accountId;

    const { data: saved, error: saveErr } = await admin
      .from("ad_account_connections")
      .upsert({
        platform,
        account_id: normalizedAccountId,
        account_name: body?.account_name ?? result.account_name ?? null,
        status: "active",
        credentials: creds,
        last_sync_at: new Date().toISOString(),
        created_by: adminUid,
      }, { onConflict: "platform,account_id" })
      .select(SAFE_COLUMNS)
      .single();

    if (saveErr) {
      log("error", "save_failed", { err: saveErr.message });
      return json(500, { ok: false, error: "Validated, but failed to save the connection" });
    }
    return json(200, { ok: true, status: "active", account: saved });
  } catch (err) {
    log("error", "unexpected", { err: String(err) });
    return json(500, { ok: false, error: "An unexpected error occurred" });
  }
});
