// api/s/[slug].js
//
// Share endpoint for clean, per-question link previews — WITHOUT touching your
// HashRouter/auth. A crawler (WhatsApp, Facebook, iMessage, X) requesting
// /s/<slug> gets HTML with question-specific OG tags; a human gets redirected
// into the SPA at /#/q/<id> (ref preserved). Wired via vercel.json: /s/:slug -> here.
//
// LANGUAGE VARIANTS: /s/<slug>/<lang> (e.g. /s/abc123/hi) resolves a published
// question_renditions row for OG title, and is a genuinely different cache
// identity from /s/<slug> — WhatsApp/Facebook cache a preview per exact URL,
// not per viewer, so a path-segment variant is what lets a Hindi share stay
// Hindi through an entire forward chain without any language ever being
// tracked or re-derived downstream. Deliberately a path segment, not a query
// param — see inline note at `canonical` below for why.
//
// KNOWN GAP: question_renditions has no rendition of share_headline — a
// Hindi variant's og:title still falls back to the literal (transcreated)
// question text rather than a crafted headline, since share_headline itself
// is only ever written in the canonical language. context_summary/summary
// used to have the same gap; context_summary now has its own rendition
// field (Sep 2026) and og:description below uses it when a resolved
// rendition has one. `summary` (a shorter, different field used elsewhere,
// e.g. IncidentSummaryCard) is unaffected and stays English-only.
//
// Vercel project env needed (Production + Preview):
//   SUPABASE_URL          (e.g. https://yzxzpnomcarnxixhjlba.supabase.co)
//   SUPABASE_ANON_KEY     (anon public key — questions are public-read)
//   PUBLIC_SITE_URL       (e.g. https://www.stancecapture.com)

// og:locale wants underscore-joined language_region, not a bare language code.
// Only en/hi matter today; anything else falls back to `<lang>_IN` — a
// reasonable default given this is an India-focused platform, but worth
// revisiting explicitly as each new language actually goes active rather
// than trusting the fallback indefinitely.
const OG_LOCALE_MAP = { en: "en_US", hi: "hi_IN" };
function ogLocale(lang) {
  return OG_LOCALE_MAP[lang] || `${lang}_IN`;
}

function esc(s = "") {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Shorten at a word boundary with an ellipsis. Hard slicing cut the Pune
// question's card title to "…a City Post Of" (Sep 2026).
function shorten(text, max) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:—–-]+$/, "") + "…";
}

// Long questions are "context; the actual ask?". Split them so the card title
// is the ask and the description carries the context. Returns null when there
// is no clear ask to pull out (then the whole text is shortened instead).
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

async function fetchQuestion(base, anon, filter) {
  const url = `${base}/rest/v1/questions?${filter}&select=id,slug,question,share_headline,context_summary,summary,cover_image_url&limit=1`;
  const r = await fetch(url, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } });
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// Only called when a language segment is present and isn't the canonical
// language — returns null (not a throw) for "no published rendition yet",
// which the caller treats as a normal, expected fallback-to-English case,
// not an error. A Hindi link for a question with no Hindi rendition yet
// should still resolve and redirect correctly, just showing English.
async function fetchRendition(base, anon, questionId, lang) {
  const url = `${base}/rest/v1/question_renditions?question_id=eq.${encodeURIComponent(questionId)}&language_code=eq.${encodeURIComponent(lang)}&transform_status=eq.published&select=rendered_text,slider_low_label,slider_high_label,context_summary&limit=1`;
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
  // Only a well-formed share_events id is passed on to the SPA.
  const sidParam = req.query.sid ? String(req.query.sid) : "";
  const sid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sidParam) ? sidParam : "";
  // Present only on the /s/:slug/:lang rewrite (see vercel.json) — absent for
  // plain /s/:slug requests, which keep behaving exactly as before.
  const langParam = req.query.lang ? String(req.query.lang) : "";
  // Everything downstream treats "en" identically to "no language segment" —
  // there's no rendition to look up for the canonical language, and we don't
  // want /s/abc123/en to become a second cache identity for the same content
  // /s/abc123 already serves.
  const lang = langParam && langParam !== "en" ? langParam : "";
  // Epic R R-09: ?ledger=<regionId> sends a human to the Public Expectation
  // Ledger for that region instead of the question. Only a well-formed UUID is
  // accepted; anything else is ignored and the link opens the question as before.
  const ledgerParam = req.query.ledger ? String(req.query.ledger) : "";
  const ledgerRegion = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ledgerParam) ? ledgerParam : "";

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

  // Resolve the rendition AFTER the question lookup (need q.id), and only
  // when a non-canonical language segment was actually requested. Same
  // never-throw contract as fetchQuestion above: any failure here just means
  // no rendition, not a crashed page.
  let rendition = null;
  if (SUPABASE_URL && ANON && q?.id && lang) {
    try {
      rendition = await fetchRendition(SUPABASE_URL, ANON, q.id, lang);
    } catch (err) {
      console.error("[api/s/[slug]] rendition lookup failed, falling back to canonical:", err?.message ?? err);
      rendition = null;
    }
  }
  // True only when we actually have Hindi (etc.) content to show — a
  // requested-but-unpublished language still renders correctly, just in
  // English, exactly like q === null still renders the generic fallback card.
  const resolvedLang = rendition ? lang : "";

  // Fallbacks keep the redirect working even if the lookup fails.
  // No share_headline rendition exists yet (see file-header note) — the best
  // available Hindi title is the transcreated question text itself, not a
  // crafted headline the way the English path gets via share_headline.
  // Title: a crafted share_headline wins (English only); otherwise the ask
  // pulled out of the question text, so the card leads with what is actually
  // being asked; otherwise the text shortened at a word.
  const questionText = rendition?.rendered_text || q?.question || "";
  const split = splitAsk(questionText);
  const headline = rendition ? "" : (q?.share_headline || "");
  const title = esc(
    headline ? shorten(headline, 110)
      : split ? split.ask
      : shorten(questionText || "Stance Capture — Where do you stand?", 110)
  );
  // Sep 2026: prefer the resolved rendition's context_summary (a genuine
  // Hindi/etc. translation, not the English fallback) — see file header.
  // Falls through to the canonical English context_summary/summary, then to
  // the context part of the question when the title took only the ask.
  const desc = esc(shorten(
    rendition?.context_summary || q?.context_summary || q?.summary ||
      (split && !headline ? split.context : "") ||
      "See where people stand and add your view.",
    200,
  ));
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
  // resolvedLang (not the raw requested `lang`) drives the canonical tag —
  // an unpublished-language request must NOT get a distinct cache identity
  // for content that's actually identical to the English page; that would
  // just fragment the cache for zero benefit. This is also exactly the
  // derived-URL trap flagged when this was a query-param design: every
  // derived URL below (canonical AND target) reads from the same
  // resolvedLang variable, so there's no second place for it to be
  // forgotten if this file gets touched again later.
  const canonical = `${SITE}/s/${esc(slug)}${resolvedLang ? `/${esc(resolvedLang)}` : ""}`;
  const target = q?.id
    ? `${SITE}/#/${ledgerRegion ? `ledger/${q.id}/${ledgerRegion}` : `q/${q.id}`}?${[
        resolvedLang ? `lang=${encodeURIComponent(resolvedLang)}` : "",
        ref ? `ref=${encodeURIComponent(ref)}` : "",
        // sid identifies the share_events row; useShareClickTracker records the
        // click from it. Dropping it here meant no shared link ever registered a
        // click (every share of the launch question read 0, Sep 2026).
        sid ? `sid=${encodeURIComponent(sid)}` : "",
      ].filter(Boolean).join("&")}`.replace(/\?$/, "")
    : `${SITE}/`;
  const htmlLang = resolvedLang || "en";

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  res.status(q ? 200 : 404).end(`<!doctype html>
<html lang="${esc(htmlLang)}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Stance Capture">
<meta property="og:locale" content="${esc(ogLocale(htmlLang))}">
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
${ledgerRegion ? "Opening the ledger…" : "Opening the question…"} <a href="${esc(target)}">Continue →</a>
</body></html>`);
}
