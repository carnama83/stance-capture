// supabase/functions/cluster/logic.ts
// PRODUCTION VERSION with Entity Reinforcement + Two-Tier clustering (Event → Story)
//
// v3.7 — Scoring + safety fixes (content-quality era):
//   [Fix A] Entity scoring is now ADDITIVE REINFORCEMENT, not a linear blend.
//           Old: combined = embSim*(1-w) + entSim*w  — this dragged genuine
//           same-event pairs below threshold because entity-overlap magnitudes
//           (~0.3–0.5) are far smaller than cosine (~0.9). e.g. a 0.927-cosine
//           same-event pair blended down to 0.82 and failed to cluster.
//           New: score = min(1, embSim + ENTITY_WEIGHT * entSim). Entities can
//           only RAISE a score, never sink a strong embedding match. When either
//           side lacks entities, score = embSim (no penalty, no degeneracy).
//   [Fix B] seedAssign no longer dumps overflow items into the nearest cluster
//           with NO similarity floor. Once the cluster cap is reached, an item is
//           force-assigned only if it clears FORCE_ASSIGN_MIN_SIM, else routed to
//           the overflow bucket (if enabled) or left UNASSIGNED. The old
//           unconditional nearest-cluster assignment created incoherent clusters.
//   [Fix C] expandPass compares against the cluster CENTROID instead of individual
//           member vectors (single-linkage), which prevents distinct events from
//           chaining together through a single bridge article.
//   [Fix D] Defaults retuned to the measured embedding gap (same-event ~0.90,
//           different-event ~0.38): MAX_CLUSTERS 200, SEED 0.84, EXPAND 0.80,
//           ENTITY_WEIGHT 0.15 (now a reinforcement coefficient), MIN_ITEMS 2.
//   [Fix E] Removed dead buildArticleText() + its stale summary-first CONTENT_KEYS
//           and quality helpers (entity extraction moved to extract-entities).
//
// NOTE on CLUSTER_ENTITY_WEIGHT: its MEANING changed (linear-blend weight →
//   additive reinforcement coefficient). If you have it set in secrets, update it
//   to ~0.15. Larger values give entities more lift; keep it modest.
//
// NOTE on two_tier mode: the EVENT tier currently uses SIM_THRESHOLD and the STORY
//   tier uses SEED_THRESHOLD, which is inverted (event should be the TIGHTER tier).
//   This file fixes single-tier (the default). If you switch CLUSTER_MODE=two_tier,
//   revisit those two thresholds separately.
//
// Pipeline position: ingest → embed → extract-entities → cluster (this file) → generate
//
// Env vars (set in Supabase Edge Function Secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY)
//   CLUSTER_BUDGET_MS              — set to 90000
//   CLUSTER_MODE                   — "single" | "two_tier"   (default single)
//   CLUSTER_WINDOW_HOURS           — default 72
//   CLUSTER_CANDIDATE_LIMIT        — default 200
//   CLUSTER_SIM_THRESHOLD          — default 0.75 (two_tier event tier only)
//   CLUSTER_SEED_THRESHOLD         — default 0.84
//   CLUSTER_EXPAND_THRESHOLD       — default 0.80
//   CLUSTER_ENTITY_WEIGHT          — default 0.15 (ADDITIVE reinforcement coefficient)
//   CLUSTER_MIN_ITEMS              — default 2
//   CLUSTER_MIN_SOURCES            — default 1
//   CLUSTER_MAX_CLUSTERS           — default 200
//   CLUSTER_FORCE_ASSIGN_MIN_SIM   — default 0.70
//   CLUSTER_OVERFLOW_BUCKET        — default false
//   CLUSTER_ITEMS_CHUNK            — default 200
//   CLUSTER_MERGE_THRESHOLD        — default 0.84 (cross-run cluster merge)
//   CLUSTER_DRAFT_DEDUP_THRESHOLD  — default 0.78 (civic tension dedup)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.2";
// ── Location label allowlist ──────────────────────────────────────────────────
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
  const trimmed = raw.trim();
  if (KNOWN_LOCATION_LABELS.has(trimmed)) return trimmed;
  for (const known of KNOWN_LOCATION_LABELS){
    if (known.toLowerCase() === trimmed.toLowerCase()) return known;
  }
  return null;
}
function envInt(key, fallback) {
  const v = Deno.env.get(key);
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function envFloat(key, fallback) {
  const v = Deno.env.get(key);
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function envStr(key, fallback) {
  return Deno.env.get(key) ?? fallback;
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for(let i = 0; i < n; i++){
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
function meanVector(vectors) {
  if (vectors.length === 0) return [];
  const dim = vectors[0]?.length ?? 0;
  const out = new Array(dim).fill(0);
  for (const v of vectors){
    for(let i = 0; i < dim; i++)out[i] += v[i] ?? 0;
  }
  for(let i = 0; i < dim; i++)out[i] /= vectors.length;
  return out;
}
function toVectorLiteral(vec) {
  return `[${vec.join(",")}]`;
}
function parseEmbedding(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    const arr = value.map((x)=>Number(x)).filter((n)=>Number.isFinite(n));
    return arr.length ? arr : null;
  }
  if (typeof value === "string") {
    const s = value.trim();
    // Fast path: pgvector text form "[0.1,0.2,...]" is valid JSON. JSON.parse is
    // native and cheaper than a global-regex tokenizer over a ~20-30KB string.
    // This path is hit for every candidate embedding (STEP 5) and every existing
    // centroid_vec (STEP 13c). Regex retained below as a tolerant fallback.
    if (s.length >= 2 && s.charCodeAt(0) === 91 /* '[' */) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) {
          const arr = parsed.map((x)=>Number(x)).filter((n)=>Number.isFinite(n));
          if (arr.length) return arr;
        }
      } catch  {
      // malformed — fall through to regex fallback
      }
    }
    const matches = s.match(/-?\d+(\.\d+)?([eE][+-]?\d+)?/g);
    if (!matches?.length) return null;
    const arr = matches.map((m)=>Number(m)).filter((n)=>Number.isFinite(n));
    return arr.length ? arr : null;
  }
  if (typeof value === "object") {
    try {
      const asAny = value;
      if (Array.isArray(asAny.data)) {
        const arr = asAny.data.map((x)=>Number(x)).filter((n)=>Number.isFinite(n));
        return arr.length ? arr : null;
      }
      const str = JSON.stringify(value);
      const matches = str.match(/-?\d+(\.\d+)?([eE][+-]?\d+)?/g);
      if (!matches?.length) return null;
      const arr = matches.map((m)=>Number(m)).filter((n)=>Number.isFinite(n));
      return arr.length ? arr : null;
    } catch  {
      return null;
    }
  }
  return null;
}
function calculateEntityOverlap(e1, e2) {
  if (!e1 || !e2) return 0;
  function jaccard(a, b) {
    if (!a.length && !b.length) return 0;
    const toStrings = (arr)=>arr.filter((s)=>typeof s === "string" && s.length > 0);
    const s1 = new Set(toStrings(a).map((s)=>s.toLowerCase()));
    const s2 = new Set(toStrings(b).map((s)=>s.toLowerCase()));
    const inter = [
      ...s1
    ].filter((x)=>s2.has(x)).length;
    const union = new Set([
      ...s1,
      ...s2
    ]).size;
    return union > 0 ? inter / union : 0;
  }
  return jaccard(e1.people ?? [], e2.people ?? []) * 0.35 + jaccard(e1.organizations ?? [], e2.organizations ?? []) * 0.25 + jaccard(e1.locations ?? [], e2.locations ?? []) * 0.20 + jaccard(e1.events ?? [], e2.events ?? []) * 0.20;
}
// ── Scoring: additive entity reinforcement ────────────────────────────────────
// Entities can only RAISE the score above the embedding cosine, never lower it.
// When either side has no entities, the score is the pure embedding cosine —
// which also means missing entities can never cripple the thresholds.
function reinforcedScore(embSim, rowEntities, clusterEntities, entityWeight) {
  if (!rowEntities || !clusterEntities) return embSim;
  const entSim = calculateEntityOverlap(rowEntities, clusterEntities);
  if (entSim <= 0) return embSim;
  return Math.min(1, embSim + entityWeight * entSim);
}
function mergeEntities(items) {
  const out = {
    people: [],
    organizations: [],
    locations: [],
    events: [],
    mainTopic: ""
  };
  for (const e of items){
    if (!e) continue;
    for (const x of e.people ?? []) if (typeof x === "string" && x.length > 0) out.people.push(x);
    for (const x of e.organizations ?? []) if (typeof x === "string" && x.length > 0) out.organizations.push(x);
    for (const x of e.locations ?? []) if (typeof x === "string" && x.length > 0) out.locations.push(x);
    for (const x of e.events ?? []) if (typeof x === "string" && x.length > 0) out.events.push(x);
    if (!out.mainTopic && e.mainTopic) out.mainTopic = e.mainTopic;
  }
  const dedupe = (arr)=>{
    const seen = new Set();
    return arr.filter((x)=>{
      if (typeof x !== "string") return false;
      const k = x.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 40);
  };
  out.people = dedupe(out.people ?? []);
  out.organizations = dedupe(out.organizations ?? []);
  out.locations = dedupe(out.locations ?? []);
  out.events = dedupe(out.events ?? []);
  const hasAny = (out.people?.length ?? 0) + (out.organizations?.length ?? 0) + (out.locations?.length ?? 0) + (out.events?.length ?? 0) > 0;
  return hasAny ? out : null;
}
function distinctSources(members) {
  return new Set(members.map((m)=>m.source_id).filter(Boolean)).size;
}
function makeMember(row, similarity) {
  return {
    id: row.id,
    source_id: row.source_id,
    similarity,
    title: row.title ?? null,
    entities: row.entities ?? null
  };
}
function addMember(cl, row, vec, similarity) {
  cl.members.push(makeMember(row, similarity));
  cl.memberVecs.push(vec);
  cl.centroid = meanVector(cl.memberVecs);
  cl.aggEntities = mergeEntities(cl.members.map((m)=>m.entities));
}
function seedAssign(items, cfg) {
  const { seedThreshold, entityWeight, maxClusters, forceAssignMinSim, overflowBucket, log, label } = cfg;
  const clusters = [];
  if (overflowBucket) clusters.push({
    id: "__overflow__",
    centroid: [],
    memberVecs: [],
    members: [],
    aggEntities: null
  });
  let i = 0;
  for (const row of items){
    i++;
    if (i % 50 === 0) log("info", `${label}.seed.progress`, {
      processed: i,
      total: items.length
    });
    const vec = row.vec;
    let bestIdx = -1, bestSim = -1;
    for(let c = 0; c < clusters.length; c++){
      const cl = clusters[c];
      if (!cl.centroid.length) continue;
      const embSim = cosine(vec, cl.centroid);
      const score = reinforcedScore(embSim, row.entities, cl.aggEntities, entityWeight);
      if (score > bestSim) {
        bestSim = score;
        bestIdx = c;
      }
    }
    if (bestSim >= seedThreshold && bestIdx >= 0) {
      // Strong match → join best cluster.
      addMember(clusters[bestIdx], row, vec, bestSim);
    } else if (clusters.length < maxClusters) {
      // No strong match and room remains → start a new cluster.
      clusters.push({
        id: crypto.randomUUID(),
        centroid: vec,
        memberVecs: [
          vec
        ],
        members: [
          makeMember(row, 1)
        ],
        aggEntities: mergeEntities([
          row.entities
        ])
      });
    } else if (bestIdx >= 0 && bestSim >= forceAssignMinSim) {
      // Cluster cap reached, but the item is still reasonably similar → force-assign.
      addMember(clusters[bestIdx], row, vec, bestSim);
    } else if (overflowBucket && clusters[0]?.id === "__overflow__") {
      // Cap reached and too dissimilar to force-assign → overflow bucket (discarded later).
      addMember(clusters[0], row, vec, bestSim);
      log("warn", `${label}.seed.overflow`, {
        itemId: row.id,
        similarity: bestSim
      });
    }
  // Otherwise: leave the item UNASSIGNED. We do NOT dump it into the nearest
  // cluster with no similarity floor — that is what produced incoherent clusters.
  }
  return clusters;
}
function expandPass(items, clusters, cfg) {
  const { expandThreshold, entityWeight, log, label } = cfg;
  const maxIters = cfg.maxIters ?? 4;
  const expandable = clusters.filter((c)=>c.id !== "__overflow__" && c.members.length >= 2);
  const assigned = new Set();
  for (const c of expandable)for (const m of c.members)assigned.add(m.id);
  let it = 0, grew = true;
  while(grew && it++ < maxIters){
    grew = false;
    let added = 0;
    for (const row of items){
      if (assigned.has(row.id)) continue;
      let bestCluster = null, bestSim = -1;
      for (const cl of expandable){
        if (!cl.centroid.length) continue;
        // Compare against the cluster CENTROID (not individual members) to avoid
        // single-linkage chaining of distinct events through a bridge article.
        const embSim = cosine(row.vec, cl.centroid);
        const score = reinforcedScore(embSim, row.entities, cl.aggEntities, entityWeight);
        if (score > bestSim) {
          bestSim = score;
          bestCluster = cl;
        }
      }
      if (bestCluster && bestSim >= expandThreshold) {
        addMember(bestCluster, row, row.vec, bestSim);
        assigned.add(row.id);
        grew = true;
        added++;
      }
    }
    log("info", `${label}.expand.iteration`, {
      iteration: it,
      itemsAdded: added,
      totalAssigned: assigned.size
    });
  }
  return {
    clusters,
    assigned
  };
}
export async function run(ctx) {
  const { log, shouldStop } = ctx;
  log("info", "🚀 CLUSTER START", {
    ts: new Date().toISOString()
  });
  // ── Step 1: Environment ────────────────────────────────────────────────────
  log("info", "📋 STEP 1: Loading environment variables", {});
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  const CLUSTER_MODE = envStr("CLUSTER_MODE", "single").toLowerCase();
  const WINDOW_HOURS = envInt("CLUSTER_WINDOW_HOURS", 72);
  const CANDIDATE_LIMIT = envInt("CLUSTER_CANDIDATE_LIMIT", 200);
  const SIM_THRESHOLD = envFloat("CLUSTER_SIM_THRESHOLD", 0.75);
  const SEED_THRESHOLD = envFloat("CLUSTER_SEED_THRESHOLD", 0.84);
  const EXPAND_THRESHOLD = envFloat("CLUSTER_EXPAND_THRESHOLD", 0.80);
  const ENTITY_WEIGHT = envFloat("CLUSTER_ENTITY_WEIGHT", 0.15);
  const MIN_ITEMS = envInt("CLUSTER_MIN_ITEMS", 2);
  const MIN_SOURCES = envInt("CLUSTER_MIN_SOURCES", 1);
  const MAX_CLUSTERS = envInt("CLUSTER_MAX_CLUSTERS", 200);
  const FORCE_ASSIGN_MIN_SIM = envFloat("CLUSTER_FORCE_ASSIGN_MIN_SIM", 0.70);
  const OVERFLOW_BUCKET = envStr("CLUSTER_OVERFLOW_BUCKET", "false") === "true";
  const ITEMS_CHUNK = envInt("CLUSTER_ITEMS_CHUNK", 200);
  const isTwoTier = CLUSTER_MODE === "two_tier" || CLUSTER_MODE === "two-tier";
  log("info", "✅ Configuration loaded", {
    mode: CLUSTER_MODE,
    windowHours: WINDOW_HOURS,
    candidateLimit: CANDIDATE_LIMIT,
    simThreshold: SIM_THRESHOLD,
    seedThreshold: SEED_THRESHOLD,
    expandThreshold: EXPAND_THRESHOLD,
    entityWeight: ENTITY_WEIGHT,
    minItems: MIN_ITEMS,
    minSources: MIN_SOURCES,
    maxClusters: MAX_CLUSTERS,
    forceAssignMinSim: FORCE_ASSIGN_MIN_SIM,
    overflowBucket: OVERFLOW_BUCKET,
    itemsChunk: ITEMS_CHUNK,
    hasSupabaseUrl: !!SUPABASE_URL,
    hasServiceRole: !!SERVICE_ROLE
  });
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    log("error", "❌ Missing required environment variables", {});
    return {
      clusters: 0,
      items: 0,
      updated: 0,
      skipped: 0,
      failed: 1,
      errors: [
        "Missing SUPABASE_URL or SERVICE_ROLE"
      ],
      eventClusters: 0,
      storyClusters: 0,
      mode: CLUSTER_MODE,
      draftsCreated: 0
    };
  }
  // ── Step 2: Database connection ────────────────────────────────────────────
  log("info", "📋 STEP 2: Connecting to Supabase", {});
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: {
      persistSession: false
    }
  });
  const errors = [];
  let failed = 0, skipped = 0;
  const sinceIso = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();
  // ── Step 3: Window inventory ───────────────────────────────────────────────
  log("info", "📋 STEP 3: Checking window inventory", {});
  const inv = await sb.from("ingestion_queue").select("id", {
    count: "exact",
    head: true
  }).gte("created_at", sinceIso);
  log("info", inv.error ? "❌ Window inventory failed" : "✅ Window inventory", {
    sinceIso,
    totalInWindow: inv.count ?? 0,
    error: inv.error?.message ?? null
  });
  // ── Step 4: Load candidates with embeddings ────────────────────────────────
  log("info", "📋 STEP 4: Loading candidates WITH embeddings", {});
  const { data: embRows, error: embErr } = await sb.from("ingestion_queue").select("id, source_id, title, summary, raw, normalized, url, embedding, created_at, entities, embed_status").gte("created_at", sinceIso).not("embedding", "is", null).eq("embed_status", "done").order("created_at", {
    ascending: false
  }).limit(CANDIDATE_LIMIT);
  log("info", embErr ? "❌ Load candidates failed" : "✅ Load candidates complete", {
    count: embRows?.length ?? 0,
    error: embErr?.message ?? null
  });
  if (embErr) {
    failed++;
    errors.push(`select_ingestion_with_embedding_failed: ${embErr.message}`);
    return {
      clusters: 0,
      items: 0,
      updated: 0,
      skipped,
      failed,
      errors,
      eventClusters: 0,
      storyClusters: 0,
      mode: CLUSTER_MODE,
      draftsCreated: 0
    };
  }
  // ── Step 5: Parse embeddings ───────────────────────────────────────────────
  log("info", "📋 STEP 5: Parsing embeddings", {});
  const parsed = (embRows ?? []).map((r)=>{
    const vec = parseEmbedding(r.embedding);
    return vec ? {
      ...r,
      embedding: vec
    } : null;
  }).filter(Boolean);
  log("info", "✅ Embedding parsing complete", {
    totalLoaded: embRows?.length ?? 0,
    successfullyParsed: parsed.length,
    parseFailures: (embRows?.length ?? 0) - parsed.length
  });
  if (parsed.length === 0) {
    log("warn", "⚠️ NO USABLE CANDIDATES", {
      sinceIso,
      candidateLimit: CANDIDATE_LIMIT
    });
    return {
      clusters: 0,
      items: 0,
      updated: 0,
      skipped,
      failed,
      errors: errors.length ? errors : undefined,
      eventClusters: 0,
      storyClusters: 0,
      mode: CLUSTER_MODE,
      draftsCreated: 0
    };
  }
  // ── Step 6: Entity coverage check ─────────────────────────────────────────
  log("info", "📋 STEP 6: Checking entity coverage", {});
  const itemsWithEntities = parsed.filter((r)=>r.entities).length;
  const itemsWithoutEntities = parsed.filter((r)=>!r.entities).length;
  log(itemsWithoutEntities > 0 ? "warn" : "info", itemsWithoutEntities > 0 ? "⚠️ Some items missing entities — clustering will fall back to pure embedding for those" : "✅ All items have entities", {
    itemsWithEntities,
    itemsWithoutEntities,
    coveragePct: parsed.length > 0 ? Math.round(itemsWithEntities / parsed.length * 100) : 0
  });
  // ── Step 7: Idempotency check ──────────────────────────────────────────────
  log("info", "📋 STEP 7: Checking for already-clustered items", {});
  const candIds = parsed.map((r)=>r.id);
  const IDEMPOTENCY_CHUNK = 100;
  const existingIngestionIds = [];
  for(let i = 0; i < candIds.length; i += IDEMPOTENCY_CHUNK){
    const chunkIds = candIds.slice(i, i + IDEMPOTENCY_CHUNK);
    const { data: chunkData, error: chunkErr } = await sb.from("topic_cluster_items").select("ingestion_id").in("ingestion_id", chunkIds);
    if (chunkErr) {
      failed++;
      errors.push(`select_existing_cluster_items_failed: ${chunkErr.message}`);
      log("error", "❌ Idempotency check failed", {
        atIndex: i,
        error: chunkErr.message
      });
      return {
        clusters: 0,
        items: 0,
        updated: 0,
        skipped,
        failed,
        errors,
        eventClusters: 0,
        storyClusters: 0,
        mode: CLUSTER_MODE,
        draftsCreated: 0
      };
    }
    for (const row of chunkData ?? [])existingIngestionIds.push(row.ingestion_id);
  }
  log("info", "✅ Idempotency check complete", {
    alreadyClustered: existingIngestionIds.length,
    error: null
  });
  const already = new Set(existingIngestionIds);
  const toCluster = parsed.filter((r)=>!already.has(r.id));
  log("info", "📊 Idempotency stats", {
    usable: parsed.length,
    alreadyClustered: already.size,
    toCluster: toCluster.length
  });
  if (toCluster.length === 0) {
    log("warn", "⚠️ ALL ITEMS ALREADY CLUSTERED", {});
    return {
      clusters: 0,
      items: 0,
      updated: 0,
      skipped,
      failed,
      errors: errors.length ? errors : undefined,
      eventClusters: 0,
      storyClusters: 0,
      mode: CLUSTER_MODE,
      draftsCreated: 0
    };
  }
  const items = toCluster.map((r)=>({
      id: r.id,
      vec: r.embedding,
      source_id: r.source_id ?? null,
      title: r.title ?? null,
      entities: r.entities ?? null
    }));
  // ── Step 8: Cluster ────────────────────────────────────────────────────────
  let eventClustersCount = 0, storyClustersCount = 0;
  let finalStoryClusters = [];
  if (!isTwoTier) {
    log("info", "📋 STEP 8: Single-tier seed → expand clustering", {
      itemsToCluster: items.length,
      seedThreshold: SEED_THRESHOLD,
      expandThreshold: EXPAND_THRESHOLD,
      entityWeight: ENTITY_WEIGHT,
      maxClusters: MAX_CLUSTERS
    });
    let clusters = seedAssign(items, {
      seedThreshold: SEED_THRESHOLD,
      entityWeight: ENTITY_WEIGHT,
      maxClusters: MAX_CLUSTERS,
      forceAssignMinSim: FORCE_ASSIGN_MIN_SIM,
      overflowBucket: OVERFLOW_BUCKET,
      log,
      label: "single"
    });
    const exp = expandPass(items, clusters, {
      expandThreshold: EXPAND_THRESHOLD,
      entityWeight: ENTITY_WEIGHT,
      log,
      label: "single",
      maxIters: 5
    });
    clusters = exp.clusters;
    for (const c of clusters)c.aggEntities = mergeEntities(c.members.map((m)=>m.entities));
    finalStoryClusters = clusters;
    storyClustersCount = clusters.length;
  } else {
    const EVENT_THRESHOLD = SIM_THRESHOLD;
    log("info", "📋 STEP 8A: Tier 1 EVENT clustering", {
      itemsToCluster: items.length,
      eventThreshold: EVENT_THRESHOLD,
      entityWeight: ENTITY_WEIGHT
    });
    let eventClusters = seedAssign(items, {
      seedThreshold: EVENT_THRESHOLD,
      entityWeight: ENTITY_WEIGHT,
      maxClusters: Math.max(MAX_CLUSTERS, 200),
      forceAssignMinSim: FORCE_ASSIGN_MIN_SIM,
      overflowBucket: false,
      log,
      label: "event"
    });
    const exp1 = expandPass(items, eventClusters, {
      expandThreshold: EVENT_THRESHOLD,
      entityWeight: ENTITY_WEIGHT,
      log,
      label: "event",
      maxIters: 3
    });
    eventClusters = exp1.clusters;
    for (const c of eventClusters)c.aggEntities = mergeEntities(c.members.map((m)=>m.entities));
    eventClustersCount = eventClusters.length;
    if (shouldStop()) {
      log("warn", "⏰ Budget exceeded after EVENT tier", {
        eventClusters: eventClustersCount
      });
      return {
        clusters: 0,
        items: 0,
        updated: 0,
        skipped: skipped + 1,
        failed,
        errors: errors.length ? errors : undefined,
        eventClusters: eventClustersCount,
        storyClusters: 0,
        mode: CLUSTER_MODE,
        draftsCreated: 0
      };
    }
    const eventNodes = eventClusters.filter((c)=>c.id !== "__overflow__").map((c)=>({
        id: c.id,
        vec: c.centroid,
        source_id: null,
        title: c.members.find((m)=>(m.title ?? "").trim())?.title ?? "Event cluster",
        entities: c.aggEntities ?? null
      }));
    log("info", "📋 STEP 8B: Tier 2 STORY clustering", {
      storySeedThreshold: SEED_THRESHOLD,
      storyExpandThreshold: EXPAND_THRESHOLD,
      eventNodes: eventNodes.length,
      entityWeight: ENTITY_WEIGHT,
      maxClusters: MAX_CLUSTERS
    });
    let storyClusters = seedAssign(eventNodes, {
      seedThreshold: SEED_THRESHOLD,
      entityWeight: ENTITY_WEIGHT,
      maxClusters: MAX_CLUSTERS,
      forceAssignMinSim: FORCE_ASSIGN_MIN_SIM,
      overflowBucket: OVERFLOW_BUCKET,
      log,
      label: "story"
    });
    const exp2 = expandPass(eventNodes, storyClusters, {
      expandThreshold: EXPAND_THRESHOLD,
      entityWeight: ENTITY_WEIGHT,
      log,
      label: "story",
      maxIters: 4
    });
    storyClusters = exp2.clusters;
    for (const c of storyClusters)c.aggEntities = mergeEntities(c.members.map((m)=>m.entities));
    storyClustersCount = storyClusters.length;
    const eventToStory = new Map();
    for (const sc of storyClusters)for (const m of sc.members)eventToStory.set(m.id, sc.id);
    const storyById = new Map();
    for (const sc of storyClusters){
      storyById.set(sc.id, {
        id: sc.id,
        centroid: sc.centroid,
        memberVecs: [],
        members: [],
        aggEntities: sc.aggEntities ?? null
      });
    }
    for (const ec of eventClusters){
      const storyId = eventToStory.get(ec.id);
      if (!storyId) continue;
      const out = storyById.get(storyId);
      if (!out) continue;
      for(let i = 0; i < ec.members.length; i++){
        out.members.push(ec.members[i]);
        out.memberVecs.push(ec.memberVecs[i]);
      }
    }
    for (const c of storyById.values()){
      c.centroid = meanVector(c.memberVecs);
      c.aggEntities = mergeEntities(c.members.map((m)=>m.entities));
    }
    finalStoryClusters = Array.from(storyById.values());
  }
  // ── Step 9: Filter valid clusters ──────────────────────────────────────────
  log("info", "📋 STEP 9: Filtering clusters", {
    minItems: MIN_ITEMS,
    minSources: MIN_SOURCES
  });
  const overflowCluster = finalStoryClusters.find((c)=>c.id === "__overflow__");
  if (overflowCluster) {
    log("warn", "🗑️ Discarding overflow bucket (not persisted as a cluster)", {
      itemCount: overflowCluster.members.length
    });
  }
  const valid = finalStoryClusters.filter((c)=>{
    if (c.id === "__overflow__") return false;
    return c.members.length >= MIN_ITEMS && distinctSources(c.members) >= MIN_SOURCES;
  });
  log("info", valid.length ? "✅ Filter complete" : "⚠️ NO VALID CLUSTERS", {
    rawClusters: finalStoryClusters.length,
    validClusters: valid.length,
    filtered: finalStoryClusters.length - valid.length,
    overflowDiscarded: overflowCluster?.members.length ?? 0
  });
  if (valid.length === 0) {
    return {
      clusters: 0,
      items: 0,
      updated: 0,
      skipped,
      failed,
      errors: errors.length ? errors : undefined,
      eventClusters: eventClustersCount,
      storyClusters: storyClustersCount,
      mode: CLUSTER_MODE,
      draftsCreated: 0
    };
  }
  // ── Step 10: Persist clusters ──────────────────────────────────────────────
  log("info", "📋 STEP 10: Persisting clusters to database", {
    clustersToSave: valid.length
  });
  const clusterRows = valid.map((c)=>{
    const bestTitle = c.members.find((m)=>(m.title ?? "").trim().length > 0)?.title ?? "Untitled cluster";
    const sims = c.memberVecs.map((v)=>cosine(v, c.centroid));
    const avgSim = sims.reduce((s, x)=>s + x, 0) / Math.max(1, sims.length);
    return {
      id: c.id,
      title: bestTitle.toString().slice(0, 180),
      method: isTwoTier ? "two_tier_embedding_entity_v3_7" : "embedding_entity_v3_7",
      confidence: Number(avgSim.toFixed(4)),
      centroid: c.centroid,
      centroid_vec: toVectorLiteral(c.centroid)
    };
  });
  const { error: insCErr } = await sb.from("topic_clusters").insert(clusterRows);
  log("info", insCErr ? "❌ Insert clusters failed" : "✅ Insert clusters complete", {
    error: insCErr?.message ?? null
  });
  if (insCErr) {
    failed++;
    errors.push(`insert_topic_clusters_failed: ${insCErr.message}`);
    return {
      clusters: 0,
      items: 0,
      updated: 0,
      skipped,
      failed,
      errors,
      eventClusters: eventClustersCount,
      storyClusters: storyClustersCount,
      mode: CLUSTER_MODE,
      draftsCreated: 0
    };
  }
  // ── Step 11: Persist cluster items ─────────────────────────────────────────
  log("info", "📋 STEP 11: Persisting cluster items", {});
  const itemRows = valid.flatMap((c)=>c.members.map((m, idx)=>{
      const v = c.memberVecs[idx];
      const simToCentroid = v ? cosine(v, c.centroid) : m.similarity ?? 0;
      return {
        cluster_id: c.id,
        ingestion_id: m.id,
        similarity: Number(simToCentroid.toFixed(6))
      };
    }));
  let createdItems = 0;
  for(let i = 0; i < itemRows.length; i += ITEMS_CHUNK){
    const chunkSlice = itemRows.slice(i, i + ITEMS_CHUNK);
    const { error: insIErr } = await sb.from("topic_cluster_items").insert(chunkSlice);
    if (insIErr) {
      failed++;
      errors.push(`insert_topic_cluster_items_failed: ${insIErr.message}`);
      log("error", "❌ Insert cluster items failed", {
        error: insIErr.message,
        atIndex: i
      });
      break;
    }
    createdItems += chunkSlice.length;
    if (shouldStop()) {
      skipped++;
      log("warn", "⏰ Budget — stopping after partial item insert", {
        createdItems,
        remaining: itemRows.length - createdItems
      });
      break;
    }
  }
  log("info", "✅ Cluster items insert complete", {
    itemsCreated: createdItems,
    totalRequired: itemRows.length
  });
  // ── Step 12: Mark clustered items with finished_at ─────────────────────────
  log("info", "📋 STEP 12: Marking clustered items with finished_at", {});
  const processedIds = valid.flatMap((c)=>c.members.map((m)=>m.id));
  if (processedIds.length > 0) {
    const { error: tsErr } = await sb.from("ingestion_queue").update({
      finished_at: new Date().toISOString()
    }).in("id", processedIds);
    log("info", tsErr ? "⚠️ finished_at update failed (non-fatal)" : "✅ finished_at update complete", {
      error: tsErr?.message ?? null,
      count: processedIds.length
    });
  }
  if (shouldStop()) {
    log("warn", "⏰ Budget exceeded before draft creation — clusters saved, drafts deferred", {});
    return {
      clusters: valid.length,
      items: createdItems,
      updated: 0,
      skipped,
      failed,
      errors: errors.length ? errors : undefined,
      eventClusters: eventClustersCount,
      storyClusters: storyClustersCount,
      mode: CLUSTER_MODE,
      draftsCreated: 0
    };
  }
  // ── Step 13: Promote ingestion_queue → news_items → topic_drafts ───────────
  log("info", "📋 STEP 13: Promoting to news_items and creating topic_drafts", {});
  let draftsCreated = 0;
  const MERGE_THRESHOLD = envFloat("CLUSTER_MERGE_THRESHOLD", 0.84);
  const DRAFT_DEDUP_THRESHOLD = envFloat("CLUSTER_DRAFT_DEDUP_THRESHOLD", 0.78);
  // 13a: Promote ingestion_queue → news_items (idempotent by URL)
  const { data: popResult, error: popErr } = await sb.rpc("populate_news_items_from_ingestion_queue", {
    p_days: Math.ceil(WINDOW_HOURS / 24) + 1,
    p_limit: CANDIDATE_LIMIT
  });
  log("info", popErr ? "⚠️ populate_news_items failed (non-fatal)" : "✅ populate_news_items complete", {
    result: popResult,
    error: popErr?.message ?? null
  });
  // 13b: Build URL → news_item.id map
  const clusterUrls = valid.flatMap((c)=>c.members.map((m)=>toCluster.find((r)=>r.id === m.id)?.url ?? null).filter(Boolean));
  const urlToNewsItemId = new Map();
  if (clusterUrls.length > 0) {
    const URL_CHUNK = 100;
    for(let i = 0; i < clusterUrls.length; i += URL_CHUNK){
      const { data: niRows, error: niErr } = await sb.from("news_items").select("id, url").in("url", clusterUrls.slice(i, i + URL_CHUNK));
      if (niErr) {
        log("warn", "⚠️ news_items lookup chunk failed", {
          error: niErr.message,
          atIndex: i
        });
        continue;
      }
      for (const row of niRows ?? []){
        if (row.url && row.id) urlToNewsItemId.set(row.url, row.id);
      }
    }
  }
  log("info", "✅ news_items URL map built", {
    mapped: urlToNewsItemId.size,
    totalUrls: clusterUrls.length
  });
  // ── 13c: Cross-run cluster merge ──────────────────────────────────────────
  log("info", "📋 STEP 13c: Cross-run cluster merge check", {
    mergeThreshold: MERGE_THRESHOLD
  });
  const newClusterIds = valid.map((c)=>c.id).filter((id)=>id !== "__overflow__");
  const { data: existingClusters, error: ecErr } = await sb.from("topic_clusters").select("id, centroid_vec, title").gte("created_at", sinceIso).not("centroid_vec", "is", null).not("id", "in", `(${newClusterIds.join(",")})`).limit(200);
  if (ecErr) {
    log("warn", "⚠️ existing cluster fetch failed — skipping merge check", {
      error: ecErr.message
    });
  }
  const existingClusterMetas = (existingClusters ?? []).map((ec)=>({
      id: ec.id,
      centroid: parseEmbedding(ec.centroid_vec),
      title: ec.title ?? null
    })).filter((ec)=>ec.centroid !== null);
  const newClusterMergeMap = new Map();
  for (const c of valid){
    if (c.id === "__overflow__") continue;
    if (!c.centroid.length) continue;
    let bestExisting = null;
    let bestSim = -1;
    for (const ec of existingClusterMetas){
      if (!ec.centroid) continue;
      const sim = cosine(c.centroid, ec.centroid);
      if (sim > bestSim) {
        bestSim = sim;
        bestExisting = ec.id;
      }
    }
    if (bestExisting && bestSim >= MERGE_THRESHOLD) {
      newClusterMergeMap.set(c.id, bestExisting);
      log("info", "🔀 New cluster merges into existing", {
        newClusterId: c.id,
        existingClusterId: bestExisting,
        similarity: Number(bestSim.toFixed(4)),
        newTitle: c.members.find((m)=>m.title)?.title?.slice(0, 60) ?? "(no title)"
      });
    }
  }
  log("info", "✅ Cross-run merge check complete", {
    newClusters: valid.length,
    mergedIntoExisting: newClusterMergeMap.size,
    willCreateNew: valid.length - newClusterMergeMap.size
  });
  // 13c-ii: For merged clusters, add their items to the existing cluster
  for (const [newCId, existingCId] of newClusterMergeMap.entries()){
    const c = valid.find((x)=>x.id === newCId);
    if (!c) continue;
    const mergeItemRows = c.members.map((m, idx)=>{
      const v = c.memberVecs[idx];
      const simToCentroid = v ? cosine(v, c.centroid) : m.similarity ?? 0;
      return {
        cluster_id: existingCId,
        ingestion_id: m.id,
        similarity: Number(simToCentroid.toFixed(6))
      };
    });
    for(let i = 0; i < mergeItemRows.length; i += ITEMS_CHUNK){
      const chunk = mergeItemRows.slice(i, i + ITEMS_CHUNK);
      const { error: mErr } = await sb.from("topic_cluster_items").upsert(chunk, {
        onConflict: "cluster_id,ingestion_id",
        ignoreDuplicates: true
      });
      if (mErr) log("warn", "⚠️ merge cluster items upsert failed", {
        newCId,
        existingCId,
        error: mErr.message
      });
    }
    const newCentroid = meanVector(c.memberVecs);
    if (newCentroid.length) {
      const { error: centErr } = await sb.from("topic_clusters").update({
        centroid: newCentroid,
        centroid_vec: toVectorLiteral(newCentroid),
        updated_at: new Date().toISOString()
      }).eq("id", existingCId);
      if (centErr) log("warn", "⚠️ merge centroid update failed", {
        existingCId,
        error: centErr.message
      });
    }
    log("info", "✅ Merged items into existing cluster", {
      existingCId,
      itemCount: mergeItemRows.length
    });
  }
  // ── 13d: REMOVED (A1) — dead dedup pool ───────────────────────────────────
  // Previously built draftedClusterIds + recentDraftCentroidsForDedup by fetching
  // and parsing up to ~200 existing centroid_vec strings per run, solely to feed
  // STEP 13e (disabled). Draft creation + civic-tension dedup are owned by
  // create-topic-drafts, so nothing downstream consumed this pool. The centroid
  // parse wave was a primary CPU-time sink; removing it is behavior-neutral.
  // `draftsToCreate` is retained because the 13e log line references its length.
  const draftsToCreate = valid.filter((c)=>c.id !== "__overflow__" && !newClusterMergeMap.has(c.id));
  // ── 13e: Draft creation DISABLED ─────────────────────────────────────────────
  // Topic draft creation is owned exclusively by create-topic-drafts (v4+).
  // Steps 13a / 13c / 13d still run above — only the topic_draft INSERT is deferred.
  log("info", "✅ Draft creation complete (deferred to create-topic-drafts v4)", {
    draftsCreated: 0,
    mergedIntoExisting: newClusterMergeMap.size,
    skipped: draftsToCreate.length,
    note: "Draft creation owned by create-topic-drafts — run step 4 to generate drafts"
  });
  log("info", "🎉 CLUSTERING COMPLETE", {
    mode: CLUSTER_MODE,
    entityCoverage: `${itemsWithEntities}/${parsed.length}`,
    eventClusters: eventClustersCount,
    storyClusters: storyClustersCount,
    persistedClusters: valid.length,
    itemsCreated: createdItems,
    draftsCreated,
    skipped,
    failed
  });
  return {
    clusters: valid.length,
    items: createdItems,
    updated: 0,
    draftsCreated,
    skipped,
    failed,
    errors: errors.length ? errors : undefined,
    eventClusters: eventClustersCount,
    storyClusters: storyClustersCount,
    mode: CLUSTER_MODE
  };
}
