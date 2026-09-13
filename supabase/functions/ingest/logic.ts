// supabase/functions/ingest/logic.ts
// Production-ready news ingestion with Deno-compatible article scraping
//
// v2 changes (content-quality fixes for downstream embeddings):
//   1. extractArticleContent() now STRIPS non-content nodes (script/style/noscript/
//      nav/header/footer/aside/form/figure/iframe) before reading text, and prefers
//      real <p> paragraphs. This removes the GoogleTagManager/<noscript> pollution
//      that was leaking into normalized.content.
//   2. Scrape gate is now WORD-COUNT based (>=150 words) instead of char length > 200,
//      so a short RSS summary no longer prevents full-article scraping.
//   3. Defensive isGoogleNewsUrl() guard: Google News links are JS redirects that can't
//      be scraped server-side, so we skip the wasted fetch and log it.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
// Helper: Parse XML to JSON using xml2js with Promise wrapper
async function parseXMLPromise(xml) {
  const { parseString } = await import('https://esm.sh/xml2js@0.6.2');
  return new Promise((resolve, reject)=>{
    parseString(xml, {
      explicitArray: false,
      mergeAttrs: true
    }, (err, result)=>{
      if (err) reject(err);
      else resolve(result);
    });
  });
}
// Helper: Strip HTML tags and decode entities
function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/\s+/g, ' ').trim();
}
// ── Browser identity (scraper fix) ────────────────────────────────────────────
// WAFs (Cloudflare/Akamai) on Indian Express, Times of India, and NDTV reject
// bot-labeled User-Agents with a 403, which was landing those publishers'
// articles as headline-only (~56% of Indian Express arrived at 0 words). A real
// Chrome UA plus browser-like headers passes those checks. This is strictly more
// permissive than the old bot UA, so it cannot regress publishers that already
// worked. NOTE: it does not help JS-rendered (SPA) pages — those need a headless
// browser and are out of scope for a server-side fetch.
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const BROWSER_HEADERS = {
  "User-Agent": BROWSER_UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Ch-Ua": '"Chromium";v="125", "Not.A/Brand";v="24", "Google Chrome";v="125"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Upgrade-Insecure-Requests": "1"
};
// Site-specific article selectors, tried BEFORE the generic list for publishers
// where the generic selectors miss the body. Matched by hostname suffix.
const SITE_SELECTORS = {
  "indianexpress.com": [ '.story_details', '.full-details', '[itemprop="articleBody"]', '.ie-first-para', '.article-body' ],
  "timesofindia.indiatimes.com": [ '[data-articlebody="1"]', '.ga-headlines', '._s30J', '.js_tbl_article', '.article_content', '[itemprop="articleBody"]' ],
  "ndtv.com": [ '.sp-cn', '.content_text', '.story__content', '[itemprop="articleBody"]' ],
  "npr.org": [ '#storytext', '.storytext', '[data-testid="storytext"]' ]
};
// Helper: Detect Google News redirect URLs (cannot be scraped server-side)
function isGoogleNewsUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'news.google.com' || host.endsWith('.news.google.com');
  } catch  {
    return false;
  }
}
// Helper: Extract text content from RSS item
function extractContent(item) {
  const candidates = [
    item['content:encoded'],
    item.content,
    item.description,
    item.summary
  ];
  for (const candidate of candidates){
    if (candidate && typeof candidate === 'string' && candidate.length > 50) {
      return stripHtml(candidate).substring(0, 5000);
    }
  }
  return item.description || '';
}
// Helper: word count of a plain-text string
function wordCount(s) {
  return (s || '').split(/\s+/).filter((w)=>w.length > 0).length;
}
// Helper: Parse date from various RSS formats
function parseDate(dateStr) {
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  } catch  {
    return null;
  }
}
// Helper: Generate dedupe key from URL or title+source
function generateDedupeKey(url, sourceId, title) {
  if (url && url.length > 10) {
    return `url:${url}`;
  }
  const normalized = title.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `title:${sourceId}:${normalized}`;
}
// Helper: Extract external ID from RSS item
function extractExternalId(item) {
  return item.guid || item.id || null;
}
/**
 * Helper: Normalize a raw link value from xml2js into a plain string.
 * Atom feeds parse <link href="..." rel="alternate"/> as an object;
 * RSS 2.0 feeds parse <link> as a string. Both cases are handled here.
 */ function normalizeLink(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'object') {
    // Direct shape: { href: "..." } or { url: "..." }
    const direct = raw.href || raw.url;
    if (typeof direct === 'string' && direct.trim().length > 0) return direct.trim();
    // xml2js attrs shape: { $: { href: "..." } }
    const attr = raw?.$?.href || raw?.$?.url;
    if (typeof attr === 'string' && attr.trim().length > 0) return attr.trim();
    // Array shape (explicitArray: true remnants)
    if (Array.isArray(raw) && raw.length > 0) return normalizeLink(raw[0]);
  }
  return '';
}
/**
 * Helper: Extract RSS image URL from common RSS structures.
 * Works with xml2js outputs where attrs may be merged.
 */ function extractRssImageUrl(item) {
  const pick = (v)=>{
    if (!v) return null;
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'object') {
      // common shapes: { url: "..." } or { href: "..." }
      const direct = v.url || v.href;
      if (typeof direct === 'string' && direct.trim().length > 10) return direct.trim();
      // xml2js sometimes nests attrs in $
      const attr = v?.$?.url || v?.$?.href;
      if (typeof attr === 'string' && attr.trim().length > 10) return attr.trim();
    }
    return null;
  };
  // media:content OR enclosure
  const media = item['media:content'] || item.enclosure;
  if (Array.isArray(media)) {
    for (const m of media){
      const u = pick(m);
      if (u) return u;
    }
  } else {
    const u = pick(media);
    if (u) return u;
  }
  // media:thumbnail
  const thumb = item['media:thumbnail'];
  if (Array.isArray(thumb)) {
    for (const t of thumb){
      const u = pick(t);
      if (u) return u;
    }
  } else {
    const u = pick(thumb);
    if (u) return u;
  }
  // Some feeds put image in <image><url>…</url></image> (rare in item)
  const image = item.image;
  if (image) {
    const u = pick(image.url || image);
    if (u) return u;
  }
  return null;
}
function isLikelyUsefulImageUrl(u) {
  const url = u.trim();
  if (!/^https?:\/\//i.test(url)) return false;
  if (url.length < 12) return false;
  // filter obvious non-images/icons/sprites
  const lower = url.toLowerCase();
  if (lower.includes('favicon') || lower.includes('sprite') || lower.includes('icon') || lower.includes('logo') || lower.endsWith('.svg')) return false;
  return true;
}
// Helper: Extract OG/Twitter image from HTML (<meta ... content="...">)
async function extractMetaImageFromHtml(html) {
  const { parse } = await import('https://esm.sh/node-html-parser@6.1.12');
  const root = parse(html);
  const candidates = [
    root.querySelector('meta[property="og:image:secure_url"]')?.getAttribute('content'),
    root.querySelector('meta[property="og:image"]')?.getAttribute('content'),
    root.querySelector('meta[name="og:image"]')?.getAttribute('content'),
    root.querySelector('meta[name="twitter:image"]')?.getAttribute('content'),
    root.querySelector('meta[property="twitter:image"]')?.getAttribute('content'),
    root.querySelector('meta[name="twitter:image:src"]')?.getAttribute('content')
  ].map((v)=>(v ?? '').trim()).filter((v)=>v.length > 10 && isLikelyUsefulImageUrl(v));
  return candidates[0] ?? null;
}
// Fetch only to extract OG/Twitter image (fast path)
async function fetchOgImage(url, ctx) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) {
      ctx.log('debug', 'OG fetch not ok', {
        url,
        status: res.status
      });
      return null;
    }
    const html = await res.text();
    if (html.length < 200) {
      ctx.log('debug', 'OG fetch HTML too short', {
        url,
        bytes: html.length
      });
      return null;
    }
    const img = await extractMetaImageFromHtml(html);
    return img;
  } catch (e) {
    ctx.log('debug', 'OG fetch failed', {
      url,
      error: e?.message ?? String(e)
    });
    return null;
  }
}
// Tags whose text is never article prose. node-html-parser exposes <noscript>
// contents as text, which is how GoogleTagManager iframes were polluting content.
const NON_CONTENT_SELECTORS = [
  'script',
  'style',
  'noscript',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'figure',
  'iframe',
  'figcaption',
  'button'
];
// Helper: Extract clean article body text from a parsed element.
// Removes chrome/boilerplate nodes first, then prefers real <p> paragraphs.
function extractCleanText(articleElement) {
  // 1) Remove non-content nodes (mutates the parsed tree — fine, it's request-local)
  for (const sel of NON_CONTENT_SELECTORS){
    try {
      articleElement.querySelectorAll(sel).forEach((n)=>n.remove());
    } catch  {
    // some selectors may be unsupported on certain node types — ignore
    }
  }
  // 2) Prefer real paragraphs; fall back to full textContent only if too few
  const paragraphs = articleElement.querySelectorAll('p').map((p)=>(p.textContent || '').replace(/\s+/g, ' ').trim()).filter((t)=>t.length > 40);
  const rawText = paragraphs.length >= 2 ? paragraphs.join(' ') : articleElement.textContent || '';
  return rawText.replace(/\s+/g, ' ').trim();
}
// Helper: Extract article content using simple HTML parsing
async function extractArticleContent(url, ctx) {
  try {
    // Guard: Google News links are JS redirects — scraping them yields Google's
    // interstitial, not the article. Skip the wasted fetch.
    if (isGoogleNewsUrl(url)) {
      ctx.log('debug', 'Skipping scrape: Google News redirect URL', {
        url
      });
      return {
        content: '',
        excerpt: '',
        wordCount: 0,
        imageUrl: null,
        success: false
      };
    }
    ctx.log('debug', 'Fetching article HTML', {
      url
    });
    // Fetch the article page
    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const html = await response.text();
    if (html.length < 500) {
      throw new Error('HTML too short, likely blocked or error page');
    }
    ctx.log('debug', 'Parsing HTML', {
      url,
      bytes: html.length
    });
    // Use node-html-parser (Deno-compatible)
    const { parse } = await import('https://esm.sh/node-html-parser@6.1.12');
    const root = parse(html);
    // Grab meta image while we already have HTML (before we strip nodes below)
    const metaImage = await extractMetaImageFromHtml(html);
    // Site-specific selectors first (publishers the generic list misses), then generic.
    let host = "";
    try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
    const siteKey = Object.keys(SITE_SELECTORS).find((d)=>host === d || host.endsWith("." + d));
    const selectors = [
      ...(siteKey ? SITE_SELECTORS[siteKey] : []),
      'article',
      '[role="main"]',
      'main',
      '.article-content',
      '.article-body',
      '.post-content',
      '.entry-content',
      '.story-body',
      '.article__body',
      '#article-body',
      '.content-body'
    ];
    let articleElement = null;
    for (const selector of selectors){
      articleElement = root.querySelector(selector);
      if (articleElement) {
        ctx.log('debug', 'Found article with selector', {
          selector
        });
        break;
      }
    }
    if (!articleElement) {
      // Fallback: try to find paragraphs in body
      const body = root.querySelector('body');
      if (body) {
        const paragraphs = body.querySelectorAll('p');
        if (paragraphs && paragraphs.length > 3) {
          // Use body as article if it has multiple paragraphs
          articleElement = body;
          ctx.log('debug', 'Using body with paragraphs as fallback', {
            paragraph_count: paragraphs.length
          });
        }
      }
    }
    if (!articleElement) {
      throw new Error('No article content found with any selector');
    }
    // Extract + clean text (strips script/style/noscript/nav chrome, prefers <p>)
    const cleanedText = extractCleanText(articleElement);
    if (cleanedText.length < 100) {
      throw new Error('Extracted content too short');
    }
    // Split into words and get count
    const words = cleanedText.split(/\s+/).filter((w)=>w.length > 0);
    const wc = words.length;
    // Limit to 2000 words to avoid storage issues
    const truncatedWords = words.slice(0, 2000);
    const truncatedText = truncatedWords.join(' ');
    // Create excerpt (first 300 chars)
    const excerpt = truncatedText.substring(0, 300).trim();
    ctx.log('info', 'Article extracted successfully', {
      url,
      wordCount: wc,
      contentLength: truncatedText.length,
      hasMetaImage: !!metaImage
    });
    return {
      content: truncatedText,
      excerpt: excerpt,
      wordCount: wc,
      imageUrl: metaImage,
      success: true
    };
  } catch (error) {
    ctx.log('warn', 'Article extraction failed', {
      url,
      error: error.message
    });
    return {
      content: '',
      excerpt: '',
      wordCount: 0,
      imageUrl: null,
      success: false
    };
  }
}
// Main: Fetch and parse RSS feed
async function fetchRSSFeed(url, ctx) {
  ctx.log('info', 'Fetching RSS feed', {
    url
  });
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const xml = await response.text();
    ctx.log('info', 'Parsing RSS XML', {
      bytes: xml.length
    });
    const parsed = await parseXMLPromise(xml);
    const items = parsed?.rss?.channel?.item || parsed?.feed?.entry || parsed?.channel?.item || [];
    const itemsArray = Array.isArray(items) ? items : [
      items
    ];
    ctx.log('info', 'Parsed RSS feed', {
      items: itemsArray.length
    });
    return itemsArray;
  } catch (error) {
    ctx.log('error', 'Failed to fetch RSS', {
      url,
      error: error.message
    });
    throw error;
  }
}
// Main: Process one source
async function processSource(source, sb, ctx) {
  ctx.log('info', 'Processing source', {
    source_id: source.id,
    name: source.name,
    endpoint: source.endpoint
  });
  let inserted = 0;
  let deduped = 0;
  let errors = 0;
  let scraped = 0;
  try {
    const items = await fetchRSSFeed(source.endpoint, ctx);
    if (!items || items.length === 0) {
      ctx.log('warn', 'No items in feed', {
        source_id: source.id
      });
      return {
        inserted: 0,
        deduped: 0,
        errors: 0,
        scraped: 0
      };
    }
    // Process items in smaller batches to avoid timeout
    const batches = ctx.chunk(items, 3); // Process 3 items at a time
    for (const batch of batches){
      if (ctx.shouldStop()) {
        ctx.log('warn', 'Budget exhausted, stopping', {
          processed: inserted + deduped,
          remaining: items.length - (inserted + deduped)
        });
        break;
      }
      await ctx.limit(async ()=>{
        for (const item of batch){
          try {
            const title = stripHtml(item.title || '');
            // FIX: Normalize link — Atom feeds parse <link href="..."/> as an object,
            // RSS 2.0 feeds parse <link> as a string. normalizeLink() handles both.
            const link = normalizeLink(item.link || item.url);
            const description = stripHtml(item.description || '');
            let content = extractContent(item);
            const pubDate = parseDate(item.pubDate || item.published);
            const externalId = extractExternalId(item);
            if (!title || title.length < 10) {
              ctx.log('warn', 'Skipping item: title too short', {
                title
              });
              errors++;
              continue;
            }
            if (!link || link.length < 10) {
              ctx.log('warn', 'Skipping item: invalid URL', {
                title
              });
              errors++;
              continue;
            }
            const dedupeKey = generateDedupeKey(link, source.id, title);
            const { data: existing } = await sb.from('ingestion_queue').select('id').eq('dedupe_key', dedupeKey).maybeSingle();
            if (existing) {
              ctx.log('debug', 'Duplicate detected', {
                dedupe_key: dedupeKey,
                title
              });
              deduped++;
              continue;
            }
            // Image extraction strategy:
            // 1) RSS media image (fast)
            // 2) OG/Twitter meta (HTML fetch) as fallback
            const rssImageUrl = extractRssImageUrl(item);
            let metaImageUrl = null;
            // Only fetch for OG image if RSS didn't provide a usable image
            if ((!rssImageUrl || !isLikelyUsefulImageUrl(rssImageUrl)) && link.startsWith('http')) {
              metaImageUrl = await fetchOgImage(link, ctx);
            }
            // 🔥 SCRAPING LOGIC: scrape the full article unless RSS already gave us
            // a substantial body. FIX: gate on WORD COUNT (>=150 words), not char
            // length — a 200-char summary is ~30 words and should NOT block scraping.
            let hasFullContent = wordCount(content) >= 150;
            let scrapedContent = null;
            if (!hasFullContent && link.startsWith('http')) {
              ctx.log('info', 'Attempting to scrape article', {
                url: link,
                rssWords: wordCount(content)
              });
              scrapedContent = await extractArticleContent(link, ctx);
              if (scrapedContent.success && scrapedContent.content.length > content.length) {
                content = scrapedContent.content;
                hasFullContent = true;
                scraped++;
                ctx.log('info', 'Article scraped successfully', {
                  url: link,
                  wordCount: scrapedContent.wordCount
                });
              } else {
                ctx.log('warn', 'Scraping failed, using RSS content', {
                  url: link
                });
              }
              // If we didn't already get metaImageUrl (or it's missing), reuse what the scrape saw
              if (!metaImageUrl && scrapedContent?.imageUrl && isLikelyUsefulImageUrl(scrapedContent.imageUrl)) {
                metaImageUrl = scrapedContent.imageUrl;
              }
            }
            const raw = {
              title: item.title,
              link: item.link,
              description: item.description,
              content: item['content:encoded'] || item.content,
              pubDate: item.pubDate || item.published,
              guid: item.guid || item.id,
              category: item.category,
              creator: item['dc:creator'] || item.creator,
              media: item['media:content'] || item.enclosure || item['media:thumbnail'],
              scraped: scrapedContent ? {
                success: scrapedContent.success,
                wordCount: scrapedContent.wordCount,
                excerpt: scrapedContent.excerpt,
                imageUrl: scrapedContent.imageUrl
              } : null,
              extracted_image: {
                rss: rssImageUrl || null,
                meta: metaImageUrl || null
              }
            };
            const normalized = {
              title: title,
              content: content,
              summary: description,
              url: link,
              published_at: pubDate?.toISOString() || null,
              source_name: source.name,
              source_country: source.country_name,
              word_count: wordCount(content),
              has_content: content.length > 100,
              scraped: scrapedContent?.success || false,
              // image URL populated from RSS media or OG/Twitter
              image_url: (rssImageUrl && isLikelyUsefulImageUrl(rssImageUrl) ? rssImageUrl : null) || metaImageUrl || null
            };
            const { error: insertError } = await sb.from('ingestion_queue').insert({
              source_id: source.id,
              external_id: externalId,
              title: title,
              summary: description || null,
              url: link,
              published_at: pubDate?.toISOString() || null,
              lang: 'en',
              raw: raw,
              normalized: normalized,
              dedupe_key: dedupeKey,
              status: 'new'
            });
            if (insertError) {
              ctx.log('error', 'Failed to insert item', {
                title,
                error: insertError.message
              });
              errors++;
            } else {
              ctx.log('debug', 'Inserted item', {
                title,
                dedupe_key: dedupeKey,
                scraped: scrapedContent?.success || false,
                word_count: normalized.word_count,
                has_image: !!normalized.image_url
              });
              inserted++;
            }
          } catch (itemError) {
            ctx.log('error', 'Error processing item', {
              error: itemError.message,
              item: item.title
            });
            errors++;
          }
        }
      });
    }
  } catch (sourceError) {
    ctx.log('error', 'Error processing source', {
      source_id: source.id,
      error: sourceError.message
    });
    errors++;
  }
  return {
    inserted,
    deduped,
    errors,
    scraped
  };
}
// Main: Run ingestion for all enabled sources
export async function run(ctx) {
  const projectUrl = Deno.env.get('PROJECT_URL') || Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!projectUrl || !serviceRoleKey) {
    throw new Error('Missing required environment variables: PROJECT_URL and SERVICE_ROLE_KEY');
  }
  const sb = createClient(projectUrl, serviceRoleKey);
  ctx.log('info', 'Starting ingestion with Deno-compatible scraping', {
    trace_id: ctx.traceId
  });
  let query = sb.from('topic_sources').select('id, name, kind, endpoint, country_name, is_enabled').eq('is_enabled', true).eq('kind', 'rss');
  if (ctx.source_id) {
    query = query.eq('id', ctx.source_id);
    ctx.log('info', 'Filtering to single source', {
      source_id: ctx.source_id
    });
  }
  const { data: sources, error: sourcesError } = await query;
  if (sourcesError) {
    throw new Error(`Failed to fetch sources: ${sourcesError.message}`);
  }
  if (!sources || sources.length === 0) {
    ctx.log('warn', 'No enabled RSS sources found');
    return {
      fetched: 0,
      inserted: 0,
      deduped: 0,
      skipped: 0,
      errors: 0,
      scraped: 0
    };
  }
  ctx.log('info', 'Found sources', {
    count: sources.length
  });
  const results = {
    fetched: 0,
    inserted: 0,
    deduped: 0,
    skipped: 0,
    errors: 0,
    scraped: 0
  };
  for (const source of sources){
    if (ctx.shouldStop()) {
      ctx.log('warn', 'Budget exhausted, stopping ingestion');
      break;
    }
    const sourceResult = await processSource(source, sb, ctx);
    results.inserted += sourceResult.inserted;
    results.deduped += sourceResult.deduped;
    results.errors += sourceResult.errors;
    results.scraped += sourceResult.scraped;
    const { data: currentStats } = await sb.from('topic_sources').select('success_count, failure_count').eq('id', source.id).maybeSingle();
    const { error: updateError } = await sb.from('topic_sources').update({
      last_polled_at: ctx.nowISO,
      last_status: sourceResult.errors > 0 ? 'error' : 'done',
      last_error: sourceResult.errors > 0 ? `${sourceResult.errors} items failed` : null,
      success_count: (currentStats?.success_count || 0) + sourceResult.inserted,
      failure_count: (currentStats?.failure_count || 0) + sourceResult.errors
    }).eq('id', source.id);
    if (updateError) {
      ctx.log('error', 'Failed to update source stats', {
        source_id: source.id,
        error: updateError.message
      });
    }
  }
  results.fetched = results.inserted + results.deduped;
  ctx.log('info', 'Ingestion complete', {
    ...results,
    scrape_rate: results.inserted > 0 ? (results.scraped / results.inserted * 100).toFixed(1) + '%' : '0%'
  });
  return results;
}
