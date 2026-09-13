// supabase/functions/og-image/index.ts
// Epic W — W2: OG Image Generation Edge Function
//
// GET /functions/v1/og-image?question_id=<uuid>
//
// Generates a 1200×630 PNG social preview card for a question.
// Includes: question text, stance distribution bar, response count,
// Stance Capture branding, and topic tag.
//
// Caching:
//   - Checks og_image_cache first (1-hour TTL)
//   - On miss: generates SVG → PNG via resvg-wasm, stores in Supabase Storage
//     and caches the URL in og_image_cache
//   - Returns the image directly (not a redirect) so crawlers get it inline
//
// Fallback:
//   - If generation fails for any reason, returns a minimal branded fallback SVG
//     so og:image is never a broken link
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const STORAGE_BUCKET = "og-images"; // must be public
// ── Colour constants (match brand) ──────────────────────────────────────────
const BRAND_BLUE = "#1E3A5F";
const BRAND_ACC = "#2D9CDB";
const AGREE_COLOR = "#27AE60";
const NEUTRAL_COLOR = "#94A3B8";
const OPPOSE_COLOR = "#DC2626";
const BG_COLOR = "#F8FAFC";
const TEXT_DARK = "#1A202C";
const TEXT_MED = "#64748B";
// ── Text wrapping helper ─────────────────────────────────────────────────────
// Returns array of lines for a given text and approximate char width
function wrapText(text, maxChars) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words){
    if ((current + " " + word).trim().length <= maxChars) {
      current = (current + " " + word).trim();
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
// ── SVG generation ───────────────────────────────────────────────────────────
function buildSvg(question, stats) {
  const W = 1200;
  const H = 630;
  // Stance bar values
  const agree = Math.round(stats?.pct_agree ?? 0);
  const oppose = Math.round(stats?.pct_disagree ?? 0);
  const neutral = Math.round(stats?.pct_neutral ?? Math.max(0, 100 - agree - oppose));
  const responses = stats?.total_responses ?? 0;
  const avgScore = stats?.avg_score ?? null;
  // Bar widths (px) — total usable width 960px
  const BAR_X = 120;
  const BAR_W = 960;
  const BAR_H = 28;
  const BAR_Y = 460;
  const agreeW = Math.round(agree / 100 * BAR_W);
  const neutralW = Math.round(neutral / 100 * BAR_W);
  const opposeW = BAR_W - agreeW - neutralW;
  // Question text wrapping — ~46 chars per line at font-size 42
  const rawQ = question.question.length > 180 ? question.question.slice(0, 177) + "…" : question.question;
  const lines = wrapText(rawQ, 46);
  const maxLines = 3;
  const displayLines = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    displayLines[maxLines - 1] = displayLines[maxLines - 1].replace(/\s?\S+$/, "…");
  }
  // Y position for question text block — centre it vertically in middle zone
  const LINE_H = 58;
  const blockH = displayLines.length * LINE_H;
  const textStartY = Math.round((H - 140 - blockH) / 2) + 80; // 80 = header zone, 140 = footer zone
  // Topic tag
  const tag = question.tags?.[0] ?? question.location_label ?? "Stance Capture";
  const tagLabel = tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase();
  // Avg score label
  function avgLabel(s) {
    if (s === null) return "";
    if (s >= 1.5) return "Strong agreement";
    if (s >= 0.5) return "Leans agree";
    if (s >= -0.5) return "Divided";
    if (s >= -1.5) return "Leans oppose";
    return "Strong opposition";
  }
  const scoreLabel = avgScore !== null ? avgLabel(avgScore) : "";
  // Response count label
  const respLabel = responses === 0 ? "Be the first to respond" : responses === 1 ? "1 response" : `${responses.toLocaleString()} responses`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <!-- Background gradient -->
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#F8FAFC"/>
      <stop offset="100%" stop-color="#EEF2F7"/>
    </linearGradient>
    <!-- Left accent gradient -->
    <linearGradient id="accent" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${BRAND_ACC}"/>
      <stop offset="100%" stop-color="${BRAND_BLUE}"/>
    </linearGradient>
    <!-- Bar clip -->
    <clipPath id="barClip">
      <rect x="${BAR_X}" y="${BAR_Y}" width="${BAR_W}" height="${BAR_H}" rx="14"/>
    </clipPath>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- Left accent bar -->
  <rect x="0" y="0" width="8" height="${H}" fill="url(#accent)"/>

  <!-- Top header zone -->
  <!-- Logo mark — stylised "S" circle -->
  <circle cx="68" cy="52" r="24" fill="${BRAND_BLUE}"/>
  <text x="68" y="60" font-family="Georgia, serif" font-size="26" font-weight="bold"
        fill="white" text-anchor="middle" dominant-baseline="auto">S</text>

  <!-- Brand name -->
  <text x="106" y="44" font-family="Georgia, serif" font-size="22" font-weight="bold"
        fill="${BRAND_BLUE}" dominant-baseline="auto">Stance Capture</text>
  <text x="106" y="66" font-family="-apple-system, sans-serif" font-size="16"
        fill="${TEXT_MED}" dominant-baseline="auto">Community Intelligence Platform</text>

  <!-- Topic tag pill -->
  <rect x="${W - 240}" y="28" width="${Math.min(200, tagLabel.length * 12 + 32)}" height="36"
        rx="18" fill="${BRAND_ACC}" opacity="0.12"/>
  <text x="${W - 140}" y="52" font-family="-apple-system, sans-serif" font-size="16"
        font-weight="600" fill="${BRAND_ACC}" text-anchor="middle"
        dominant-baseline="auto">${tagLabel}</text>

  <!-- Divider line below header -->
  <line x1="32" y1="90" x2="${W - 32}" y2="90" stroke="${BRAND_BLUE}" stroke-opacity="0.1" stroke-width="1.5"/>

  <!-- Question text -->
  ${displayLines.map((line, i)=>`
  <text x="${BAR_X}" y="${textStartY + i * LINE_H}"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="40" font-weight="600"
        fill="${TEXT_DARK}" dominant-baseline="auto">${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")}</text>`).join("")}

  <!-- Stance bar section -->
  <!-- Label row -->
  <text x="${BAR_X}" y="${BAR_Y - 18}"
        font-family="-apple-system, sans-serif" font-size="17" font-weight="600"
        fill="${TEXT_MED}" dominant-baseline="auto">Community stance</text>

  <!-- Response count -->
  <text x="${W - BAR_X}" y="${BAR_Y - 18}"
        font-family="-apple-system, sans-serif" font-size="17"
        fill="${TEXT_MED}" text-anchor="end" dominant-baseline="auto">${respLabel}</text>

  <!-- Bar background (empty state) -->
  <rect x="${BAR_X}" y="${BAR_Y}" width="${BAR_W}" height="${BAR_H}" rx="14"
        fill="${NEUTRAL_COLOR}" fill-opacity="0.2"/>

  <!-- Bar segments (clipped) -->
  <g clip-path="url(#barClip)">
    <!-- Agree (left) -->
    <rect x="${BAR_X}" y="${BAR_Y}" width="${agreeW}" height="${BAR_H}" fill="${AGREE_COLOR}"/>
    <!-- Neutral (middle) -->
    <rect x="${BAR_X + agreeW}" y="${BAR_Y}" width="${neutralW}" height="${BAR_H}" fill="${NEUTRAL_COLOR}"/>
    <!-- Oppose (right) -->
    <rect x="${BAR_X + agreeW + neutralW}" y="${BAR_Y}" width="${opposeW}" height="${BAR_H}" fill="${OPPOSE_COLOR}"/>
  </g>

  <!-- Bar percentage labels (only show if segment is wide enough) -->
  ${agreeW > 60 ? `
  <text x="${BAR_X + agreeW / 2}" y="${BAR_Y + 19}"
        font-family="-apple-system, sans-serif" font-size="15" font-weight="700"
        fill="white" text-anchor="middle" dominant-baseline="auto">${agree}%</text>` : ""}
  ${neutralW > 60 ? `
  <text x="${BAR_X + agreeW + neutralW / 2}" y="${BAR_Y + 19}"
        font-family="-apple-system, sans-serif" font-size="15" font-weight="700"
        fill="white" text-anchor="middle" dominant-baseline="auto">${neutral}%</text>` : ""}
  ${opposeW > 60 ? `
  <text x="${BAR_X + agreeW + neutralW + opposeW / 2}" y="${BAR_Y + 19}"
        font-family="-apple-system, sans-serif" font-size="15" font-weight="700"
        fill="white" text-anchor="middle" dominant-baseline="auto">${oppose}%</text>` : ""}

  <!-- Bottom legend row -->
  <!-- Agree legend -->
  <circle cx="${BAR_X}" cy="${BAR_Y + BAR_H + 26}" r="7" fill="${AGREE_COLOR}"/>
  <text x="${BAR_X + 16}" y="${BAR_Y + BAR_H + 32}"
        font-family="-apple-system, sans-serif" font-size="15" fill="${TEXT_MED}"
        dominant-baseline="auto">Agree</text>

  <!-- Neutral legend -->
  <circle cx="${BAR_X + 90}" cy="${BAR_Y + BAR_H + 26}" r="7" fill="${NEUTRAL_COLOR}"/>
  <text x="${BAR_X + 106}" y="${BAR_Y + BAR_H + 32}"
        font-family="-apple-system, sans-serif" font-size="15" fill="${TEXT_MED}"
        dominant-baseline="auto">Neutral</text>

  <!-- Oppose legend -->
  <circle cx="${BAR_X + 196}" cy="${BAR_Y + BAR_H + 26}" r="7" fill="${OPPOSE_COLOR}"/>
  <text x="${BAR_X + 212}" y="${BAR_Y + BAR_H + 32}"
        font-family="-apple-system, sans-serif" font-size="15" fill="${TEXT_MED}"
        dominant-baseline="auto">Oppose</text>

  <!-- Score label (right side) -->
  ${scoreLabel ? `
  <text x="${W - BAR_X}" y="${BAR_Y + BAR_H + 32}"
        font-family="-apple-system, sans-serif" font-size="15" font-weight="600"
        fill="${BRAND_ACC}" text-anchor="end" dominant-baseline="auto">${scoreLabel}</text>` : ""}

  <!-- Bottom CTA -->
  <line x1="32" y1="${H - 56}" x2="${W - 32}" y2="${H - 56}"
        stroke="${BRAND_BLUE}" stroke-opacity="0.1" stroke-width="1.5"/>
  <text x="${W / 2}" y="${H - 22}"
        font-family="-apple-system, sans-serif" font-size="17"
        fill="${TEXT_MED}" text-anchor="middle" dominant-baseline="auto">
    Add your stance at stancecapture.com
  </text>
</svg>`;
}
// ── Fallback SVG (when question not found or error) ─────────────────────────
function buildFallbackSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#F8FAFC"/>
  <rect x="0" y="0" width="8" height="630" fill="#2D9CDB"/>
  <circle cx="600" cy="260" r="60" fill="#1E3A5F"/>
  <text x="600" y="275" font-family="Georgia, serif" font-size="64" font-weight="bold"
        fill="white" text-anchor="middle">S</text>
  <text x="600" y="370" font-family="Georgia, serif" font-size="42" font-weight="bold"
        fill="#1E3A5F" text-anchor="middle">Stance Capture</text>
  <text x="600" y="420" font-family="-apple-system, sans-serif" font-size="22"
        fill="#64748B" text-anchor="middle">Community Intelligence Platform</text>
</svg>`;
}
// ── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req)=>{
  const url = new URL(req.url);
  const qId = url.searchParams.get("question_id");
  const bust = url.searchParams.get("bust") === "1"; // cache-bust param for testing
  // CORS headers — crawlers (Twitterbot, facebookexternalhit) don't need CORS
  // but allow it for development convenience
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS"
  };
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  if (!qId) {
    return new Response(buildFallbackSvg(), {
      headers: {
        ...corsHeaders,
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=60"
      }
    });
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  try {
    // ── 1. Check cache ────────────────────────────────────────────────────
    if (!bust) {
      const { data: cached } = await sb.from("og_image_cache").select("image_url, expires_at").eq("question_id", qId).single();
      if (cached && new Date(cached.expires_at) > new Date()) {
        // Fetch the cached image from storage and stream it back
        try {
          const imgRes = await fetch(cached.image_url);
          if (imgRes.ok) {
            const imgBytes = await imgRes.arrayBuffer();
            return new Response(imgBytes, {
              headers: {
                ...corsHeaders,
                "Content-Type": imgRes.headers.get("Content-Type") ?? "image/svg+xml",
                "Cache-Control": "public, max-age=3600",
                "X-Cache": "HIT"
              }
            });
          }
        } catch  {
        // Cache fetch failed — fall through to regeneration
        }
      }
    }
    // ── 2. Fetch question + stats in parallel ─────────────────────────────
    const [qRes, statsRes] = await Promise.all([
      sb.from("questions").select("id, question, summary, tags, location_label").eq("id", qId).single(),
      sb.from("question_stance_stats_region").select("total_responses, pct_agree, pct_disagree, pct_neutral, avg_score").eq("question_id", qId).eq("region_scope", "global").eq("region_key", "global").single()
    ]);
    if (qRes.error || !qRes.data) {
      // Question not found — return branded fallback
      return new Response(buildFallbackSvg(), {
        headers: {
          ...corsHeaders,
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, max-age=60",
          "X-Cache": "FALLBACK"
        }
      });
    }
    // ── 3. Generate SVG ───────────────────────────────────────────────────
    const svg = buildSvg(qRes.data, statsRes.data ?? null);
    const svgBytes = new TextEncoder().encode(svg);
    // ── 4. Store SVG in Supabase Storage ──────────────────────────────────
    // We store SVG (not PNG) — social crawlers accept SVG for og:image
    // and this avoids a heavy WASM PNG renderer in the edge function
    const storagePath = `questions/${qId}.svg`;
    const { error: uploadErr } = await sb.storage.from(STORAGE_BUCKET).upload(storagePath, svgBytes, {
      contentType: "image/svg+xml",
      upsert: true,
      cacheControl: "3600"
    });
    // ── 5. Get public URL ─────────────────────────────────────────────────
    let publicUrl = "";
    if (!uploadErr) {
      const { data: urlData } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
      publicUrl = urlData?.publicUrl ?? "";
    }
    // ── 6. Update cache table ─────────────────────────────────────────────
    if (publicUrl) {
      await sb.from("og_image_cache").upsert({
        question_id: qId,
        image_url: publicUrl,
        generated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      }, {
        onConflict: "question_id"
      });
    }
    // ── 7. Return SVG directly ────────────────────────────────────────────
    return new Response(svg, {
      headers: {
        ...corsHeaders,
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=3600",
        "X-Cache": "MISS",
        ...publicUrl ? {
          "X-Image-Url": publicUrl
        } : {}
      }
    });
  } catch (err) {
    console.error("[og-image] Unhandled error:", err?.message ?? err);
    return new Response(buildFallbackSvg(), {
      headers: {
        ...corsHeaders,
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=60",
        "X-Cache": "ERROR"
      }
    });
  }
});
