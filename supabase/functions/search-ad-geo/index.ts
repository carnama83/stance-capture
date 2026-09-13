// supabase/functions/search-ad-geo/index.ts
// Epic Y — Y2.2: Geo targeting typeahead. Proxies Meta's adgeolocation search so
// the admin can resolve state/region and city names into the Meta geo *keys*
// that ad-set targeting requires (a name or our locations-table id won't work).
//
// Admin-only. Body: { query: string, types?: string[], country_code?: string }
//   types default ["region","city"].
// Returns: { ok, results: [{ key, name, type, country_code, country_name, region, region_id }] }
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//      META_ADS_ACCESS_TOKEN, META_GRAPH_VERSION (default v21.0)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const ALLOWED_TYPES = ["region", "city", "country", "subcity", "zip", "geo_market", "electoral_district"];

function json(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function isAdminResult(v) { return v === true || v?.is_admin === true || (Array.isArray(v) && v[0]?.is_admin === true); }

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !ANON_KEY) return json(500, { ok: false, error: "Missing Supabase env" });

  // Admin auth
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json(401, { ok: false, error: "Missing Authorization header" });
  const userSb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: adminCheck, error: adminErr } = await userSb.rpc("is_admin_me");
  if (adminErr || !isAdminResult(adminCheck)) return json(403, { ok: false, error: "Forbidden – admin only" });

  const token = Deno.env.get("META_ADS_ACCESS_TOKEN");
  if (!token) return json(500, { ok: false, error: "META_ADS_ACCESS_TOKEN not set" });

  let body = {}; try { body = await req.json(); } catch { body = {}; }
  const query = (body?.query ?? "").toString().trim();
  if (query.length < 2) return json(200, { ok: true, results: [] });

  let types = Array.isArray(body?.types) && body.types.length ? body.types : ["region", "city"];
  types = types.filter((t) => ALLOWED_TYPES.includes(t));
  if (!types.length) types = ["region", "city"];
  const countryFilter = (body?.country_code ?? "").toString().trim().toUpperCase();

  const params = new URLSearchParams({
    type: "adgeolocation",
    location_types: JSON.stringify(types),
    q: query,
    limit: "20",
    access_token: token,
  });

  let res;
  try {
    res = await fetch(`${GRAPH}/search?${params.toString()}`, { method: "GET" });
  } catch (err) {
    return json(502, { ok: false, error: `Meta geo search failed: ${String(err)}` });
  }
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* {} */ }
  if (!res.ok || data?.error) {
    return json(502, { ok: false, error: data?.error?.message ?? `Meta geo search HTTP ${res.status}`, meta_error: data?.error });
  }

  let results = (data.data ?? []).map((r) => ({
    key: String(r.key),
    name: r.name,
    type: r.type,
    country_code: r.country_code ?? null,
    country_name: r.country_name ?? null,
    region: r.region ?? null,       // present for cities
    region_id: r.region_id ?? null,
  }));
  if (countryFilter) results = results.filter((r) => (r.country_code ?? "").toUpperCase() === countryFilter);

  return json(200, { ok: true, results });
});
