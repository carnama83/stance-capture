// api/c/[code].js
//
// Tracked campaign link: /c/<code> (Facebook Campaign Manager PDD v1.2 §12).
// Wired via vercel.json: /c/:code -> here. Same shape as api/s/[slug].js:
// crawlers (Facebook re-scrapes every posted link) get question-specific OG
// tags; a human is sent into the SPA at /#/q/<id>?lang=<lang>&cv=<code>.
//
// The visit is NOT recorded here. Facebook's crawler would count as a visit on
// every scrape. The SPA records it in the browser (useCampaignVisitCapture),
// keeps the visit id in localStorage for 7 days, and strips `cv` from the URL
// so the code does not travel when the page is shared onward.
//
// The code resolves through rpc/resolve_campaign_link (anon, read-only). The
// helpers below mirror api/s/[slug].js; keep the two in step.
//
// Vercel env (already set for api/s): SUPABASE_URL, SUPABASE_ANON_KEY.

const OG_LOCALE_MAP = { en: "en_US", hi: "hi_IN", mr: "mr_IN" };
const ogLocale = (lang) => OG_LOCALE_MAP[lang] || `${lang}_IN`;

function esc(s = "") {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function shorten(text, max) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:—–-]+$/, "") + "…";
}

function splitAsk(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t.endsWith("?")) return null;
  const body = t.slice(0, -1);
  const cut = Math.max(body.lastIndexOf("; "), body.lastIndexOf(". "), body.lastIndexOf("। "));
  if (cut < 0) return null;
  let ask = t.slice(cut + 2)
    .replace(/,?\s*(do you think|what do you think|in your view|in your opinion)\?$/i, "?")
    .trim();
  ask = ask.charAt(0).toUpperCase() + ask.slice(1);
  if (ask.length < 15 || ask.length > 140) return null;
  return { ask, context: t.slice(0, cut + 1).trim() };
}

function siteFromRequest(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return host ? `${proto}://${host}` : null;
}

async function rest(base, anon, path, init) {
  const r = await fetch(`${base}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
  });
  if (!r.ok) return null;
  return r.json();
}

export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const SITE = siteFromRequest(req) || process.env.PUBLIC_SITE_URL || "https://www.stancecapture.com";

  const codeParam = String(req.query.code || "").toLowerCase();
  const code = /^[a-z0-9]{8,12}$/.test(codeParam) ? codeParam : "";

  let link = null;
  let q = null;
  let rendition = null;
  if (SUPABASE_URL && ANON && code) {
    try {
      const rows = await rest(SUPABASE_URL, ANON, "rpc/resolve_campaign_link", {
        method: "POST",
        body: JSON.stringify({ p_code: code }),
      });
      link = Array.isArray(rows) && rows.length ? rows[0] : null;
      if (link?.question_id) {
        const qs = await rest(SUPABASE_URL, ANON,
          `questions?id=eq.${encodeURIComponent(link.question_id)}&select=id,question,share_headline,context_summary,summary,cover_image_url&limit=1`);
        q = Array.isArray(qs) && qs.length ? qs[0] : null;
        if (q && link.language_code && link.language_code !== "en") {
          const rs = await rest(SUPABASE_URL, ANON,
            `question_renditions?question_id=eq.${encodeURIComponent(q.id)}&language_code=eq.${encodeURIComponent(link.language_code)}&lifecycle_status=eq.published&select=rendered_text,context_summary&order=published_at.desc&limit=1`);
          rendition = Array.isArray(rs) && rs.length ? rs[0] : null;
        }
      }
    } catch (err) {
      console.error("[api/c/[code]] lookup failed, falling back:", err?.message ?? err);
    }
  }

  const lang = link?.language_code && link.language_code !== "en" ? link.language_code : "";
  const htmlLang = rendition ? lang : "en";
  const questionText = rendition?.rendered_text || q?.question || "";
  const split = splitAsk(questionText);
  const headline = rendition ? "" : (q?.share_headline || "");
  const title = esc(
    headline ? shorten(headline, 110)
      : split ? split.ask
      : shorten(questionText || "Stance Capture — Where do you stand?", 110)
  );
  const desc = esc(shorten(
    rendition?.context_summary || q?.context_summary || q?.summary ||
      (split && !headline ? split.context : "") ||
      "See where people stand and add your view.",
    200,
  ));
  const image = q?.cover_image_url || `${SITE}/og-image.png`;
  const imageDims = q?.cover_image_url
    ? ""
    : `\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">`;

  // Language travels as ?lang= (honoured by useLanguage unless the visitor has
  // explicitly chosen a language on this device).
  const target = q?.id
    ? `${SITE}/#/q/${q.id}?${[lang ? `lang=${encodeURIComponent(lang)}` : "", `cv=${code}`].filter(Boolean).join("&")}`
    : `${SITE}/`;
  const canonical = `${SITE}/c/${code}`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  res.status(q ? 200 : 404).end(`<!doctype html>
<html lang="${esc(htmlLang)}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Stance Capture">
<meta property="og:locale" content="${esc(ogLocale(htmlLang))}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(image)}">${imageDims}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${esc(image)}">
<script>location.replace(${JSON.stringify(target)});</script>
</head>
<body style="font-family:system-ui;padding:24px;text-align:center;color:#475569">
Opening the question… <a href="${esc(target)}">Continue →</a>
</body></html>`);
}
