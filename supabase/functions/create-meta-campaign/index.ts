// supabase/functions/create-meta-campaign/index.ts
// Epic Y — Y2.5: Create & launch a Meta (Facebook/Instagram) campaign.
//
// Reads an existing campaigns row (created by the admin wizard), builds the
// full Meta object hierarchy, and stores the platform campaign id back on the
// row. Everything is created PAUSED; delivery is only submitted to Meta review
// when the caller passes activate:true.
//
// Meta hierarchy (created in this order):
//   Campaign  → objective OUTCOME_TRAFFIC, special_ad_categories per env
//   Ad Set    → budget (minor units), targeting, optimization LINK_CLICKS
//   Creative  → object_story_spec.link_data (uses the question OG image)
//   Ad        → binds the creative to the ad set
//
// Auth: admin user JWT (is_admin_me). Writes use the service role.
//
// Idempotent: if the campaign already has platform_campaign_id, it is NOT
// recreated — the existing ids are returned. This prevents duplicate spend.
//
// Env secrets:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//   META_ADS_ACCESS_TOKEN   — system-user token (ads_management). Per-account
//                             token in credentials.access_token overrides this.
//   META_FB_PAGE_ID         — Facebook Page the ads run as (REQUIRED). Per-account
//                             credentials.page_id overrides this.
//   META_GRAPH_VERSION      — optional, default "v21.0"
//   META_SPECIAL_AD_CATEGORY— optional, default "ISSUES_ELECTIONS_POLITICS".
//                             Set "NONE" to send an empty special category.
//   META_DEFAULT_CTA        — optional, default "LEARN_MORE" (Meta CTA enum;
//                             the label "Take a Stance" is not a Meta value).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FUNC = "create-meta-campaign";
const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const SPECIAL_CATEGORY = Deno.env.get("META_SPECIAL_AD_CATEGORY") ?? "ISSUES_ELECTIONS_POLITICS";
const DEFAULT_CTA = Deno.env.get("META_DEFAULT_CTA") ?? "LEARN_MORE";

function log(level, msg, extra = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, func: FUNC, msg, ...extra }));
}
function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function isAdminResult(v) {
  if (v === true) return true;
  if (v?.is_admin === true) return true;
  if (Array.isArray(v) && v[0]?.is_admin === true) return true;
  return false;
}

async function fetchWithRetry(url, init = {}, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 3;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(t);
      if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, Math.min(2 ** attempt * 500, 5000)));
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(t);
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, Math.min(2 ** attempt * 500, 5000)));
        continue;
      }
    }
  }
  throw lastErr ?? new Error("request failed");
}

// POST helper for Meta Graph edges. Returns { ok, id, error } shape.
async function metaPost(path, params, token) {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    form.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  form.set("access_token", token);
  const res = await fetchWithRetry(`${GRAPH}/${path}`, { method: "POST", body: form });
  const text = await res.text();
  let body = {};
  try { body = JSON.parse(text); } catch { /* keep {} */ }
  if (!res.ok || body?.error) {
    return { ok: false, status: res.status, error: body?.error ?? { message: `HTTP ${res.status}` } };
  }
  return { ok: true, id: body.id, body };
}

// Rasterize an SVG string → PNG bytes, in-process (no external services, no
// dependency on public buckets). Uses resvg-wasm; the wasm is initialised once.
let _resvgInit = null;
async function ensureResvg() {
  if (!_resvgInit) {
    const mod = await import("https://esm.sh/@resvg/resvg-wasm@2.6.2");
    _resvgInit = mod.initWasm(fetch("https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm")).then(() => mod);
  }
  return _resvgInit;
}
async function rasterizeSvg(svgText) {
  const mod = await ensureResvg();
  const resvg = new mod.Resvg(svgText, {
    fitTo: { mode: "width", value: 1200 },
    background: "white",
  });
  return resvg.render().asPng(); // Uint8Array
}

// base64-encode bytes in chunks (avoids call-stack limits on large buffers).
function bytesToBase64(bytes) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Upload raw image bytes to Meta /adimages → { ok, hash, error }.
async function uploadImageBytes(actId, bytes, token) {
  const res = await metaPost(`${actId}/adimages`, { bytes: bytesToBase64(bytes) }, token);
  if (!res.ok) return { ok: false, error: res.error };
  const images = res.body?.images ?? {};
  const hash = Object.values(images)[0]?.hash;
  if (!hash) return { ok: false, error: { message: "Meta did not return an image hash" } };
  return { ok: true, hash };
}

// Translate our normalized targeting jsonb → Meta targeting spec.
// Under the political special category, detailed interest targeting is dropped.
function buildMetaTargeting(t, isPolitical) {
  t = t ?? {};
  const geo = {};
  if (Array.isArray(t.countries) && t.countries.length) geo.countries = t.countries;
  // Meta wants regions as [{key}] and cities as [{key, radius, distance_unit}].
  // Strip any display fields (name/country_code) the UI carried along.
  if (Array.isArray(t.regions) && t.regions.length) {
    geo.regions = t.regions.map((r) => ({ key: String(r.key ?? r) }));
  }
  if (Array.isArray(t.cities) && t.cities.length) {
    geo.cities = t.cities.map((c) => ({
      key: String(c.key ?? c),
      radius: Number(c.radius) || 25,
      distance_unit: c.distance_unit || "mile",
    }));
  }
  // Default to a country only if nothing at all was specified.
  if (!geo.countries && !geo.regions && !geo.cities) geo.countries = ["IN"];

  const targeting = { geo_locations: geo };
  if (t.age_min) targeting.age_min = Number(t.age_min);
  if (t.age_max) targeting.age_max = Number(t.age_max);
  if (Array.isArray(t.locales) && t.locales.length) targeting.locales = t.locales.map(Number);

  // Interests only when NOT a special ad category (Meta forbids detailed
  // targeting for ISSUES_ELECTIONS_POLITICS).
  if (!isPolitical && Array.isArray(t.interests) && t.interests.length) {
    targeting.flexible_spec = [{ interests: t.interests.map((i) => ({ id: i.id, name: i.name })) }];
  }
  return targeting;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    return json(500, { ok: false, error: "Missing SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY env" });
  }

  // ── Admin auth ──────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json(401, { ok: false, error: "Missing Authorization header" });
  const userToken = authHeader.replace("Bearer ", "");
  const userSb = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
    auth: { persistSession: false },
  });
  const { data: adminCheck, error: adminErr } = await userSb.rpc("is_admin_me");
  if (adminErr || !isAdminResult(adminCheck)) return json(403, { ok: false, error: "Forbidden – admin only" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  const campaignId = body?.campaign_id;
  const activate = body?.activate === true; // default false = create PAUSED only
  if (!campaignId) return json(400, { ok: false, error: "campaign_id is required" });

  try {
    // ── Load campaign + question + ad account ─────────────────────────────────
    const { data: campaign, error: cErr } = await admin
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .single();
    if (cErr || !campaign) return json(404, { ok: false, error: "Campaign not found" });
    if (campaign.platform !== "meta") return json(400, { ok: false, error: "Campaign platform is not 'meta'" });

    // Idempotency guard — never recreate a launched campaign.
    if (campaign.platform_campaign_id) {
      return json(200, { ok: true, already_launched: true, platform_campaign_id: campaign.platform_campaign_id, status: campaign.status });
    }

    const { data: question, error: qErr } = await admin
      .from("questions")
      .select("id, question, summary, state, status, published_at, campaign_eligible")
      .eq("id", campaign.question_id)
      .single();
    if (qErr || !question) return json(404, { ok: false, error: "Anchor question not found" });
    // Live/answerable = published and not archived. status is kept in sync by
    // the question state machine (archived → 'archived', else 'active'), so a
    // freshly published question in state 'new' is a valid campaign target.
    const answerable = question.status === "active" && !!question.published_at;
    if (!answerable) return json(400, { ok: false, error: "Anchor question is not live (must be published and not archived)" });
    if (question.campaign_eligible === false) return json(400, { ok: false, error: "Question is marked not campaign-eligible" });

    if (!campaign.ad_account_id) return json(400, { ok: false, error: "Campaign has no ad account assigned" });
    const { data: acct, error: aErr } = await admin
      .from("ad_account_connections")
      .select("id, platform, account_id, status, credentials")
      .eq("id", campaign.ad_account_id)
      .single();
    if (aErr || !acct) return json(404, { ok: false, error: "Ad account connection not found" });
    if (acct.platform !== "meta") return json(400, { ok: false, error: "Assigned ad account is not a Meta account" });
    if (acct.status !== "active") return json(400, { ok: false, error: `Ad account status is ${acct.status}, not active` });

    const creds = acct.credentials ?? {};
    const token = creds.access_token || Deno.env.get("META_ADS_ACCESS_TOKEN");
    const pageId = creds.page_id || Deno.env.get("META_FB_PAGE_ID");
    if (!token) return json(500, { ok: false, error: "No Meta access token (set META_ADS_ACCESS_TOKEN)" });
    if (!pageId) return json(400, { ok: false, error: "No Facebook Page configured (set META_FB_PAGE_ID). An ad creative requires a Page." });

    const actId = acct.account_id.startsWith("act_") ? acct.account_id : `act_${acct.account_id}`;

    // ── Derived creative + destination ────────────────────────────────────────
    const isPolitical = SPECIAL_CATEGORY && SPECIAL_CATEGORY.toUpperCase() !== "NONE";
    const specialCategories = isPolitical ? [SPECIAL_CATEGORY.toUpperCase()] : [];
    // Meta v24+ requires special_ad_category_country whenever a special category
    // is set. Derive it from every targeted geo — explicit countries plus the
    // country of any selected region/city (so a city-only campaign is still valid).
    const t0 = campaign.targeting ?? {};
    const regionCountries = Array.isArray(t0.regions) ? t0.regions.map((r) => r.country_code).filter(Boolean) : [];
    const cityCountries = Array.isArray(t0.cities) ? t0.cities.map((c) => c.country_code).filter(Boolean) : [];
    const targetedCountries = [...new Set([
      ...(Array.isArray(t0.countries) ? t0.countries : []),
      ...regionCountries,
      ...cityCountries,
    ].map((c) => String(c).toUpperCase()))];
    if (targetedCountries.length === 0) targetedCountries.push("IN");

    const headline = (campaign.creative_headline || question.question || "").slice(0, 40);
    const bodyCopy = campaign.creative_body ||
      `${(question.summary || question.question || "").slice(0, 200)} Share your stance.`;
    const imageUrl = campaign.creative_image_url ||
      `${SUPABASE_URL}/functions/v1/og-image?question_id=${question.id}`;
    const destinationUrl = campaign.destination_url ||
      `${(Deno.env.get("PUBLIC_SITE_URL") ?? "https://www.stancecapture.com")}/#/q/${question.id}` +
      `?ref=campaign&campaign_id=${campaign.id}&utm_source=meta&utm_medium=paid&utm_campaign=${campaign.id}`;

    // Budget → minor units (account currency assumed USD; cents).
    const budgetMinor = Math.round(Number(campaign.budget_amount) * 100);
    if (!budgetMinor || budgetMinor <= 0) return json(400, { ok: false, error: "Invalid budget_amount" });

    // ── 1. Campaign (PAUSED) ──────────────────────────────────────────────────
    const campaignParams = {
      name: campaign.name,
      objective: "OUTCOME_TRAFFIC",
      status: "PAUSED",
      special_ad_categories: specialCategories,
      buying_type: "AUCTION",
      // Budget is set at the ad-set level (not CBO), so Meta requires this to be
      // declared explicitly. false = ad sets do not share budget.
      is_adset_budget_sharing_enabled: false,
    };
    // Required by Meta when a special ad category is declared.
    if (isPolitical) campaignParams.special_ad_category_country = targetedCountries;
    const campRes = await metaPost(`${actId}/campaigns`, campaignParams, token);
    if (!campRes.ok) {
      log("error", "meta_campaign_create_failed", { err: campRes.error });
      return json(502, {
        ok: false,
        error: `Meta campaign create failed: ${campRes.error?.error_user_msg || campRes.error?.message}`,
        meta_error: campRes.error,
      });
    }
    const metaCampaignId = campRes.id;

    // ── 2. Ad Set (PAUSED) ────────────────────────────────────────────────────
    const targeting = buildMetaTargeting(campaign.targeting, isPolitical);
    const adsetParams = {
      name: `${campaign.name} — Ad Set`,
      campaign_id: metaCampaignId,
      billing_event: "IMPRESSIONS",
      optimization_goal: "LINK_CLICKS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      targeting,
      status: "PAUSED",
    };
    // Daily vs total budget → daily_budget / lifetime_budget (minor units).
    // Scheduling rules (Meta): start_time should be in the future; any end_time
    // must be at least 24h after the start. We compute a safe start, and only
    // set an end_time when it clears the 24h minimum.
    const DAY_MS = 86400000;
    const now = Date.now();
    // Effective start: the chosen start date at 00:00 UTC, but never in the past
    // (bump 1h into the future if it is). Meta needs a future start_time.
    let startMs = campaign.start_date ? Date.parse(`${campaign.start_date}T00:00:00+0000`) : now + 3600_000;
    if (isNaN(startMs) || startMs <= now) startMs = now + 3600_000;
    const startIso = new Date(startMs).toISOString();
    // Requested end (end of the chosen end date), if any.
    const endMs = campaign.end_date ? Date.parse(`${campaign.end_date}T23:59:59+0000`) : NaN;
    const hasValidEnd = !isNaN(endMs) && endMs - startMs >= DAY_MS; // 24h minimum

    if (campaign.budget_type === "total") {
      adsetParams.lifetime_budget = budgetMinor;
      // A lifetime budget requires an end_time; guarantee it is 24h+ out.
      adsetParams.start_time = startIso;
      adsetParams.end_time = new Date(hasValidEnd ? endMs : startMs + 8 * DAY_MS).toISOString();
    } else {
      adsetParams.daily_budget = budgetMinor;
      adsetParams.start_time = startIso;
      // Daily budgets run continuously; only set an end when it clears 24h.
      if (hasValidEnd) adsetParams.end_time = new Date(endMs).toISOString();
    }
    const adsetRes = await metaPost(`${actId}/adsets`, adsetParams, token);
    if (!adsetRes.ok) {
      log("error", "meta_adset_create_failed", { err: adsetRes.error });
      // Roll back the campaign so we don't leave an orphan.
      await metaPost(metaCampaignId, { status: "DELETED" }, token).catch(() => {});
      return json(502, { ok: false, error: `Meta ad set create failed: ${adsetRes.error?.error_user_msg || adsetRes.error?.message}`, meta_error: adsetRes.error });
    }
    const metaAdSetId = adsetRes.id;

    // ── 3. Ad Creative ────────────────────────────────────────────────────────
    // Meta /adimages needs JPG/PNG; og-image is SVG. Primary path: fetch the SVG
    // bytes via service auth (proven to work) and rasterize in-process. Fallback:
    // rasterize via the wsrv image proxy against a public URL. Admin-supplied
    // raster creative_image_url is used directly.
    const isRaster = (u) => /\.(png|jpe?g|webp)(\?|$)/i.test(u || "");
    let pngBytes = null;
    let imgError = null;

    if (campaign.creative_image_url && isRaster(campaign.creative_image_url) && !campaign.creative_image_url.includes("/og-image")) {
      try {
        const r = await fetchWithRetry(campaign.creative_image_url, { method: "GET" }, { timeoutMs: 20_000 });
        if (r.ok) pngBytes = new Uint8Array(await r.arrayBuffer());
        else imgError = { message: `Creative image fetch HTTP ${r.status}` };
      } catch (e) { imgError = { message: String(e) }; }
    } else {
      // og-image is SVG. Primary: rasterize via wsrv (librsvg — renders text with
      // real fonts). Fallback: in-process resvg (no system fonts, so text may be
      // missing, but better than failing). First ensure the SVG file exists.
      try {
        await fetchWithRetry(imageUrl, {
          method: "GET",
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
        }, { timeoutMs: 25_000 });
      } catch { /* best-effort warm */ }

      let publicSvgUrl = null;
      try {
        const { data: cached } = await admin
          .from("og_image_cache").select("image_url").eq("question_id", question.id).maybeSingle();
        if (cached?.image_url) publicSvgUrl = cached.image_url;
      } catch { /* construct below */ }
      if (!publicSvgUrl) publicSvgUrl = `${SUPABASE_URL}/storage/v1/object/public/og-images/questions/${question.id}.svg`;

      // Primary: wsrv → PNG (renders text).
      const wsrvUrl = `https://wsrv.nl/?url=${encodeURIComponent(publicSvgUrl)}&output=png&w=1200&h=628&fit=cover&bg=white`;
      try {
        const r = await fetchWithRetry(wsrvUrl, { method: "GET" }, { timeoutMs: 25_000 });
        if (r.ok) {
          const b = new Uint8Array(await r.arrayBuffer());
          if (b.length > 1000) pngBytes = b; // guard against tiny/error responses
          else imgError = { message: "Rasterizer returned an empty image" };
        } else {
          imgError = { message: `Rasterization HTTP ${r.status}` };
        }
      } catch (e) { imgError = { message: String(e) }; }

      // Fallback: in-process resvg from the SVG bytes.
      if (!pngBytes) {
        try {
          const r = await fetchWithRetry(imageUrl, {
            method: "GET",
            headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
          }, { timeoutMs: 25_000 });
          if (r.ok) {
            const svgText = await r.text();
            pngBytes = await rasterizeSvg(svgText);
          }
        } catch (e) { log("warn", "resvg_fallback_failed", { err: String(e) }); }
      }
    }

    if (!pngBytes) {
      await metaPost(metaCampaignId, { status: "DELETED" }, token).catch(() => {});
      return json(502, { ok: false, error: `Could not prepare a creative image: ${imgError?.message ?? "unknown"}`, meta_error: imgError });
    }

    const imgUpload = await uploadImageBytes(actId, pngBytes, token);
    if (!imgUpload.ok) {
      log("error", "meta_image_upload_failed", { err: imgUpload.error });
      await metaPost(metaCampaignId, { status: "DELETED" }, token).catch(() => {});
      return json(502, { ok: false, error: `Meta image upload failed: ${imgUpload.error?.error_user_msg || imgUpload.error?.message}`, meta_error: imgUpload.error });
    }

    const objectStorySpec = {
      page_id: pageId,
      link_data: {
        link: destinationUrl,
        message: bodyCopy,
        name: headline,
        image_hash: imgUpload.hash,
        call_to_action: { type: DEFAULT_CTA, value: { link: destinationUrl } },
      },
    };
    const creativeRes = await metaPost(`${actId}/adcreatives`, {
      name: `${campaign.name} — Creative`,
      object_story_spec: objectStorySpec,
    }, token);
    if (!creativeRes.ok) {
      log("error", "meta_creative_create_failed", { err: creativeRes.error });
      await metaPost(metaCampaignId, { status: "DELETED" }, token).catch(() => {});
      return json(502, { ok: false, error: `Meta creative create failed: ${creativeRes.error?.error_user_msg || creativeRes.error?.message}`, meta_error: creativeRes.error });
    }
    const metaCreativeId = creativeRes.id;

    // ── 4. Ad (PAUSED) ────────────────────────────────────────────────────────
    const adRes = await metaPost(`${actId}/ads`, {
      name: `${campaign.name} — Ad`,
      adset_id: metaAdSetId,
      creative: { creative_id: metaCreativeId },
      status: "PAUSED",
    }, token);
    if (!adRes.ok) {
      log("error", "meta_ad_create_failed", { err: adRes.error });
      await metaPost(metaCampaignId, { status: "DELETED" }, token).catch(() => {});
      return json(502, { ok: false, error: `Meta ad create failed: ${adRes.error?.error_user_msg || adRes.error?.message}`, meta_error: adRes.error });
    }
    const metaAdId = adRes.id;

    // ── 5. Optionally submit to review (activate) ─────────────────────────────
    let finalStatus = "pending_review";
    if (activate) {
      // Activating the campaign submits the hierarchy to Meta review.
      const act1 = await metaPost(metaCampaignId, { status: "ACTIVE" }, token);
      const act2 = await metaPost(metaAdSetId, { status: "ACTIVE" }, token);
      const act3 = await metaPost(metaAdId, { status: "ACTIVE" }, token);
      if (!act1.ok || !act2.ok || !act3.ok) {
        // Objects exist but activation failed — surface it; leave as pending_review.
        log("warn", "activation_partial_failure", { act1: act1.error, act2: act2.error, act3: act3.error });
      } else {
        finalStatus = "pending_review"; // Meta review begins now; stays pending until approved
      }
    }

    // ── 6. Persist platform ids on our campaigns row ──────────────────────────
    const mergedTargeting = {
      ...(campaign.targeting ?? {}),
      _platform_ids: { campaign: metaCampaignId, adset: metaAdSetId, creative: metaCreativeId, ad: metaAdId },
    };
    const { data: saved, error: saveErr } = await admin
      .from("campaigns")
      .update({
        platform_campaign_id: metaCampaignId,
        status: finalStatus,
        creative_image_url: imageUrl,
        creative_headline: headline,
        creative_body: bodyCopy,
        destination_url: destinationUrl,
        targeting: mergedTargeting,
      })
      .eq("id", campaign.id)
      .select("id, status, platform_campaign_id")
      .single();
    if (saveErr) {
      // Meta objects were created but our row failed to update — return the ids
      // so the admin can reconcile rather than relaunching (which would duplicate).
      log("error", "row_update_failed_after_launch", { err: saveErr.message, metaCampaignId });
      return json(500, {
        ok: false,
        error: "Launched on Meta but failed to update the campaign row. Do NOT relaunch — reconcile with the returned ids.",
        platform_campaign_id: metaCampaignId,
      });
    }

    return json(200, {
      ok: true,
      platform_campaign_id: metaCampaignId,
      status: saved.status,
      activated: activate,
      ids: { campaign: metaCampaignId, adset: metaAdSetId, creative: metaCreativeId, ad: metaAdId },
    });
  } catch (err) {
    log("error", "unexpected", { err: String(err) });
    return json(500, { ok: false, error: "An unexpected error occurred" });
  }
});
