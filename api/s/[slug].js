// api/s/[slug].js
//
// Share endpoint for clean, per-question link previews — WITHOUT touching your
// HashRouter/auth. A crawler (WhatsApp, Facebook, iMessage, X) requesting
// /s/<slug> gets HTML with question-specific OG tags; a human gets redirected
// into the SPA at /#/q/<id> (ref preserved). Wired via vercel.json: /s/:slug -> here.
//
// Vercel project env needed (Production + Preview):
//   SUPABASE_URL          (e.g. https://yzxzpnomcarnxixhjlba.supabase.co)
//   SUPABASE_ANON_KEY     (anon public key — questions are public-read)
//   PUBLIC_SITE_URL       (e.g. https://www.stancecapture.com)

function esc(s = "") {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function fetchQuestion(base, anon, filter) {
  const url = `${base}/rest/v1/questions?${filter}&select=id,slug,question,share_headline,context_summary,summary,cover_image_url&limit=1`;
  const r = await fetch(url, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } });
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// This endpoint always runs on the same domain it needs to redirect back into
// (dev/uat/prod each serve their own /s/:slug via vercel.json), so derive SITE
// from the request itself rather than trusting a per-project env var. That env
// var (PUBLIC_SITE_URL) has to be set separately per Vercel project and is easy
// to leave unset or stale — when it is, this used to silently fall back to the
// hardcoded prod default and redirect dev/uat clicks into prod, where the
// question doesn't exist ("Question not found"). PUBLIC_SITE_URL is kept as an
// explicit override for anyone who genuinely needs to force a different host.
function siteFromRequest(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return host ? `${proto}://${host}` : null;
}

export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const SITE = siteFromRequest(req) || process.env.PUBLIC_SITE_URL || "https://www.stancecapture.com";

  const slug = String(req.query.slug || "");
  const ref = req.query.ref ? String(req.query.ref) : "";

  let q = null;
  if (SUPABASE_URL && ANON && slug) {
    // BUG FIX: fetchQuestion already returns null gracefully for a non-2xx
    // response (see `if (!r.ok) return null` inside it) — but nothing
    // protected against it actually THROWING: a network failure reaching
    // Supabase, a DNS hiccup, a timeout, or r.json() choking on a
    // non-JSON body all propagated straight up out of this handler
    // uncaught, crashing the whole function with a raw 500
    // (FUNCTION_INVOCATION_FAILED) instead of reaching the fallback
    // rendering below — which already exists and already handles "no
    // question found" correctly. This wraps the same lookup so ANY
    // failure mode, not just an HTTP error status, lands on that same
    // existing fallback (generic OG card + redirect to SITE root) rather
    // than a dead crash page a real visitor could click into off WhatsApp.
    try {
      q = await fetchQuestion(SUPABASE_URL, ANON, `slug=eq.${encodeURIComponent(slug)}`);
      if (!q) q = await fetchQuestion(SUPABASE_URL, ANON, `id=eq.${encodeURIComponent(slug)}`);
    } catch (err) {
      console.error("[api/s/[slug]] question lookup failed, falling back:", err?.message ?? err);
      q = null;
    }
  }

  // Fallbacks keep the redirect working even if the lookup fails.
  const title = esc((q?.share_headline || q?.question || "Stance Capture — Where do you stand?").slice(0, 110));
  const desc = esc((q?.context_summary || q?.summary || "See where people stand and add your view.").slice(0, 180));
  // BUG FIX: this always used a static generic image, ignoring
  // questions.cover_image_url entirely — the same field the rest of the app
  // (HeroSection, QuestionCard, QuestionDetailPage) reads directly for this
  // exact purpose. Use it when present; static image is now purely the
  // fallback for the rare question with none.
  const image = q?.cover_image_url || `${SITE}/og-image.png`;
  // Dimensions are only known for the static fallback (built at exactly
  // 1200x630). A per-question cover_image_url is arbitrary editorial
  // photography of unknown aspect ratio — asserting the wrong dimensions can
  // make a crawler crop or distort it rather than just detecting the real
  // size itself, which most (WhatsApp included) do fine when left unset.
  const imageDims = q?.cover_image_url
    ? ""
    : `\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">`;
  const canonical = `${SITE}/s/${esc(slug)}`;
  const target = q?.id
    ? `${SITE}/#/q/${q.id}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`
    : `${SITE}/`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  res.status(q ? 200 : 404).end(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Stance Capture">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${image}">${imageDims}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${image}">
<script>location.replace(${JSON.stringify(target)});</script>
</head>
<body style="font-family:system-ui;padding:24px;text-align:center;color:#475569">
Opening the question… <a href="${esc(target)}">Continue →</a>
</body></html>`);
}
