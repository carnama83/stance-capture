// supabase/functions/generate-export/index.ts
// Epic N — Secure Export Download
//
// Generates a user's stance export, writes it to a private Supabase Storage
// bucket (exports/), and returns a signed URL valid for 60 seconds.
// The file is automatically overwritten on each export request so storage
// does not grow unboundedly.
//
// Auth: requires valid user JWT (anon cannot export)
// Returns: { url: string, filename: string, expires_in: 60 }
//
// Storage bucket required:
//   Name: "exports"
//   Public: false
//   RLS: service role writes, no public reads
//   Create via Supabase dashboard or:
//     INSERT INTO storage.buckets (id, name, public)
//     VALUES ('exports', 'exports', false)
//     ON CONFLICT DO NOTHING;
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const SIGNED_URL_TTL = 60; // seconds
const BUCKET = "exports";
function toCSV(rows) {
  const headers = [
    "question_id",
    "question_text",
    "current_score",
    "first_answered",
    "last_updated",
    "change_count",
    "rationale",
    "links"
  ];
  const escape = (v)=>`"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r)=>[
      r.question_id,
      r.question_text,
      r.current_score,
      r.first_answered,
      r.last_updated,
      r.change_count,
      r.rationale ?? "",
      (r.links ?? []).join("; ")
    ].map(escape).join(","));
  return [
    headers.join(","),
    ...lines
  ].join("\n");
}
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: CORS
    });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      error: "Method not allowed"
    }), {
      status: 405,
      headers: {
        ...CORS,
        "Content-Type": "application/json"
      }
    });
  }
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({
      error: "Unauthorized"
    }), {
      status: 401,
      headers: {
        ...CORS,
        "Content-Type": "application/json"
      }
    });
  }
  try {
    const body = await req.json().catch(()=>({}));
    const format = body?.format === "json" ? "json" : "csv";
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    // User client — calls export RPC as the authenticated user
    const userSb = createClient(SUPABASE_URL, ANON_KEY, {
      global: {
        headers: {
          Authorization: authHeader
        }
      },
      auth: {
        persistSession: false
      }
    });
    // Verify auth and get user ID
    const { data: { user }, error: authErr } = await userSb.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({
        error: "Unauthorized"
      }), {
        status: 401,
        headers: {
          ...CORS,
          "Content-Type": "application/json"
        }
      });
    }
    // Fetch export data via the user-scoped RPC
    const { data, error: exportErr } = await userSb.rpc("get_my_stance_export");
    if (exportErr) throw exportErr;
    const rows = data ?? [];
    // Serialise to requested format
    const date = new Date().toISOString().slice(0, 10);
    const filename = `stance-export-${date}.${format}`;
    const content = format === "json" ? JSON.stringify(rows, null, 2) : toCSV(rows);
    const mimeType = format === "json" ? "application/json" : "text/csv";
    // Service role client for Storage operations
    const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);
    // Ensure bucket exists (idempotent)
    await adminSb.storage.createBucket(BUCKET, {
      public: false
    }).catch(()=>{});
    // Storage path: exports/<user_id>/<filename>
    // Using user_id prefix ensures one active export file per user per format.
    // The upsert overwrites any previous export — no unbounded growth.
    const storagePath = `${user.id}/${filename}`;
    const { error: uploadErr } = await adminSb.storage.from(BUCKET).upload(storagePath, content, {
      contentType: mimeType,
      upsert: true
    });
    if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);
    // Generate signed URL — valid for SIGNED_URL_TTL seconds
    const { data: signedData, error: signErr } = await adminSb.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL, {
      download: filename
    });
    if (signErr || !signedData?.signedUrl) {
      throw new Error(`Failed to create signed URL: ${signErr?.message}`);
    }
    return new Response(JSON.stringify({
      url: signedData.signedUrl,
      filename,
      format,
      row_count: rows.length,
      expires_in: SIGNED_URL_TTL
    }), {
      headers: {
        ...CORS,
        "Content-Type": "application/json"
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({
      error: msg
    }), {
      status: 500,
      headers: {
        ...CORS,
        "Content-Type": "application/json"
      }
    });
  }
});
