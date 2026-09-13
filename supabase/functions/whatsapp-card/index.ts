// supabase/functions/whatsapp-card/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resvg, initWasm } from "https://esm.sh/@resvg/resvg-wasm@2.6.2?target=deno";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const STORAGE_BUCKET = "og-images";

const BRAND_BLUE = "#1E3A5F";
const BRAND_ACC = "#2D9CDB";
const AGREE_COLOR = "#27AE60";
const NEUTRAL_COLOR = "#94A3B8";
const OPPOSE_COLOR = "#DC2626";
const BAND_BG = "#1A202C";

const CARD_RENDER_VERSION = 4;

const FONT_PATHS = [
  "fonts/DejaVuSans.ttf",
  "fonts/DejaVuSans-Bold.ttf",
  "fonts/DejaVuSerif-Bold.ttf",
];
let fontBuffersCache = null;
async function ensureFonts(sb) {
  if (fontBuffersCache) return fontBuffersCache;
  const buffers = [];
  for (const path of FONT_PATHS) {
    try {
      const { data } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      const resp = await fetch(data.publicUrl, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) throw new Error(`font fetch failed: ${resp.status}`);
      buffers.push(new Uint8Array(await resp.arrayBuffer()));
    } catch (err) {
      console.error(`[whatsapp-card] font fetch failed for ${path}:`, err?.message ?? err);
    }
  }
  fontBuffersCache = buffers;
  return fontBuffersCache;
}

let wasmReady = false;
async function ensureWasm() {
  if (wasmReady) return;
  try {
    const wasmResp = await fetch("https://esm.sh/@resvg/resvg-wasm@2.6.2/index_bg.wasm", {
      signal: AbortSignal.timeout(5000),
    });
    if (!wasmResp.ok) throw new Error(`wasm fetch failed: ${wasmResp.status}`);
    await initWasm(wasmResp);
    wasmReady = true;
  } catch (err) {
    console.error("[whatsapp-card] WASM init failed:", err?.message ?? err);
    throw err;
  }
}

async function fetchImageBytes(url, extraHeaders) {
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(5000),
    headers: {
      "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      ...extraHeaders,
    },
  });
  if (!resp.ok) {
    let bodySnippet = "";
    try { bodySnippet = (await resp.text()).slice(0, 300); } catch { /* ignore */ }
    throw new Error(`fetch failed: ${resp.status} — body: ${bodySnippet}`);
  }
  const contentType = resp.headers.get("content-type") || "";
  const bytes = new Uint8Array(await resp.arrayBuffer());
  if (!contentType.startsWith("image/")) {
    throw new Error(`non-image content-type: "${contentType}" (${bytes.length} bytes)`);
  }
  if (bytes.length < 500) {
    throw new Error(`suspiciously small body: ${bytes.length} bytes, content-type "${contentType}"`);
  }
  return { bytes, contentType };
}

function bytesToDataUri(bytes, contentType) {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}

async function fetchPhotoAsDataUri(url, refererOrigin) {
  try {
    const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(url.replace(/^https?:\/\//, ""))}&w=1200&output=jpg`;
    const { bytes, contentType } = await fetchImageBytes(proxyUrl, {});
    return bytesToDataUri(bytes, contentType);
  } catch (err) {
    console.error("[whatsapp-card] wsrv.nl proxy fetch failed:", err?.message ?? err);
  }

  try {
    const headers = refererOrigin ? { Referer: refererOrigin } : {};
    const { bytes, contentType } = await fetchImageBytes(url, headers);
    console.error("[whatsapp-card] wsrv.nl failed, direct fetch succeeded (NOT color-normalized)");
    return bytesToDataUri(bytes, contentType);
  } catch (err) {
    console.error("[whatsapp-card] direct photo fetch also failed:", err?.message ?? err);
  }

  throw new Error("photo fetch failed via proxy and direct paths");
}

async function resolvePhotoDataUri(newsItem, coverImageUrl, refererOrigin) {
  if (newsItem?.image_hosting_status === "success" && newsItem?.hosted_image_url) {
    try {
      const { bytes, contentType } = await fetchImageBytes(newsItem.hosted_image_url, {});
      console.error("[whatsapp-card] tier 1 hit — served from hosted_image_url:", newsItem.hosted_image_url);
      return bytesToDataUri(bytes, contentType);
    } catch (err) {
      console.error("[whatsapp-card] hosted_image_url fetch failed, trying live URL:", err?.message ?? err);
    }
  }

  if (newsItem?.image_hosting_status === "failed") {
    return null;
  }

  if (coverImageUrl) {
    try {
      return await fetchPhotoAsDataUri(coverImageUrl, refererOrigin);
    } catch (err) {
      console.error("[whatsapp-card] live photo fetch also failed, rendering placeholder:", err?.message ?? err);
    }
  }
  return null;
}

function escapeXml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  }[c]));
}

function truncateAtWord(str, maxLen) {
  const s = String(str ?? "");
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + "…";
}

function buildPhotoCardSvg(question, stats, photoDataUri) {
  const W = 1200, H = 630;
  const agree = Math.round(stats?.pct_agree ?? 0);
  const oppose = Math.round(stats?.pct_disagree ?? 0);
  const neutral = Math.round(stats?.pct_neutral ?? Math.max(0, 100 - agree - oppose));
  const responses = stats?.total_responses ?? 0;
  const respLabel = responses === 0
    ? "Be the first to respond"
    : responses === 1
    ? "1 response"
    : `${responses.toLocaleString()} responses`;

  const BAND_H = 190, BAND_Y = H - BAND_H;
  const BAR_X = 120, BAR_W = 960, BAR_H = 48;
  const BAR_Y = BAND_Y + 130;
  const agreeW = Math.round(agree / 100 * BAR_W);
  const neutralW = Math.round(neutral / 100 * BAR_W);
  const opposeW = BAR_W - agreeW - neutralW;
  const BAR_RX = BAR_H / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <clipPath id="frame"><rect x="0" y="0" width="${W}" height="${H}"/></clipPath>
    <clipPath id="barClip"><rect x="${BAR_X}" y="${BAR_Y}" width="${BAR_W}" height="${BAR_H}" rx="${BAR_RX}"/></clipPath>
  </defs>
  <g clip-path="url(#frame)">
    ${photoDataUri
      ? `<image href="${photoDataUri}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`
      : `<rect x="0" y="0" width="${W}" height="${H}" fill="${BRAND_BLUE}"/>
    <text x="${W / 2}" y="${H / 2}" font-family="DejaVu Sans" font-size="26" fill="#CBD5E1" text-anchor="middle">${escapeXml(truncateAtWord(question?.question, 70))}</text>`}
  </g>
  <rect x="0" y="${BAND_Y}" width="${W}" height="${BAND_H}" fill="${BAND_BG}" fill-opacity="0.88"/>
  <text x="${BAR_X}" y="${BAND_Y + 52}" font-family="DejaVu Serif" font-size="46" font-weight="700" fill="${BRAND_ACC}">Stance Capture</text>
  <text x="${BAR_X}" y="${BAR_Y - 18}" font-family="DejaVu Sans" font-size="30" fill="#CBD5E1">Community stance</text>
  <text x="${W - BAR_X}" y="${BAR_Y - 18}" font-family="DejaVu Sans" font-size="30" fill="#CBD5E1" text-anchor="end">${respLabel}</text>
  <rect x="${BAR_X}" y="${BAR_Y}" width="${BAR_W}" height="${BAR_H}" rx="${BAR_RX}" fill="${NEUTRAL_COLOR}" fill-opacity="0.3"/>
  <g clip-path="url(#barClip)">
    <rect x="${BAR_X}" y="${BAR_Y}" width="${agreeW}" height="${BAR_H}" fill="${AGREE_COLOR}"/>
    <rect x="${BAR_X + agreeW}" y="${BAR_Y}" width="${neutralW}" height="${BAR_H}" fill="${NEUTRAL_COLOR}"/>
    <rect x="${BAR_X + agreeW + neutralW}" y="${BAR_Y}" width="${opposeW}" height="${BAR_H}" fill="${OPPOSE_COLOR}"/>
  </g>
  ${agreeW > 105 ? `<text x="${BAR_X + agreeW / 2}" y="${BAR_Y + 33}" font-family="DejaVu Sans" font-size="28" font-weight="700" fill="white" text-anchor="middle">${agree}%</text>` : ""}
  ${opposeW > 105 ? `<text x="${BAR_X + agreeW + neutralW + opposeW / 2}" y="${BAR_Y + 33}" font-family="DejaVu Sans" font-size="28" font-weight="700" fill="white" text-anchor="middle">${oppose}%</text>` : ""}
</svg>`;
}

class CardError extends Error {
  constructor(message, status = 500, code = "unhandled") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function respondJson(body, corsHeaders, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function renderCard(sb, qId, stats) {
  const { data: q, error: qErr } = await sb
    .from("questions")
    .select("id, question, cover_image_url, cover_news_item_id")
    .eq("id", qId)
    .maybeSingle();
  if (qErr || !q) throw new CardError("question not found", 404, "not_found");

  let refererOrigin = null;
  let newsItem = null;
  if (q.cover_news_item_id) {
    const { data } = await sb
      .from("news_items")
      .select("url, hosted_image_url, image_hosting_status")
      .eq("id", q.cover_news_item_id)
      .maybeSingle();
    newsItem = data;
    if (newsItem?.url) {
      try { refererOrigin = new URL(newsItem.url).origin + "/"; } catch { /* malformed url, skip */ }
    }
  }

  const photoDataUri = await resolvePhotoDataUri(newsItem, q.cover_image_url, refererOrigin);

  const fontBuffers = await ensureFonts(sb);
  function renderSvgToPng(svgString) {
    const opts = { fitTo: { mode: "width", value: 1200 } };
    if (fontBuffers.length > 0) opts.font = { fontBuffers, loadSystemFonts: false };
    const resvgInstance = new Resvg(svgString, opts);
    return resvgInstance.render();
  }
  function photoRegionIsBlank(rendered) {
    const samplePoints = [[200, 100], [600, 200], [1000, 300], [300, 400]];
    return samplePoints.every(([x, y]) => {
      const idx = (y * rendered.width + x) * 4;
      return rendered.pixels[idx + 3] === 0;
    });
  }

  let pngBytes;
  try {
    await ensureWasm();
    let svg = buildPhotoCardSvg(q, stats, photoDataUri);
    let rendered = renderSvgToPng(svg);

    if (photoDataUri && photoRegionIsBlank(rendered)) {
      console.error("[whatsapp-card] photo region rendered blank (undecodable color space) — downgrading to placeholder");
      svg = buildPhotoCardSvg(q, stats, null);
      rendered = renderSvgToPng(svg);
    }
    pngBytes = rendered.asPng();
  } catch (err) {
    throw new CardError(`render_failed: ${err?.message ?? err}`, 500, "render_failed");
  }

  const storagePath = `whatsapp-cards/${qId}.png`;
  const { error: uploadErr } = await sb.storage.from(STORAGE_BUCKET).upload(storagePath, pngBytes, {
    contentType: "image/png",
    upsert: true,
    cacheControl: "3600",
  });
  if (uploadErr) throw new CardError(`upload_failed: ${uploadErr.message}`, 500, "upload_failed");

  const { data: urlData } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  if (!urlData?.publicUrl) throw new CardError("no_public_url", 500, "no_public_url");
  return urlData.publicUrl;
}

async function saveCardToCache(sb, qId, imageUrl, stats) {
  await sb.from("whatsapp_card_cache").upsert({
    question_id: qId,
    image_url: imageUrl,
    cached_total_responses: stats?.total_responses ?? 0,
    stats_updated_at: stats?.updated_at ?? null,
    render_version: CARD_RENDER_VERSION,
    generated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    regenerating_since: null,
  }, { onConflict: "question_id" });
}

async function renderAndCacheCard(sb, qId, stats) {
  const imageUrl = await renderCard(sb, qId, stats);
  await saveCardToCache(sb, qId, imageUrl, stats);
  return imageUrl;
}

function withVersion(imageUrl, statsUpdatedAt, renderVersion) {
  if (!imageUrl) return imageUrl;
  const sep = imageUrl.includes("?") ? "&" : "?";
  return `${imageUrl}${sep}v=${encodeURIComponent(statsUpdatedAt ?? "none")}-r${encodeURIComponent(renderVersion ?? 0)}`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const qId = url.searchParams.get("question_id");
  const bust = url.searchParams.get("bust") === "1";
  const fresh = url.searchParams.get("fresh") === "1";
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!qId) return respondJson({ error: "question_id required" }, corsHeaders, 400);

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const { data: stats } = await sb
      .from("question_stance_stats_region")
      .select("total_responses, pct_agree, pct_disagree, pct_neutral, updated_at")
      .eq("question_id", qId)
      .eq("region_scope", "global")
      .eq("region_key", "global")
      .maybeSingle();
    const liveStatsUpdatedAt = stats?.updated_at ?? null;

    if (!bust) {
      const { data: cached } = await sb
        .from("whatsapp_card_cache")
        .select("image_url, stats_updated_at, render_version")
        .eq("question_id", qId)
        .maybeSingle();
      if (cached?.image_url && cached.stats_updated_at === liveStatsUpdatedAt && cached.render_version === CARD_RENDER_VERSION) {
        return respondJson({ image_url: withVersion(cached.image_url, cached.stats_updated_at, cached.render_version), cache: "HIT" }, corsHeaders);
      }
    }

    const { data: claimRows, error: claimErr } = await sb.rpc("claim_card_regeneration", {
      p_question_id: qId,
      p_lease_seconds: 30,
    });
    if (claimErr) {
      console.error("[whatsapp-card] claim RPC failed, rendering directly:", claimErr.message);
      const imageUrl = await renderAndCacheCard(sb, qId, stats);
      return respondJson({ image_url: withVersion(imageUrl, liveStatsUpdatedAt, CARD_RENDER_VERSION), cache: "MISS_NO_CLAIM" }, corsHeaders);
    }
    const claim = claimRows?.[0];

    if (claim?.image_url) {
      if (claim.claimed) {
        if (fresh) {
          const imageUrl = await renderAndCacheCard(sb, qId, stats);
          return respondJson({ image_url: withVersion(imageUrl, liveStatsUpdatedAt, CARD_RENDER_VERSION), cache: "MISS_FRESH" }, corsHeaders);
        }
        EdgeRuntime.waitUntil(
          renderAndCacheCard(sb, qId, stats).catch((err) =>
            console.error("[whatsapp-card] background regeneration failed:", err?.message ?? err)
          )
        );
        return respondJson({ image_url: withVersion(claim.image_url, claim.stats_updated_at, claim.render_version), cache: "STALE_REVALIDATING" }, corsHeaders);
      }
      if (fresh) {
        for (let attempt = 0; attempt < 3; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          const { data: retry } = await sb
            .from("whatsapp_card_cache")
            .select("image_url, stats_updated_at, render_version")
            .eq("question_id", qId)
            .maybeSingle();
          if (retry?.image_url && retry.stats_updated_at === liveStatsUpdatedAt && retry.render_version === CARD_RENDER_VERSION) {
            return respondJson({ image_url: withVersion(retry.image_url, retry.stats_updated_at, retry.render_version), cache: "HIT_AFTER_WAIT_FRESH" }, corsHeaders);
          }
        }
        console.error("[whatsapp-card] fresh-mode wait for concurrent regeneration exhausted, rendering directly:", qId);
        const imageUrl = await renderAndCacheCard(sb, qId, stats);
        return respondJson({ image_url: withVersion(imageUrl, liveStatsUpdatedAt, CARD_RENDER_VERSION), cache: "MISS_FRESH_FALLBACK" }, corsHeaders);
      }
      return respondJson({ image_url: withVersion(claim.image_url, claim.stats_updated_at, claim.render_version), cache: "STALE_SHARED" }, corsHeaders);
    }

    if (claim?.claimed) {
      const imageUrl = await renderAndCacheCard(sb, qId, stats);
      return respondJson({ image_url: withVersion(imageUrl, liveStatsUpdatedAt, CARD_RENDER_VERSION), cache: "MISS" }, corsHeaders);
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const { data: retry } = await sb
        .from("whatsapp_card_cache")
        .select("image_url, stats_updated_at, render_version")
        .eq("question_id", qId)
        .maybeSingle();
      if (retry?.image_url) {
        return respondJson({ image_url: withVersion(retry.image_url, retry.stats_updated_at ?? liveStatsUpdatedAt, retry.render_version ?? CARD_RENDER_VERSION), cache: "HIT_AFTER_WAIT" }, corsHeaders);
      }
    }
    console.error("[whatsapp-card] cold-start poll exhausted, rendering as last resort:", qId);
    const imageUrl = await renderAndCacheCard(sb, qId, stats);
    return respondJson({ image_url: withVersion(imageUrl, liveStatsUpdatedAt, CARD_RENDER_VERSION), cache: "MISS_FALLBACK" }, corsHeaders);
  } catch (err) {
    const status = err?.status ?? 500;
    const code = err?.code ?? "unhandled";
    console.error(`[whatsapp-card] ${code}:`, err?.message ?? err);
    return respondJson({ error: code, detail: String(err?.message ?? err) }, corsHeaders, status);
  }
});
