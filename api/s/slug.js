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
  const url = `${base}/rest/v1/questions?${filter}&select=id,slug,question,share_headline,context_summary,summary&limit=1`;
  const r = await fetch(url, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } });
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const SITE = process.env.PUBLIC_SITE_URL || "https://www.stancecapture.com";

  const slug = String(req.query.slug || "");
  const ref = req.query.ref ? String(req.query.ref) : "";

  let q = null;
  if (SUPABASE_URL && ANON && slug) {
    q = await fetchQuestion(SUPABASE_URL, ANON, `slug=eq.${encodeURIComponent(slug)}`);
    if (!q) q = await fetchQuestion(SUPABASE_URL, ANON, `id=eq.${encodeURIComponent(slug)}`);
  }

  // Fallbacks keep the redirect working even if the lookup fails.
  const title = esc((q?.share_headline || q?.question || "Stance Capture — Where do you stand?").slice(0, 110));
  const desc = esc((q?.context_summary || q?.summary || "See where people stand and add your view.").slice(0, 180));
  const image = `${SITE}/og-image.png`;
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
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${image}">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<script>location.replace(${JSON.stringify(target)});</script>
</head>
<body style="font-family:system-ui;padding:24px;text-align:center;color:#475569">
Opening the question… <a href="${esc(target)}">Continue →</a>
</body></html>`);
}
