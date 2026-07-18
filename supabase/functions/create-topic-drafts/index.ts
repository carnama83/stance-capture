// supabase/functions/create-topic-drafts/index.ts
// Triggered by: run_create_drafts_http() DB function (manual admin panel trigger only)
//
// v5 — Synthesis quality + safety fixes:
//   [Fix 1] synthesiseClusterContext() now feeds the model the ACTUAL article BODY
//           (normalized.content, content-first) instead of just title + short summary.
//           normalized was already fetched but its content was being dropped — so the
//           Tier 1 context was being built from headlines again, defeating the v4 goal.
//           Body is clipped to ~800 chars/article and capped at 6 articles for token budget.
//   [Fix 2] location_label is now run through sanitizeLocationLabel() (same allowlist as
//           cluster/logic.ts) so RSS source names ("Guardian World") can't leak into the
//           draft's location_label.
//   [Fix 3] OpenAI client configured with maxRetries + timeout so transient 429/5xx don't
//           silently drop the synthesis to its low-quality fallback.
//
//   The civic-tension dedup threshold (CREATE_DRAFTS_DEDUP_THRESHOLD) is intentionally left
//   as an env value: at 0.78 it collapses related clusters (e.g. a multi-angle Iran saga)
//   into ONE topic-draft. Raise to ~0.88 for per-cluster topics, lower for saga-level topics.
//
// v4 — Two-tier topic context (synthesis): summary now synthesised from all cluster members.
// v3 — deriveTopicName(): raw headline → canonical topic name.
// v2 — Civic tension dedup guard (cosine ≥ DRAFT_DEDUP_THRESHOLD).
//
// Auth: x-cron-secret header OR user JWT with is_admin_me()
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY)
//   CRON_SECRET
//   SUPABASE_ANON_KEY              (for JWT auth path)
//   OPENAI_API_KEY                 (for topic name + synthesis; falls back gracefully if missing)
//   CREATE_DRAFTS_BATCH            default 20
//   CREATE_DRAFTS_CONCURRENCY      default 8
//   CREATE_DRAFTS_WINDOW_HOURS     default 72
//   CREATE_DRAFTS_DEDUP_THRESHOLD  default 0.78
//   CREATE_DRAFTS_MAX_ARTICLES     default 6   (articles fed into synthesis)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.2";
import OpenAI from "https://esm.sh/openai@4.57.0";
const FUNC = "create-topic-drafts";
function log(level, msg, extra = {}, traceId) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    func: FUNC,
    traceId,
    msg,
    ...extra
  }));
}
// ── OpenAI client factory (retry + timeout so transient throttles don't drop to fallback) ──
function makeOpenAI(apiKey) {
  return new OpenAI({
    apiKey,
    maxRetries: 4,
    timeout: 20_000
  });
}
// ── Content extraction (content-first, mirrors embed/extract-entities) ─────────
const CONTENT_KEYS = [
  "content",
  "content:encoded",
  "body",
  "full_text",
  "text",
  "description_html",
  "content_html",
  "excerpt",
  "description",
  "summary"
];
function extractContent(normalized) {
  if (!normalized || typeof normalized !== "object") return "";
  for (const k of CONTENT_KEYS){
    const v = normalized[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}
function stripHtml(s) {
  return (s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
// ── Location label allowlist (mirrors cluster/logic.ts) ────────────────────────
const KNOWN_LOCATION_LABELS = new Set([
  "Global", "United States", "United Kingdom", "UK", "India", "Canada", "Australia",
  "Germany", "France", "Italy", "Spain", "Japan", "China", "Brazil", "Mexico",
  "South Africa", "Nigeria", "Kenya", "Pakistan", "Bangladesh", "Indonesia",
  "Philippines", "Vietnam", "Thailand", "Malaysia", "Singapore", "Israel",
  "Palestine", "Ukraine", "Russia", "Turkey", "Iran", "Saudi Arabia", "UAE",
  "Egypt", "Argentina", "Colombia", "Chile", "Peru", "Poland", "Netherlands",
  "Belgium", "Sweden", "Norway", "Denmark", "Finland", "Switzerland", "Austria",
  "Portugal", "Greece", "Czech Republic", "Romania", "Hungary", "Ireland",
  "New Zealand", "California", "Texas", "New York", "Florida", "Illinois",
  "Pennsylvania", "Ohio", "Georgia", "North Carolina", "Michigan", "Virginia",
  "Washington", "Europe", "Asia", "Africa", "Middle East", "Latin America",
  "Southeast Asia", "South Asia", "East Asia", "North America"
]);
function sanitizeLocationLabel(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (KNOWN_LOCATION_LABELS.has(trimmed)) return trimmed;
  for (const known of KNOWN_LOCATION_LABELS){
    if (known.toLowerCase() === trimmed.toLowerCase()) return known;
  }
  return null; // Reject unknown values — likely source names or garbage
}
// ── Event-location resolution (v6): derive location from extracted entities, not source ──
// Fixes the source-country bias: a Thailand story reported by an Indian outlet must tag
// Thailand, not India. Each location entity is mapped to a country (+ locality); the dominant
// one is chosen by article-share (0.6) + entity-share (0.4). Regional/noise labels are dropped.
// Scope-gated Global-vs-country refinement happens downstream in admin-create-question-draft.
const NOISE_LOCATIONS = new Set([
  "global","worldwide","international","world","un","united nations","eu","european union",
  "middle east","west asia","east asia","south asia","southeast asia","central asia","asia",
  "europe","africa","north america","south america","latin america","gulf","persian gulf",
  "strait of hormuz","european markets","western markets","the west","balkans","scandinavia"
]);
const COUNTRY_LITERALS = new Map([
  ["united states","United States"],["usa","United States"],["us","United States"],["u.s.","United States"],["u.s","United States"],["america","United States"],
  ["united kingdom","United Kingdom"],["uk","United Kingdom"],["britain","United Kingdom"],["great britain","United Kingdom"],["england","United Kingdom"],["scotland","United Kingdom"],["wales","United Kingdom"],
  ["india","India"],["canada","Canada"],["australia","Australia"],["germany","Germany"],["france","France"],["italy","Italy"],["spain","Spain"],["japan","Japan"],["china","China"],["brazil","Brazil"],["mexico","Mexico"],
  ["south africa","South Africa"],["nigeria","Nigeria"],["kenya","Kenya"],["pakistan","Pakistan"],["bangladesh","Bangladesh"],["indonesia","Indonesia"],["philippines","Philippines"],["vietnam","Vietnam"],["thailand","Thailand"],["malaysia","Malaysia"],["singapore","Singapore"],
  ["israel","Israel"],["palestine","Palestine"],["ukraine","Ukraine"],["russia","Russia"],["turkey","Turkey"],["iran","Iran"],["saudi arabia","Saudi Arabia"],["uae","UAE"],["united arab emirates","UAE"],["qatar","Qatar"],["bahrain","Bahrain"],["kuwait","Kuwait"],["oman","Oman"],["iraq","Iraq"],["lebanon","Lebanon"],["syria","Syria"],["yemen","Yemen"],["afghanistan","Afghanistan"],["jordan","Jordan"],
  ["egypt","Egypt"],["argentina","Argentina"],["colombia","Colombia"],["chile","Chile"],["peru","Peru"],["venezuela","Venezuela"],["poland","Poland"],["netherlands","Netherlands"],["belgium","Belgium"],["sweden","Sweden"],["norway","Norway"],["denmark","Denmark"],["finland","Finland"],["switzerland","Switzerland"],["austria","Austria"],["portugal","Portugal"],["greece","Greece"],["czech republic","Czech Republic"],["romania","Romania"],["hungary","Hungary"],["ireland","Ireland"],["new zealand","New Zealand"],
  ["sri lanka","Sri Lanka"],["nepal","Nepal"],["bhutan","Bhutan"],["myanmar","Myanmar"],["belarus","Belarus"],["south korea","South Korea"],["north korea","North Korea"],["taiwan","Taiwan"],["vatican","Vatican"]
]);
const US_SUBNATIONAL = new Set([
  "alabama","alaska","arizona","arkansas","california","colorado","connecticut","delaware","florida","georgia","hawaii","idaho","illinois","indiana","iowa","kansas","kentucky","louisiana","maine","maryland","massachusetts","michigan","minnesota","mississippi","missouri","montana","nebraska","nevada","new hampshire","new jersey","new mexico","new york","north carolina","north dakota","ohio","oklahoma","oregon","pennsylvania","rhode island","south carolina","south dakota","tennessee","texas","utah","vermont","virginia","west virginia","wisconsin","wyoming",
  "washington","washington d.c.","washington dc","d.c.","district of columbia",
  "new york city","los angeles","san francisco","san jose","chicago","houston","boston","seattle","atlanta","miami","dallas","philadelphia","phoenix","denver","austin","portland","detroit","manhattan","brooklyn","bend","redmond","takoma park","bridgeport","stamford","madras"
]);
const IN_SUBNATIONAL = new Set([
  "andhra pradesh","arunachal pradesh","assam","bihar","chhattisgarh","goa","gujarat","haryana","himachal pradesh","jharkhand","karnataka","kerala","madhya pradesh","maharashtra","manipur","meghalaya","mizoram","nagaland","odisha","punjab","rajasthan","sikkim","tamil nadu","telangana","tripura","uttar pradesh","uttarakhand","west bengal","delhi","new delhi","jammu and kashmir","ladakh","puducherry","chandigarh",
  "mumbai","chennai","bengaluru","bangalore","kolkata","hyderabad","ahmedabad","pune","surat","jaipur","lucknow","kanpur","nagpur","indore","bhopal","patna","vadodara","ghaziabad","noida","gurugram","gurgaon","varanasi","ayodhya","mathura","coimbatore","tiruchirappalli","trichy","madurai","kochi","visakhapatnam","worli","lonavala","bijnor","hubbali","hubli","rewa","ghazipur","sahadatganj","arumbakkam","medavakkam","maval","maval taluka","south delhi","west delhi","vasant kunj","dwarka"
]);
const US_STATES_ONLY = new Set([
  "alabama","alaska","arizona","arkansas","california","colorado","connecticut","delaware","florida","georgia","hawaii","idaho","illinois","indiana","iowa","kansas","kentucky","louisiana","maine","maryland","massachusetts","michigan","minnesota","mississippi","missouri","montana","nebraska","nevada","new hampshire","new jersey","new mexico","new york","north carolina","north dakota","ohio","oklahoma","oregon","pennsylvania","rhode island","south carolina","south dakota","tennessee","texas","utah","vermont","virginia","west virginia","wisconsin","wyoming","washington d.c.","washington dc","district of columbia"
]);
const IN_STATES_ONLY = new Set([
  "andhra pradesh","arunachal pradesh","assam","bihar","chhattisgarh","goa","gujarat","haryana","himachal pradesh","jharkhand","karnataka","kerala","madhya pradesh","maharashtra","manipur","meghalaya","mizoram","nagaland","odisha","punjab","rajasthan","sikkim","tamil nadu","telangana","tripura","uttar pradesh","uttarakhand","west bengal","delhi","jammu and kashmir","ladakh","puducherry","chandigarh"
]);
function isStateLevel(locality, country) {
  const l = String(locality).toLowerCase();
  if (country === "United States") return US_STATES_ONLY.has(l);
  if (country === "India") return IN_STATES_ONLY.has(l);
  return false;
}
const WORLD_CITY = new Map([
  ["paris","France"],["london","United Kingdom"],["tokyo","Japan"],["beijing","China"],["shanghai","China"],["moscow","Russia"],["berlin","Germany"],["rome","Italy"],["madrid","Spain"],["toronto","Canada"],["sydney","Australia"],["melbourne","Australia"],["perth","Australia"],
  ["bangkok","Thailand"],["pattaya","Thailand"],["jomtien beach","Thailand"],["jomtien","Thailand"],["kalasin","Thailand"],["phuket","Thailand"],
  ["doha","Qatar"],["dubai","UAE"],["abu dhabi","UAE"],["tehran","Iran"],["baghdad","Iraq"],["riyadh","Saudi Arabia"],["jeddah","Saudi Arabia"],["cairo","Egypt"],["istanbul","Turkey"],["ankara","Turkey"],["jerusalem","Israel"],["tel aviv","Israel"],["gaza","Palestine"],["beirut","Lebanon"],
  ["colombo","Sri Lanka"],["islamabad","Pakistan"],["karachi","Pakistan"],["lahore","Pakistan"],["dhaka","Bangladesh"],["kathmandu","Nepal"],["kabul","Afghanistan"],
  ["mexico city","Mexico"],["kyiv","Ukraine"],["kiev","Ukraine"],["seoul","South Korea"],["pyongyang","North Korea"],["taipei","Taiwan"],["kuala lumpur","Malaysia"],["jakarta","Indonesia"],["manila","Philippines"],["hanoi","Vietnam"],["ho chi minh city","Vietnam"],
  ["johannesburg","South Africa"],["cape town","South Africa"],["pretoria","South Africa"],["lagos","Nigeria"],["nairobi","Kenya"],["antwerp","Belgium"],["brussels","Belgium"],["amsterdam","Netherlands"],["geneva","Switzerland"],["zurich","Switzerland"],["vienna","Austria"],["athens","Greece"],["lisbon","Portugal"],["dublin","Ireland"],["warsaw","Poland"],["stockholm","Sweden"],["oslo","Norway"],["copenhagen","Denmark"],["helsinki","Finland"]
]);
function resolveLocation(raw) {
  if (!raw) return null;
  const orig = String(raw).trim();
  if (!orig) return null;
  const parts = [orig, ...orig.split(",").map((p)=>p.trim()).reverse()].filter(Boolean);
  for (const part of parts){
    const cand = part.toLowerCase();
    if (NOISE_LOCATIONS.has(cand)) continue;
    if (COUNTRY_LITERALS.has(cand)) return { country: COUNTRY_LITERALS.get(cand), locality: null };
    if (US_SUBNATIONAL.has(cand)) return { country: "United States", locality: part };
    if (IN_SUBNATIONAL.has(cand)) return { country: "India", locality: part };
    if (WORLD_CITY.has(cand)) return { country: WORLD_CITY.get(cand), locality: part };
  }
  return null;
}
// Derive the dominant event location across a cluster's articles.
// Returns { label, country, locality, countryArticleCounts } or null when nothing maps.
function deriveClusterLocation(iqRows) {
  const artCount = new Map();     // country -> # articles mentioning it (article-share)
  const entCount = new Map();     // country -> total entity mentions (entity-share)
  const localityArt = new Map();  // "locality|country" -> # articles
  let articlesWithLoc = 0;
  for (const iq of (iqRows ?? [])){
    const locs = Array.isArray(iq && iq.entities && iq.entities.locations) ? iq.entities.locations : [];
    if (!locs.length) continue;
    const countriesHere = new Set();
    const localitiesHere = new Set();
    for (const loc of locs){
      const r = resolveLocation(loc);
      if (!r) continue;
      entCount.set(r.country, (entCount.get(r.country) ?? 0) + 1);
      countriesHere.add(r.country);
      if (r.locality) localitiesHere.add(`${r.locality}|${r.country}`);
    }
    if (countriesHere.size) articlesWithLoc++;
    for (const c of countriesHere) artCount.set(c, (artCount.get(c) ?? 0) + 1);
    for (const lk of localitiesHere) localityArt.set(lk, (localityArt.get(lk) ?? 0) + 1);
  }
  if (!artCount.size) return null;
  const totalArt = articlesWithLoc || 1;
  const totalEnt = Array.from(entCount.values()).reduce((a, b)=>a + b, 0) || 1;
  let best = null, bestScore = -1;
  for (const [c, ac] of artCount){
    const score = 0.6 * (ac / totalArt) + 0.4 * ((entCount.get(c) ?? 0) / totalEnt);
    if (score > bestScore){ bestScore = score; best = c; }
  }
  // Locality preservation: keep a sub-national locality only if it appears in a majority of
  // the dominant country's articles (so a one-off city mention can't qualify). Prefer a
  // state/province over a city when both qualify (better unit for regional/political stories).
  const domArticles = artCount.get(best) ?? 0;
  const minLoc = Math.ceil(domArticles * 0.5);
  let stateLoc = null, stateBest = 0, cityLoc = null, cityBest = 0;
  for (const [lk, n] of localityArt){
    const sep = lk.lastIndexOf("|");
    const loc = lk.slice(0, sep), ctry = lk.slice(sep + 1);
    if (ctry !== best || n < minLoc) continue;
    if (isStateLevel(loc, best)){ if (n > stateBest){ stateBest = n; stateLoc = loc; } }
    else if (n > cityBest){ cityBest = n; cityLoc = loc; }
  }
  const locality = stateLoc ?? cityLoc;
  const label = locality ? `${locality}, ${best}` : best;
  return { label, country: best, locality, countryArticleCounts: Object.fromEntries(artCount), countryEntityCounts: Object.fromEntries(entCount) };
}
// ── Topic name derivation (Tier 2 — short canonical label) ─────────────────────
async function deriveTopicName(rawTitle, openaiApiKey) {
  if (!openaiApiKey || !rawTitle.trim()) return rawTitle.slice(0, 500);
  try {
    const openai = makeOpenAI(openaiApiKey);
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Convert a news headline into a short, neutral 3–6 word topic category name. " + "The name should be a canonical label for the issue, not a description of the event. " + "Examples:\n" + "Headline: 'Russia is going backwards in equipment and deploying post WWII-era tanks' → 'Russia-Ukraine Military Conflict'\n" + "Headline: 'U.S. sinks 7 small Iranian boats as Iran launches attacks in Red Sea' → 'Iran-US Military Tensions'\n" + "Headline: 'Supreme Court temporarily restores access to abortion pill mifepristone' → 'Abortion Access Policy'\n" + "Headline: 'Top candidates face off in the CBS California Governor Debate' → 'California Governor Race'\n" + "Headline: 'China financial support for Iran contributes to instability around Strait of Hormuz' → 'China-Iran Economic Relations'\n" + "Headline: 'Gun violence at public events has risen 20% in the past year' → 'Gun Violence Policy'\n" + "Return ONLY the topic name. No punctuation at the end. No explanation. No quotes."
        },
        {
          role: "user",
          content: `Headline: "${rawTitle}"`
        }
      ],
      temperature: 0.2,
      max_tokens: 20
    });
    const name = completion.choices[0]?.message?.content?.trim() ?? "";
    return (name || rawTitle).slice(0, 500);
  } catch (err) {
    log("warn", "derive_topic_name_failed", {
      error: String(err),
      rawTitle: rawTitle.slice(0, 80)
    });
    return rawTitle.slice(0, 500);
  }
}
// ── Cluster context synthesis (Tier 1 — rich, specific, event-driven) ──────────
// Feeds the model each member article's headline + BODY (content-first), so the
// synthesis is grounded in the actual reporting rather than headlines/summaries.
async function synthesiseClusterContext(articles, openaiApiKey, fallback, maxArticles) {
  if (!openaiApiKey || articles.length === 0) return fallback;
  const articleLines = articles.filter((a)=>(a.title ?? "").trim() || (a.body ?? "").trim()).slice(0, maxArticles).map((a, i)=>{
    const title = (a.title ?? "").slice(0, 150);
    const body = (a.body ?? "").slice(0, 800);
    return `Article ${i + 1}:\nHeadline: ${title}\nContent: ${body || "(none)"}`;
  }).join("\n\n");
  if (!articleLines.trim()) return fallback;
  try {
    const openai = makeOpenAI(openaiApiKey);
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      max_tokens: 300,
      messages: [
        {
          role: "system",
          content: "You are summarising a cluster of news articles about the same story.\n\n" + "Write a 3-5 sentence factual synthesis that covers:\n" + "1. What is specifically happening right now (the concrete event, not the general topic)\n" + "2. Who is involved (named people, organisations, governments)\n" + "3. What decision, dispute or tension is currently live\n" + "4. Any relevant numbers, dates or recent developments\n\n" + "Rules:\n" + "- Be specific — name people, places, numbers wherever the articles provide them\n" + "- Use present tense where the situation is ongoing\n" + "- No opinions, no framing, no 'this raises questions about'\n" + "- This will be used to generate a civic stance question — give the question writer maximum concrete detail\n" + "- Return only the synthesis paragraph. No preamble, no heading, no bullet points."
        },
        {
          role: "user",
          content: `Synthesise these articles into a factual context paragraph:\n\n${articleLines}`
        }
      ]
    });
    const synthesis = completion.choices[0]?.message?.content?.trim() ?? "";
    return synthesis || fallback;
  } catch (err) {
    log("warn", "synthesise_cluster_context_failed", {
      error: String(err),
      articleCount: articles.length
    });
    return fallback;
  }
}
// ── Auth ───────────────────────────────────────────────────────────────────────
async function authorize(req) {
  const incoming = req.headers.get("x-cron-secret");
  const expected = Deno.env.get("CRON_SECRET") ?? "";
  if (expected && incoming === expected) return {
    ok: true
  };
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return {
    ok: false,
    status: 401,
    error: "unauthorized"
  };
  const { createClient: cc } = await import("https://esm.sh/@supabase/supabase-js@2.45.2");
  const client = cc(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`
      }
    }
  });
  const { data: userData, error: userErr } = await client.auth.getUser();
  if (userErr || !userData?.user) return {
    ok: false,
    status: 401,
    error: "unauthorized"
  };
  const { data: isAdmin, error: adminErr } = await client.rpc("is_admin_me");
  if (adminErr || !isAdmin) return {
    ok: false,
    status: 403,
    error: "forbidden"
  };
  return {
    ok: true
  };
}
// ── Main handler ───────────────────────────────────────────────────────────────
Deno.serve(async (req)=>{
  const traceId = crypto.randomUUID();
  const origin = req.headers.get("origin");
  const corsHeaders = {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-cron-secret",
    "Content-Type": "application/json"
  };
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      ok: false,
      error: "Method Not Allowed"
    }), {
      status: 405,
      headers: corsHeaders
    });
  }
  const auth = await authorize(req);
  if (!auth.ok) {
    log("warn", "auth_failed", {
      error: auth.error
    }, traceId);
    return new Response(JSON.stringify({
      ok: false,
      error: auth.error
    }), {
      status: auth.status ?? 401,
      headers: corsHeaders
    });
  }
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  const BATCH = Number(Deno.env.get("CREATE_DRAFTS_BATCH") ?? "20");
  const WINDOW_HOURS = Number(Deno.env.get("CREATE_DRAFTS_WINDOW_HOURS") ?? "72");
  const DEDUP_THRESHOLD = Number(Deno.env.get("CREATE_DRAFTS_DEDUP_THRESHOLD") ?? "0.78");
  const MAX_ARTICLES = Number(Deno.env.get("CREATE_DRAFTS_MAX_ARTICLES") ?? "6");
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    log("error", "missing_env", {}, traceId);
    return new Response(JSON.stringify({
      ok: false,
      error: "Missing SUPABASE_URL or SERVICE_ROLE"
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: {
      persistSession: false
    }
  });
  const sinceIso = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();
  log("info", "start", {
    batch: BATCH,
    windowHours: WINDOW_HOURS,
    sinceIso,
    dedupThreshold: DEDUP_THRESHOLD,
    maxArticles: MAX_ARTICLES
  }, traceId);
  const errors = [];
  let draftsCreated = 0;
  let skipped = 0;
  try {
    // ── Step 1: Fetch recent clusters with their member ingestion IDs ─────────
    const { data: clusterRows, error: clErr } = await sb.from("topic_clusters").select(`
        id,
        title,
        confidence,
        created_at,
        topic_cluster_items ( ingestion_id )
      `).gte("created_at", sinceIso).order("created_at", {
      ascending: false
    }).limit(BATCH * 3);
    if (clErr) {
      log("error", "select_clusters_failed", {
        error: clErr.message
      }, traceId);
      return new Response(JSON.stringify({
        ok: false,
        error: clErr.message
      }), {
        status: 500,
        headers: corsHeaders
      });
    }
    const clusters = clusterRows ?? [];
    log("info", "clusters_fetched", {
      count: clusters.length
    }, traceId);
    if (clusters.length === 0) {
      log("info", "no_clusters_in_window", {}, traceId);
      return new Response(JSON.stringify({
        ok: true,
        traceId,
        draftsCreated: 0,
        skipped: 0
      }), {
        status: 200,
        headers: corsHeaders
      });
    }
    // ── Step 2: Idempotency — exclude clusters that already have a draft ──────
    const clusterIds = clusters.map((c)=>c.id);
    const { data: existingDraftRows, error: edErr } = await sb.from("topic_drafts").select("cluster_id").in("cluster_id", clusterIds);
    if (edErr) {
      log("warn", "existing_drafts_check_failed", {
        error: edErr.message
      }, traceId);
    }
    const alreadyHasDraft = new Set((existingDraftRows ?? []).map((r)=>r.cluster_id));
    const needDraft = clusters.filter((c)=>!alreadyHasDraft.has(c.id) && c.topic_cluster_items.length > 0).slice(0, BATCH);
    log("info", "idempotency_stats", {
      total: clusters.length,
      alreadyHasDraft: alreadyHasDraft.size,
      noItems: clusters.filter((c)=>c.topic_cluster_items.length === 0).length,
      toProcess: needDraft.length
    }, traceId);
    if (needDraft.length === 0) {
      log("info", "all_clusters_have_drafts", {}, traceId);
      return new Response(JSON.stringify({
        ok: true,
        traceId,
        draftsCreated: 0,
        skipped: clusters.length
      }), {
        status: 200,
        headers: corsHeaders
      });
    }
    // ── Step 2b: Build civic tension dedup pool ───────────────────────────────
    function cosine(a, b) {
      let dot = 0, na = 0, nb = 0;
      const n = Math.min(a.length, b.length);
      for(let i = 0; i < n; i++){
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
      }
      if (na === 0 || nb === 0) return 0;
      return dot / (Math.sqrt(na) * Math.sqrt(nb));
    }
    function parseVec(value) {
      if (!value) return null;
      if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite).length ? value.map(Number) : null;
      if (typeof value === "string") {
        const m = value.match(/-?\d+(\.\d+)?([eE][+-]?\d+)?/g);
        return m?.length ? m.map(Number) : null;
      }
      return null;
    }
    const dedupPool = [];
    if (alreadyHasDraft.size > 0) {
      const existingClusterIdList = [
        ...alreadyHasDraft
      ];
      const CHUNK = 100;
      for(let i = 0; i < existingClusterIdList.length; i += CHUNK){
        const { data: centRows } = await sb.from("topic_clusters").select("id, centroid_vec").in("id", existingClusterIdList.slice(i, i + CHUNK)).not("centroid_vec", "is", null);
        for (const row of centRows ?? []){
          const c = parseVec(row.centroid_vec);
          if (c) dedupPool.push({
            cluster_id: row.id,
            centroid: c
          });
        }
      }
    }
    log("info", "dedup_pool_built", {
      dedupPoolSize: dedupPool.length,
      threshold: DEDUP_THRESHOLD
    }, traceId);
    // ── Step 3: Process clusters in parallel with concurrency limiter ─────────
    const CONCURRENCY = Number(Deno.env.get("CREATE_DRAFTS_CONCURRENCY") ?? "8");
    async function withConcurrency(items, fn, limit) {
      const results = [];
      let idx = 0;
      async function worker() {
        while(idx < items.length){
          const i = idx++;
          results[i] = await fn(items[i], i);
        }
      }
      const workers = Array.from({
        length: Math.min(limit, items.length)
      }, ()=>worker());
      await Promise.all(workers);
      return results;
    }
    await withConcurrency(needDraft, async (cluster)=>{
      const ingestionIds = cluster.topic_cluster_items.map((i)=>i.ingestion_id);
      // 3a. Civic tension dedup
      const { data: thisCentRow } = await sb.from("topic_clusters").select("centroid_vec").eq("id", cluster.id).not("centroid_vec", "is", null).maybeSingle();
      if (thisCentRow) {
        const thisCentroid = parseVec(thisCentRow.centroid_vec);
        if (thisCentroid && dedupPool.length > 0) {
          let maxSim = -1;
          let dupId = null;
          for (const entry of dedupPool){
            const sim = cosine(thisCentroid, entry.centroid);
            if (sim > maxSim) {
              maxSim = sim;
              dupId = entry.cluster_id;
            }
          }
          if (maxSim >= DEDUP_THRESHOLD) {
            log("info", "draft_skipped_dedup", {
              clusterId: cluster.id,
              existingClusterId: dupId,
              similarity: Number(maxSim.toFixed(4)),
              title: (cluster.title ?? "").slice(0, 80)
            }, traceId);
            skipped++;
            return;
          }
        }
      }
      // 3b. Load ingestion_queue rows (incl. normalized for body content)
      const { data: iqRows, error: iqErr } = await sb.from("ingestion_queue").select("id, url, title, summary, source_id, published_at, normalized, entities").in("id", ingestionIds).not("url", "is", null).order("published_at", {
        ascending: false
      }).limit(10);
      if (iqErr || !iqRows?.length) {
        log("warn", "ingestion_rows_not_found", {
          clusterId: cluster.id,
          error: iqErr?.message ?? "no rows"
        }, traceId);
        skipped++;
        return;
      }
      const urls = iqRows.map((r)=>r.url).filter(Boolean);
      const { data: newsRows, error: niErr } = await sb.from("news_items").select("id, title, summary, url, source_id, published_at").in("url", urls).order("published_at", {
        ascending: false
      }).limit(1);
      if (niErr || !newsRows?.length) {
        log("warn", "no_news_item_for_cluster", {
          clusterId: cluster.id,
          urlCount: urls.length,
          error: niErr?.message ?? "no rows"
        }, traceId);
        skipped++;
        return;
      }
      const newsItem = newsRows[0];
      const bestIq = iqRows[0];
      // 3c. Two-tier context — name from headline, synthesis from article BODIES
      const rawHeadline = (cluster.title ?? bestIq.title ?? newsItem.title ?? "").slice(0, 500);
      const synthArticles = iqRows.map((r)=>{
        const body = stripHtml(extractContent(r.normalized)) || (r.summary ?? "");
        return {
          title: r.title ?? null,
          body
        };
      });
      const [draftTitle, draftSummary] = await Promise.all([
        deriveTopicName(rawHeadline, OPENAI_API_KEY),
        synthesiseClusterContext(synthArticles, OPENAI_API_KEY, bestIq.summary ?? newsItem.summary ?? null, MAX_ARTICLES)
      ]);
      const clusterHeadlines = iqRows.map((r)=>r.title ?? "").filter(Boolean).slice(0, 10);
      const clusterArticleCount = iqRows.length;
      const normTags = (()=>{
        try {
          const tags = bestIq.normalized?.tags;
          return Array.isArray(tags) ? tags.slice(0, 10).map(String) : [];
        } catch  {
          return [];
        }
      })();
      // Event-based location (v6): derive from the cluster's extracted location entities;
      // fall back to the old source-based label only when nothing maps.
      const derivedLoc = deriveClusterLocation(iqRows);
      const locationLabel = derivedLoc
        ? derivedLoc.label
        : sanitizeLocationLabel(bestIq.normalized?.location_label ?? bestIq.normalized?.source_country ?? null);
      // 3d. Insert topic_draft
      const { data: draftRow, error: draftErr } = await sb.from("topic_drafts").insert({
        news_item_id: newsItem.id,
        cluster_id: cluster.id,
        title: draftTitle,
        summary: draftSummary,
        tags: normTags,
        location_label: locationLabel,
        status: "draft",
        ai_version: "create-topic-drafts-v6",
        ai_input: {
          cluster_id: cluster.id,
          cluster_title: cluster.title,
          raw_headline: rawHeadline,
          derived_title: draftTitle,
          cluster_confidence: cluster.confidence,
          cluster_article_count: clusterArticleCount,
          cluster_headlines: clusterHeadlines,
          ingestion_ids: ingestionIds,
          news_item_id: newsItem.id,
          news_item_url: newsItem.url,
          synthesis_used: draftSummary !== (bestIq.summary ?? newsItem.summary ?? null),
          location_signal: derivedLoc ? {
            country: derivedLoc.country,
            locality: derivedLoc.locality,
            country_article_counts: derivedLoc.countryArticleCounts,
            country_entity_counts: derivedLoc.countryEntityCounts
          } : null
        },
        ai_output: null
      }).select("id").single();
      if (draftErr) {
        if (draftErr.code === "23505") {
          log("info", "draft_already_exists_skipping", {
            clusterId: cluster.id,
            newsItemId: newsItem.id
          }, traceId);
          skipped++;
        } else {
          log("error", "draft_insert_failed", {
            clusterId: cluster.id,
            newsItemId: newsItem.id,
            error: draftErr.message,
            code: draftErr.code
          }, traceId);
          errors.push(`draft_insert(${cluster.id}): ${draftErr.message}`);
        }
        return;
      }
      draftsCreated++;
      const newCentroid = parseVec(thisCentRow?.centroid_vec ?? null);
      if (newCentroid) dedupPool.push({
        cluster_id: cluster.id,
        centroid: newCentroid
      });
      log("info", "draft_created", {
        draftId: draftRow?.id,
        clusterId: cluster.id,
        newsItemId: newsItem.id,
        rawHeadline: rawHeadline.slice(0, 80),
        draftTitle: draftTitle.slice(0, 80),
        clusterArticleCount,
        synthesisLength: draftSummary?.length ?? 0
      }, traceId);
    }, CONCURRENCY);
  } catch (err) {
    log("error", "unhandled_exception", {
      error: err?.message,
      stack: (err?.stack ?? "").slice(0, 800)
    }, traceId);
    return new Response(JSON.stringify({
      ok: false,
      traceId,
      error: err?.message
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
  log("info", "complete", {
    draftsCreated,
    skipped,
    errorCount: errors.length
  }, traceId);
  return new Response(JSON.stringify({
    ok: true,
    traceId,
    draftsCreated,
    skipped,
    errors: errors.length ? errors : undefined
  }), {
    status: 200,
    headers: corsHeaders
  });
});
