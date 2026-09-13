// supabase/functions/enrich-images/index.ts
//
// Phase 2: OG Image Enrichment Job
// v2 — pipeline_jobs logging added (reconciled Sep 2026).
//
// Finds news_items with image_url = null, fetches HTML from news_items.url,
// extracts og:image / twitter:image, writes back to news_items.image_url.
//
// After enrichment, calls assign_draft_covers_batch() and
// assign_question_covers_batch() to propagate images to drafts/questions.
//
// Triggered by: POST with x-cron-secret header
// Env vars required:
//   CRON_SECRET                   — auth
//   SUPABASE_URL                  — your project URL
//   SUPABASE_SERVICE_ROLE_KEY     — service role key (writes to news_items)
//
// Deploy: supabase functions deploy enrich-images
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// ─── pipeline_jobs logging (best-effort — never blocks the actual pipeline work) ──
async function startPipelineJob(sb, jobType) {
  try {
    const { data, error } = await sb.from("pipeline_jobs").insert({
      job_type: jobType,
      status: "running",
      metadata: {}
    }).select("id").single();
    if (error) {
      log("warn", "pipeline_job_start_failed_nonblocking", { error: error.message });
      return null;
    }
    return data?.id ?? null;
  } catch (e) {
    log("warn", "pipeline_job_start_failed_nonblocking", { error: e?.message ?? String(e) });
    return null;
  }
}
async function finishPipelineJob(sb, jobId, patch) {
  if (!jobId) return;
  try {
    await sb.from("pipeline_jobs").update(patch).eq("id", jobId);
  } catch (e) {
    log("warn", "pipeline_job_finish_failed_nonblocking", { error: e?.message ?? String(e) });
  }
}
// ─── Config ──────────────────────────────────────────────────────────────
const BATCH_SIZE = 30; // news_items to process per run
const FETCH_TIMEOUT_MS = 8000; // per-article fetch timeout
const MAX_HTML_BYTES = 50_000; // ✅ stop streaming after 50KB — meta tags are always in <head>
const MAX_COVER_BATCH = 200; // max drafts/questions to assign covers to per run
// ── Image mirroring (see migration comment on news_items.hosted_image_url
// for the full why). Reuses the existing public og-images bucket — same
// bucket whatsapp-card and og-image already write to — under a new prefix,
// rather than provisioning a new bucket/policy for this.
const IMAGE_HOST_BUCKET = "og-images";
const IMAGE_HOST_PREFIX = "news-covers";
const MIRROR_TIMEOUT_MS = 8000; // per-image mirror fetch timeout
// Separate batch size from BATCH_SIZE above — this is a different backlog
// (rows that already have image_url but were never mirrored, from ANY
// source, not just today's fresh scrapes) with its own pace of catching up.
const MIRROR_BACKFILL_BATCH_SIZE = 30;
// Domains that are redirect-only or block all bots — skip scraping, mark checked
const SKIP_DOMAINS = new Set([
  "news.google.com",
  "google.com",
  "t.co",
  "bit.ly",
  "ow.ly"
]);
// Googlebot UA gets through most bot checks and still returns og:image in meta
const USER_AGENT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
// ─── Handler ────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req)=>{
  if (req.method.toUpperCase() !== "POST") {
    return json({
      ok: false,
      error: "Method Not Allowed"
    }, 405);
  }
  // Auth
  const incoming = req.headers.get("x-cron-secret") ?? "";
  const expected = Deno.env.get("CRON_SECRET") ?? "";
  if (!expected || incoming !== expected) {
    return json({
      ok: false,
      error: "Unauthorized"
    }, 401);
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return json({
      ok: false,
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    }, 500);
  }
  const db = createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false
    }
  });
  const t0 = Date.now();
  log("info", "start", {
    batch_size: BATCH_SIZE
  });
  const pipelineJobId = await startPipelineJob(db, "enrich_images");
  try {
    // ── Step 1: Fetch unchecked news_items ─────────────────
    const { data: rows, error: fetchErr } = await db.from("news_items").select("id, url").is("image_url", null).is("image_checked_at", null).order("created_at", {
      ascending: false
    }).limit(BATCH_SIZE);
    if (fetchErr) throw fetchErr;
    const items = rows ?? [];
    log("info", "fetched_batch", {
      count: items.length
    });
    // Counters declared up front (not nested inside the items.length>0
    // branch below) so they're in scope for the single shared return at the
    // end — this function used to early-return here when there was nothing
    // to scrape, which also skipped the backfill pass below. That was fine
    // when backfill didn't exist, but backfill needs to run on ITS OWN
    // schedule regardless of whether today's scrape queue happened to be
    // empty — they're two independent backlogs.
    let enriched = 0; // found an image
    let no_image = 0; // fetched fine but article has no og:image (expected, not an error)
    let skipped = 0; // skip-domain or resolve_failed
    let errors = 0; // actual network/fetch errors only
    let mirrored = 0; // successfully copied to our own storage, same run as the scrape
    let mirror_failed = 0; // had an image_url but couldn't mirror it (falls back to live URL, not a hard error)
    if (items.length > 0) {
      // ── Step 2: Enrich all items concurrently ─────────────
      // db is threaded through so a freshly-found image can be mirrored to
      // our own storage in the same pass, rather than a second sequential
      // sweep over the batch afterward.
      const results = await Promise.allSettled(items.map((item)=>enrichItem(item, db)));
      // ── Step 3: Write results back ───────────────────
      for (const settled of results){
        if (settled.status === "rejected") {
          errors++;
          continue;
        }
        const r = settled.value;
        const checkedAt = new Date().toISOString();
        const { error: updateErr } = await db.from("news_items").update({
          image_url: r.image_url,
          image_meta: {
            source: r.source,
            checked_at: checkedAt,
            ...r.error ? {
              detail: r.error
            } : {},
            // Queryable via SQL later (image_meta->>'hosting_error') rather
            // than only visible in ephemeral function logs — the exact
            // friction that made tonight's whatsapp-card debugging slower
            // than it needed to be.
            ...r.hosting_error ? {
              hosting_error: r.hosting_error
            } : {}
          },
          image_checked_at: checkedAt,
          // ✅ Persist resolved_url so future re-runs skip the redirect step
          ...r.resolved_url ? {
            resolved_url: r.resolved_url
          } : {},
          // Mirroring result. hosted_image_url stays null on failure/no_image —
          // that's the whole point: assign_question_cover() and
          // assign_question_draft_cover() COALESCE onto image_url when it's
          // null, so a failed mirror degrades to exactly today's behavior,
          // never a broken cover. image_hosted_at is only set once we've
          // actually attempted something this run (success, failed, or
          // no_image) — stays null for items that were skipped/errored before
          // ever reaching the mirror step, same "attempted vs not" convention
          // as image_checked_at already uses for the article-fetch step.
          hosted_image_url: r.hosted_image_url ?? null,
          image_hosting_status: r.image_hosting_status ?? null,
          ...r.image_hosting_status ? {
            image_hosted_at: checkedAt
          } : {}
        }).eq("id", r.id);
        if (updateErr) {
          log("warn", "update_failed", {
            id: r.id,
            error: updateErr.message
          });
          errors++;
          continue;
        }
        // ✅ Correct bucketing — "no_image" is not an error
        if (r.image_url) enriched++;
        else if (r.source === "no_image") no_image++;
        else if (r.source === "skip" || r.source === "resolve_failed") skipped++;
        else errors++;
        // Mirroring counts tracked separately from the article-enrichment
        // buckets above — an item can be "enriched" (found an image_url) but
        // still fail to mirror it, and that distinction matters for knowing
        // whether this step is actually working, not just the scrape step.
        if (r.image_hosting_status === "success") mirrored++;
        else if (r.image_hosting_status === "failed") mirror_failed++;
      }
      log("info", "enrichment_done", {
        enriched,
        no_image,
        skipped,
        errors,
        mirrored,
        mirror_failed,
        elapsed_ms: Date.now() - t0
      });
    } else {
      log("info", "nothing_to_scrape", {});
    }
    // ── Step 4: Mirror backfill — catches image_urls that never went
    // through Step 2/3 above at all. Runs every invocation regardless of
    // whether there was anything to scrape (see comment on
    // runMirrorBackfill for why this has to be a separate pass). ─────────
    const backfillResult = await runMirrorBackfill(db);
    // ── Step 5: Assign covers now that we have fresh + backfilled images ──
    const coverResult = await runCoverAssignment(db);
    await finishPipelineJob(db, pipelineJobId, {
      status: "success",
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - t0,
      items_processed: enriched
    });
    return json({
      ok: true,
      enriched,
      no_image,
      skipped,
      errors,
      mirrored,
      mirror_failed,
      ...backfillResult,
      ...coverResult,
      elapsed_ms: Date.now() - t0
    });
  } catch (err) {
    log("error", "exception", {
      error: err.message
    });
    await finishPipelineJob(db, pipelineJobId, {
      status: "failed",
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - t0,
      error_message: String(err.message ?? err).slice(0, 800)
    });
    return json({
      ok: false,
      error: err.message
    }, 500);
  }
});
// ─── Enrichment logic ───────────────────────────────────────────────────────────────────────────────────────────
async function enrichItem(item, db) {
  let targetUrl = item.url;
  let resolvedUrl;
  // Resolve Google News redirect URLs
  if (isGoogleNewsUrl(item.url)) {
    const resolved = await resolveRedirect(item.url);
    if (!resolved) {
      return {
        id: item.id,
        url: item.url,
        image_url: null,
        source: "resolve_failed"
      };
    }
    targetUrl = resolved;
    resolvedUrl = resolved; // ✅ will be saved back to news_items.resolved_url
  }
  // Skip known bot-blocking or redirect-only domains
  try {
    const hostname = new URL(targetUrl).hostname.replace(/^www\./, "");
    if (SKIP_DOMAINS.has(hostname)) {
      return {
        id: item.id,
        url: item.url,
        image_url: null,
        source: "skip"
      };
    }
  } catch  {
    return {
      id: item.id,
      url: item.url,
      image_url: null,
      source: "error",
      error: "invalid_url"
    };
  }
  // Fetch HTML with timeout
  let html;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html"
      },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (res.status >= 500) {
      // Server error — don't mark as checked_at so it gets retried next run
      return {
        id: item.id,
        url: item.url,
        image_url: null,
        source: "error",
        error: `http_${res.status}`
      };
    }
    // ✅ Stream read — stop after MAX_HTML_BYTES or </head> (whichever first)
    // Avoids buffering entire 500KB–2MB articles when og:image is in the first ~5KB
    const reader = res.body?.getReader();
    html = "";
    if (reader) {
      const decoder = new TextDecoder();
      let bytes = 0;
      while(bytes < MAX_HTML_BYTES){
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, {
          stream: true
        });
        bytes += value.length;
        if (html.includes("</head>")) break;
      }
      reader.cancel();
    } else {
      html = await res.text();
    }
  } catch (err) {
    const msg = err.message ?? "fetch_failed";
    return {
      id: item.id,
      url: item.url,
      image_url: null,
      source: "error",
      error: msg
    };
  }
  // Extract image from meta tags — try all attribute orderings
  const ogImage = extractMetaContent(html, [
    /property="og:image"\s+content="([^"]+)"/i,
    /content="([^"]+)"\s+property="og:image"/i,
    /property='og:image'\s+content='([^']+)'/i,
    /content='([^']+)'\s+property='og:image'/i
  ]);
  if (ogImage) {
    const finalImageUrl = normalizeImageUrl(ogImage, targetUrl);
    // targetUrl (not item.url) — the actual page fetched, post Google-News-
    // redirect-resolution when applicable, same reasoning whatsapp-card
    // uses news_items.url for its own Referer.
    let refererOrigin = null;
    try { refererOrigin = new URL(targetUrl).origin + "/"; } catch { /* malformed, tier 2 will be skipped */ }
    const hosting = await mirrorImage(db, item.id, finalImageUrl, refererOrigin);
    return {
      id: item.id,
      url: item.url,
      image_url: finalImageUrl,
      source: "og:image",
      resolved_url: resolvedUrl,
      ...hosting
    };
  }
  const twitterImage = extractMetaContent(html, [
    /name="twitter:image"\s+content="([^"]+)"/i,
    /content="([^"]+)"\s+name="twitter:image"/i,
    /name='twitter:image'\s+content='([^']+)'/i,
    /property="twitter:image"\s+content="([^"]+)"/i
  ]);
  if (twitterImage) {
    const finalImageUrl = normalizeImageUrl(twitterImage, targetUrl);
    let refererOrigin = null;
    try { refererOrigin = new URL(targetUrl).origin + "/"; } catch { /* malformed, tier 2 will be skipped */ }
    const hosting = await mirrorImage(db, item.id, finalImageUrl, refererOrigin);
    return {
      id: item.id,
      url: item.url,
      image_url: finalImageUrl,
      source: "twitter:image",
      resolved_url: resolvedUrl,
      ...hosting
    };
  }
  // ✅ No image found — source is "no_image" not "error"
  return {
    id: item.id,
    url: item.url,
    image_url: null,
    source: "no_image",
    resolved_url: resolvedUrl,
    // Nothing to mirror, but stamp the status anyway so
    // image_hosting_status IS NULL cleanly distinguishes "never processed by
    // this function" (pre-migration/never-batched rows) from "processed,
    // correctly had nothing to mirror" — useful when scoping a future
    // backfill batch to rows that actually need it.
    image_hosting_status: "no_image"
  };
}

// ─── Mirror a source image into our own storage ───────────────────
// Routes through wsrv.nl with a resize param (&w=1200) rather than a plain
// fetch — confirmed (via a real libvips test, not assumption) that the
// resize/thumbnail pipeline is what normalizes CMYK JPEGs to RGB; a plain
// passthrough copy does NOT do this. This is the same normalization
// whatsapp-card now does per-request; doing it once here means every
// consumer downstream (whatsapp-card, the plain-image fallback,
// api/s/[slug].js's og:image, ShareButton) gets a clean, already-normalized
// image without needing its own wsrv.nl call.
//
// Deliberately does NOT fall through to a direct fetch on wsrv.nl failure,
// unlike whatsapp-card's two-attempt chain. That fallback exists in
// whatsapp-card because it needs SOME image immediately, at message-send
// time, so falling through to an unnormalized direct fetch (which can still
// hand back CMYK) is an acceptable last resort there. Here, this only
// determines whether hosted_image_url gets set at all — a failure just
// means the existing image_url keeps being used, exactly as it is today,
// with zero regression. Adding the same unsafe fallback here would risk
// mirroring a CMYK original as our own "clean" copy, defeating the point.
// mirrorImage: fetches a source image and stores our own copy in Storage.
//
// TWO-TIER FETCH (added after backfill data showed why this mattered):
// running the full backlog through this function surfaced that Indian
// Express, Business Standard, and The Hindu — not just NDTV — all fail at
// the wsrv.nl step with the same signature (wsrv.nl 404, meaning the origin
// itself refused wsrv.nl's request). But until now, this function only ever
// tried wsrv.nl — unlike whatsapp-card's fetchPhotoAsDataUri(), which has
// always had a second attempt: a direct fetch straight to the publisher
// with a Referer set to the actual article page, for cases where a WAF
// blocks a known proxy's IP/domain but still serves a normal-looking direct
// request. That fallback is proven working there; it just never existed
// here. NDTV is confirmed to block both paths (see whatsapp-card's own
// comments), so this won't recover that specific 40 — but Indian Express,
// Business Standard, and The Hindu have never actually had a direct attempt
// made against them at the mirror step, only inferred-blocked from wsrv.nl
// alone.
//
// refererOrigin may be null (e.g. malformed article URL) — tier 2 is
// skipped in that case and this behaves exactly as before (wsrv.nl only).
//
// NOTE on color space: tier 2's bytes are NOT run through wsrv.nl's resize
// pipeline, so they're NOT CMYK-normalized (same caveat whatsapp-card's own
// tier 2 already carries). A CMYK image succeeding here still gets stored
// as-is; whatsapp-card's own blank-render sanity check is what catches an
// undecodable stored copy at render time and downgrades to placeholder —
// this function has no equivalent decode step to pre-validate against, so
// a tier-2 "success" here means "we obtained bytes that pass the
// image/>500-byte checks," not "guaranteed renderable." Still strictly
// better than not trying — the previous behavior was giving up entirely.
async function mirrorImage(db, newsItemId, sourceUrl, refererOrigin) {
  let tier1Error = null;
  try {
    const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(sourceUrl.replace(/^https?:\/\//, ""))}&w=1200&output=jpg`;
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(), MIRROR_TIMEOUT_MS);
    let resp;
    try {
      resp = await fetch(proxyUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!resp.ok) {
      tier1Error = `wsrv.nl fetch failed: ${resp.status}`;
    } else {
      const contentType = resp.headers.get("content-type") || "";
      const bytes = new Uint8Array(await resp.arrayBuffer());
      if (!contentType.startsWith("image/")) {
        tier1Error = `non-image content-type: "${contentType}"`;
      } else if (bytes.length < 500) {
        tier1Error = `suspiciously small body: ${bytes.length} bytes`;
      } else {
        const uploaded = await uploadMirroredBytes(db, newsItemId, bytes, "image/jpeg");
        if (uploaded) return uploaded;
        tier1Error = "storage upload failed (see logs)";
      }
    }
  } catch (err) {
    tier1Error = err?.message ?? String(err);
  }

  // ── Tier 2: direct fetch with Referer — only reached if wsrv.nl's own
  // domain filter or the origin itself refused tier 1 above. Skipped
  // cleanly (not an error) when there's no article URL to build a Referer
  // from. ──────────────────────────────────────────
  if (refererOrigin) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(()=>controller.abort(), MIRROR_TIMEOUT_MS);
      let resp;
      try {
        resp = await fetch(sourceUrl, {
          signal: controller.signal,
          headers: {
            // Same UA proven to work for direct image fetches in
            // whatsapp-card — deliberately NOT the Googlebot UA used
            // elsewhere in this file for HTML page fetches; publishers'
            // image CDNs and their HTML servers often apply different bot
            // rules, and this is the one confirmed to work for the former.
            "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
            "Referer": refererOrigin
          }
        });
      } finally {
        clearTimeout(timeout);
      }
      if (resp.ok) {
        const contentType = resp.headers.get("content-type") || "";
        const bytes = new Uint8Array(await resp.arrayBuffer());
        if (contentType.startsWith("image/") && bytes.length >= 500) {
          const uploaded = await uploadMirroredBytes(db, newsItemId, bytes, contentType);
          if (uploaded) return uploaded;
          return { image_hosting_status: "failed", hosting_error: `${tier1Error}; direct fetch succeeded but storage upload failed` };
        }
        return { image_hosting_status: "failed", hosting_error: `${tier1Error}; direct fetch returned non-image or too-small body (${contentType}, ${bytes.length}b)` };
      }
      return { image_hosting_status: "failed", hosting_error: `${tier1Error}; direct fetch also failed: ${resp.status}` };
    } catch (err) {
      return { image_hosting_status: "failed", hosting_error: `${tier1Error}; direct fetch also failed: ${err?.message ?? err}` };
    }
  }

  return { image_hosting_status: "failed", hosting_error: tier1Error };
}

// Shared upload step for both tiers above — same Storage path/content-type
// handling either way, just called with different source bytes.
async function uploadMirroredBytes(db, newsItemId, bytes, contentType) {
  const storagePath = `${IMAGE_HOST_PREFIX}/${newsItemId}.jpg`;
  const { error: uploadErr } = await db.storage.from(IMAGE_HOST_BUCKET).upload(storagePath, bytes, {
    contentType: contentType.startsWith("image/") ? contentType : "image/jpeg",
    upsert: true,
    cacheControl: "86400"
  });
  if (uploadErr) {
    log("warn", "mirror_upload_failed", { newsItemId, error: uploadErr.message });
    return null;
  }
  const { data: urlData } = db.storage.from(IMAGE_HOST_BUCKET).getPublicUrl(storagePath);
  if (!urlData?.publicUrl) return null;
  return { image_hosting_status: "success", hosted_image_url: urlData.publicUrl };
}
// ─── Mirror backfill: catches image_urls that arrived WITHOUT going through
// the scrape-and-mirror step in the main handler above — either rows that
// predate this whole feature, or rows inserted via
// populate_news_items_from_ingestion_queue() (a separate DB function that
// carries image_url over directly from RSS/feed metadata AND stamps
// image_checked_at at insert time). That stamp makes those rows permanently
// invisible to Step 1's scrape query above (WHERE image_url IS NULL AND
// image_checked_at IS NULL) — that query's job is finding items that need
// SCRAPING, not items that already have a URL but were never MIRRORED.
// This is the only place that catches that class of row, regardless of
// which of the (at least two, possibly more) ingestion paths it came from.
//
// Deliberately does NOT retry rows already marked image_hosting_status =
// 'failed' — only ones genuinely never attempted (status IS NULL).
// Re-attempting a known failure (NDTV, at time of writing) on every single
// cron run would mean repeatedly hitting the same blocking publisher on a
// schedule, which is both wasteful and the kind of pattern that gets an IP
// flagged harder, not less. A deliberate manual reset — same one used
// throughout tonight's testing — is the right way to retry a specific known
// failure; this backfill only ever moves forward through NEW rows.
async function runMirrorBackfill(db) {
  let backfill_mirrored = 0;
  let backfill_failed = 0;
  try {
    const { data: rows, error: fetchErr } = await db.from("news_items").select("id, url, image_url, image_meta").not("image_url", "is", null).neq("image_url", "").is("hosted_image_url", null).is("image_hosting_status", null).order("created_at", {
      ascending: false
    }).limit(MIRROR_BACKFILL_BATCH_SIZE);
    if (fetchErr) throw fetchErr;
    const items = rows ?? [];
    log("info", "backfill_batch_fetched", {
      count: items.length
    });
    if (items.length === 0) {
      return {
        backfill_mirrored,
        backfill_failed
      };
    }
    const results = await Promise.allSettled(items.map(async (row)=>{
      let refererOrigin = null;
      try { refererOrigin = row.url ? new URL(row.url).origin + "/" : null; } catch { /* malformed, tier 2 will be skipped */ }
      const hosting = await mirrorImage(db, row.id, row.image_url, refererOrigin);
      return {
        id: row.id,
        existingMeta: row.image_meta,
        ...hosting
      };
    }));
    for (const settled of results){
      if (settled.status === "rejected") {
        backfill_failed++;
        continue;
      }
      const r = settled.value;
      const hostedAt = new Date().toISOString();
      const updatePayload = {
        hosted_image_url: r.hosted_image_url ?? null,
        image_hosting_status: r.image_hosting_status,
        image_hosted_at: hostedAt
      };
      // Merge into existing image_meta rather than overwrite it — a
      // backfilled row may already carry forensic data from wherever its
      // image_url originally came from (e.g.
      // populate_news_items_from_ingestion_queue's rss/meta extraction
      // fields); a full replace here would silently destroy that.
      if (r.hosting_error) {
        updatePayload.image_meta = {
          ...r.existingMeta ?? {},
          hosting_error: r.hosting_error
        };
      }
      const { error: updateErr } = await db.from("news_items").update(updatePayload).eq("id", r.id);
      if (updateErr) {
        log("warn", "backfill_update_failed", {
          id: r.id,
          error: updateErr.message
        });
        backfill_failed++;
        continue;
      }
      if (r.image_hosting_status === "success") backfill_mirrored++;
      else backfill_failed++;
    }
    log("info", "backfill_done", {
      backfill_mirrored,
      backfill_failed
    });
    return {
      backfill_mirrored,
      backfill_failed
    };
  } catch (err) {
    log("warn", "backfill_exception", {
      error: err.message
    });
    return {
      backfill_mirrored,
      backfill_failed
    };
  }
}
// ─── Cover assignment after enrichment ─────────────────────────────────────────────────────
async function runCoverAssignment(db) {
  try {
    const { data: draftResult, error: de } = await db.rpc("assign_draft_covers_batch", {
      p_limit: MAX_COVER_BATCH
    });
    if (de) log("warn", "draft_cover_batch_error", {
      error: de.message
    });
    const { data: qResult, error: qe } = await db.rpc("assign_question_covers_batch", {
      p_limit: MAX_COVER_BATCH
    });
    if (qe) log("warn", "question_cover_batch_error", {
      error: qe.message
    });
    return {
      draft_covers: draftResult ?? null,
      question_covers: qResult ?? null
    };
  } catch (err) {
    log("warn", "cover_assignment_failed", {
      error: err.message
    });
    return {
      draft_covers: null,
      question_covers: null
    };
  }
}
// ─── Helpers ───────────────────────────────────────────────────────────────────────────────────────────
function isGoogleNewsUrl(url) {
  try {
    const h = new URL(url).hostname;
    return h === "news.google.com" || h.endsWith(".google.com");
  } catch  {
    return false;
  }
}
async function resolveRedirect(url) {
  try {
    const controller = new AbortController();
    setTimeout(()=>controller.abort(), 5000);
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT
      },
      signal: controller.signal
    });
    return res.url !== url ? res.url : null;
  } catch  {
    return null;
  }
}
function extractMetaContent(html, patterns) {
  for (const pattern of patterns){
    const m = html.match(pattern);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}
function normalizeImageUrl(raw, baseUrl) {
  try {
    // Handle protocol-relative URLs
    if (raw.startsWith("//")) return "https:" + raw;
    // Handle relative URLs
    if (raw.startsWith("/")) return new URL(raw, baseUrl).href;
    // Decode HTML entities
    return raw.replace(/&amp;/g, "&").replace(/&#39;/g, "'");
  } catch  {
    return raw;
  }
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}
function log(level, msg, extra = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    func: "enrich-images",
    msg,
    ...extra
  }));
}
