// src/routes/admin/drafts/Index.tsx
//
// Admin: Topic Drafts page
//
// Displays topic_drafts rows with status filtering, search, date range filters,
// bulk selection, and the full pipeline UI.
//
// Pipeline (Row 3 header):
//   1. Run Embedding        → invoke edge function "embed"
//   2. Extract Entities     → invoke edge function "extract-entities"
//   3. Run Cluster          → RPC run_cluster_http → edge function "cluster"
//                             NOTE: cluster/logic.ts Step 13 also creates topic_drafts
//                             directly, so step 4 below is a fallback only.
//   4. Create Topic Drafts  → RPC run_create_drafts_http → edge function "create-topic-drafts"
//                             (fallback/recovery only — cluster already creates drafts in normal flow)
//   5. Classify Parents     → invoke edge function "classify-parent-topics"
//                             Assigns each topic_draft to an approved parent theme topic,
//                             or proposes a new pending theme if no match found (confidence < 0.75).
//                             Pending themes require admin approval before becoming classification targets.
//
// Bulk actions (Row 2 selection bar):
//   - Bulk Approve          → updates topic_drafts.status = 'approved'
//   - Bulk Create Question Drafts → invokes edge function "admin-create-question-draft"
//                                   per selected topic_draft (skips existing question_drafts)
//
// Key state:
//   topicDraftHasQDraft     → Set<string> of topic_draft_ids that already have a question_draft row
//                             Used to show "Question Draft ✅" badge and disable single-create button
//
// Patches:
//   v2: Added "5. Classify Parents" pipeline button + runClassifyParents handler
//   v2: Fixed duplicate React key warning on tag badges (key={t} → key={`${t}-${i}`})

import * as React from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ExternalLink, Edit2, RefreshCw, Loader2, Cpu, Info, Image as ImageIcon } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { SUPABASE_URL, SUPABASE_ANON_KEY, getJwt } from "@/lib/env";

type DraftStatus = "draft" | "approved" | "rejected";

type TopicDraftRow = {
  id: string;
  news_item_id: string;
  title: string;
  summary: string | null;
  tags: string[] | null;
  location_label: string | null;
  status: DraftStatus;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  news_items?: {
    id: string;
    title: string;
    url: string | null;
    published_at: string | null;
  } | null;
};

const STATUS_FILTERS: { value: "all" | DraftStatus; label: string }[] = [
  { value: "all", label: "Any" },
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return (await Promise.race([
    p,
    (async () => {
      await sleep(ms);
      throw new Error(`${label} timeout after ${ms}ms`);
    })(),
  ])) as T;
}

export default function TopicDraftsPage() {
  // ✅ IMPORTANT: Memoize the client so this page doesn't create multiple instances across re-renders.
  // This is a frequent cause of “works after refresh” + GoTrue warnings.
  const supabase = React.useMemo(() => getSupabase()!, []);
  const { toast } = useToast();

  const [rows, setRows] = React.useState<TopicDraftRow[]>([]);
  const [loading, setLoading] = React.useState(false);

  // NEW: which topic_drafts already have a question_drafts row
  const [topicDraftHasQDraft, setTopicDraftHasQDraft] = React.useState<Set<string>>(new Set());

  // Pipeline button states with elapsed time
  const [embedLoading, setEmbedLoading] = React.useState(false);
  const [embedElapsed, setEmbedElapsed] = React.useState(0);
  const [embedProgress, setEmbedProgress] = React.useState("");
  const [embedTotal, setEmbedTotal] = React.useState<number | null>(null);
  const [embedDone, setEmbedDone] = React.useState<number | null>(null);

  const [entityLoading, setEntityLoading] = React.useState(false);
  const [entityElapsed, setEntityElapsed] = React.useState(0);
  const [entityProgress, setEntityProgress] = React.useState("");
  const [entityTotal, setEntityTotal] = React.useState<number | null>(null);
  const [entityDone, setEntityDone] = React.useState<number | null>(null);

  const [clusterLoading, setClusterLoading] = React.useState(false);
  const [clusterElapsed, setClusterElapsed] = React.useState(0);
  const [clusterProgress, setClusterProgress] = React.useState("");
  const [clusterEligible, setClusterEligible] = React.useState<number | null>(null);
  const [clusterClustered, setClusterClustered] = React.useState<number | null>(null);
  const [clusterResult, setClusterResult] = React.useState<string | null>(null);

  // Mirror Images to Storage — copies each article's cover photo into our
  // own Storage (via enrich-images) so cover_image_url stops depending on
  // the live publisher URL. Must run after Cluster (news_items rows don't
  // exist before that) and before Bulk Create Question Drafts (that's where
  // cover_image_url gets frozen via COALESCE — a cover assigned before this
  // runs stays on the live URL forever, no automatic re-sync later).
  const [mirrorLoading, setMirrorLoading] = React.useState(false);
  const [mirrorElapsed, setMirrorElapsed] = React.useState(0);
  const [mirrorProgress, setMirrorProgress] = React.useState("");
  const [mirrorResult, setMirrorResult] = React.useState<string | null>(null);

  const [createDraftsLoading, setCreateDraftsLoading] = React.useState(false);
  const [createDraftsElapsed, setCreateDraftsElapsed] = React.useState(0);
  const [createDraftsProgress, setCreateDraftsProgress] = React.useState("");

  const [classifyParentsLoading, setClassifyParentsLoading] = React.useState(false);
  const [classifyParentsProgress, setClassifyParentsProgress] = React.useState("");

  const [statusFilter, setStatusFilter] = React.useState<"all" | DraftStatus>("all");
  const [search, setSearch] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");

  // Bulk selection (for currently loaded/visible rows)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  const selectedCount = selectedIds.size;

  const allVisibleSelected = React.useMemo(() => {
    if (rows.length === 0) return false;
    return rows.every((r) => selectedIds.has(r.id));
  }, [rows, selectedIds]);

  // (Optional) used for indeterminate checkbox UI if you want it later.
  const someVisibleSelected = React.useMemo(() => {
    if (rows.length === 0) return false;
    return rows.some((r) => selectedIds.has(r.id)) && !allVisibleSelected;
  }, [rows, selectedIds, allVisibleSelected]);

  const toggleSelectAllVisible = React.useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (rows.length === 0) return next;

      const shouldSelectAll = !rows.every((r) => next.has(r.id));
      rows.forEach((r) => {
        if (shouldSelectAll) next.add(r.id);
        else next.delete(r.id);
      });

      return next;
    });
  }, [rows]);

  const toggleRowSelected = React.useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = React.useCallback(() => setSelectedIds(new Set()), []);


  // Keep interval ids so we can always cleanup (prevents stuck UI)
  const embedIntervalRef = React.useRef<number | null>(null);
  const entityIntervalRef = React.useRef<number | null>(null);
  const clusterIntervalRef = React.useRef<number | null>(null);
  const draftsIntervalRef = React.useRef<number | null>(null);

  const clearEmbedInterval = React.useCallback(() => {
    if (embedIntervalRef.current != null) {
      window.clearInterval(embedIntervalRef.current);
      embedIntervalRef.current = null;
    }
  }, []);

  const clearEntityInterval = React.useCallback(() => {
    if (entityIntervalRef.current != null) {
      window.clearInterval(entityIntervalRef.current);
      entityIntervalRef.current = null;
    }
  }, []);

  const clearClusterInterval = React.useCallback(() => {
    if (clusterIntervalRef.current != null) {
      window.clearInterval(clusterIntervalRef.current);
      clusterIntervalRef.current = null;
    }
  }, []);

  const clearDraftsInterval = React.useCallback(() => {
    if (draftsIntervalRef.current != null) {
      window.clearInterval(draftsIntervalRef.current);
      draftsIntervalRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    // ✅ Auth/session hydration (helps “works only after refresh”)
    supabase.auth.getSession().catch(() => {});
  }, [supabase]);

  React.useEffect(() => {
    // Cleanup timers on unmount (prevents ghost stuck states)
    return () => {
      clearEmbedInterval();
      clearEntityInterval();
      clearClusterInterval();
      clearDraftsInterval();
    };
  }, [clearEmbedInterval, clearEntityInterval, clearClusterInterval, clearDraftsInterval]);

  const load = React.useCallback(async () => {
    setLoading(true);

    let q = supabase
      .from("topic_drafts")
      .select(
        `
        id,
        news_item_id,
        title,
        summary,
        tags,
        location_label,
        status,
        created_at,
        updated_at,
        approved_at,
        rejected_at,
        news_items (
          id,
          title,
          url,
          published_at
        )
      `,
      )
      .order("created_at", { ascending: false })
      // NEW: stable secondary ordering to avoid same-timestamp weirdness in UI ordering
      .order("id", { ascending: false })
      .limit(200);

    if (statusFilter !== "all") q = q.eq("status", statusFilter);
    if (dateFrom) q = q.gte("created_at", dateFrom);
    if (dateTo) q = q.lte("created_at", dateTo);

    const { data, error } = await q;
    if (error) {
      console.error("Failed to load topic_drafts:", error);
      toast({
        title: "Failed to load topic drafts",
        description: error.message,
        variant: "destructive",
      });
      setRows([]);
      setTopicDraftHasQDraft(new Set());
      setLoading(false);
      return;
    }

    let items = (data ?? []) as TopicDraftRow[];
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      items = items.filter((r) => (r.title ?? "").toLowerCase().includes(needle));
    }

    // NEW: Build a set of topic_draft_id -> has question_draft
    try {
      const ids = items.map((r) => r.id);
      if (ids.length) {
        const { data: qds, error: qErr } = await supabase
          .from("question_drafts")
          .select("topic_draft_id")
          .in("topic_draft_id", ids)
	  .neq("status", "rejected");   // rejected drafts no longer block re-creation;

        if (qErr) {
          console.warn("Failed to load question_drafts mapping:", qErr);
          setTopicDraftHasQDraft(new Set());
        } else {
          setTopicDraftHasQDraft(new Set((qds ?? []).map((x: any) => x.topic_draft_id)));
        }
      } else {
        setTopicDraftHasQDraft(new Set());
      }
    } catch (e) {
      console.warn("question_drafts mapping exception:", e);
      setTopicDraftHasQDraft(new Set());
    }

    setRows(items);
    // Keep selection only for ids that are still visible after refresh/filter changes
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(items.map((r) => r.id));
      const next = new Set<string>();
      prev.forEach((id) => {
        if (visible.has(id)) next.add(id);
      });
      return next;
    });
    setLoading(false);
  }, [supabase, statusFilter, search, dateFrom, dateTo, toast]);

  React.useEffect(() => {
    load();
  }, [load]);

  // Embed progress polling — counts rows in ingestion_queue that now have embeddings
  // Fetch both sides of the embedding count in one round-trip pair
  // Returns { eligible: rows still needing embedding, done: rows already embedded since start }
  const pollEmbedProgress = React.useCallback(async () => {
    const [needRes, doneRes] = await Promise.all([
      supabase
        .from("ingestion_queue")
        .select("*", { count: "exact", head: true })
        .is("embedding", null),
      supabase
        .from("ingestion_queue")
        .select("*", { count: "exact", head: true })
        .not("embedding", "is", null),
    ]);
    if (needRes.error) throw needRes.error;
    if (doneRes.error) throw doneRes.error;
    return {
      needEmbedding: needRes.count ?? 0,
      haveEmbedding: doneRes.count ?? 0,
    };
  }, [supabase]);

  // Entity extraction progress polling — counts rows still missing entities
  const pollEntityProgress = React.useCallback(async () => {
    const [needRes, doneRes] = await Promise.all([
      supabase
        .from("ingestion_queue")
        .select("*", { count: "exact", head: true })
        .not("embedding", "is", null)
        .eq("embed_status", "done")
        .is("entities", null),
      supabase
        .from("ingestion_queue")
        .select("*", { count: "exact", head: true })
        .not("embedding", "is", null)
        .eq("embed_status", "done")
        .not("entities", "is", null),
    ]);
    if (needRes.error) throw needRes.error;
    if (doneRes.error) throw doneRes.error;
    return {
      needEntities: needRes.count ?? 0,
      haveEntities: doneRes.count ?? 0,
    };
  }, [supabase]);

  const runExtractEntities = React.useCallback(async () => {
    if (entityLoading) return;

    clearEntityInterval();

    setEntityLoading(true);
    setEntityElapsed(0);
    setEntityProgress("Counting...");
    setEntityTotal(null);
    setEntityDone(null);

    const startTime = Date.now();
    let baselineHave: number | null = null;
    let totalNeed: number | null = null;
    // Plateau detection state
    let lastExtractedCount = 0;
    let entityPlateauTicks = 0;

    entityIntervalRef.current = window.setInterval(async () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setEntityElapsed(elapsed);

      if (elapsed > 90) {
        clearEntityInterval();
        setEntityLoading(false);
        toast({
          title: "Entity extraction timeout",
          description: "Stopped polling after 90s. Check Edge Function logs.",
          variant: "destructive",
        });
        return;
      }

      try {
        const { needEntities, haveEntities } = await pollEntityProgress();

        if (baselineHave === null) {
          baselineHave = haveEntities;
          totalNeed = needEntities;
          setEntityTotal(totalNeed);
          setEntityDone(0);
          setEntityProgress(
            totalNeed === 0 ? "Nothing to extract" : `0 / ${totalNeed} extracted`
          );
          if (totalNeed === 0) {
            clearEntityInterval();
            setEntityLoading(false);
            toast({ title: "Nothing to extract", description: "All articles already have entities." });
          }
          return;
        }

        const newlyExtracted = haveEntities - baselineHave;
        const remaining = Math.max(0, (totalNeed ?? 0) - newlyExtracted);
        setEntityDone(newlyExtracted);
        setEntityProgress(`${newlyExtracted} / ${totalNeed ?? "?"} extracted — ${remaining} remaining`);

        // Fast-path: all eligible items extracted in one run
        if (remaining === 0 && newlyExtracted > 0) {
          clearEntityInterval();
          setEntityLoading(false);
          toast({
            title: "Entity extraction complete ✅",
            description: `${newlyExtracted} articles extracted in ${elapsed}s. Run Cluster next.`,
          });
          return;
        }

        // Plateau detection: batch limit hit — unlock when progress stops for ~6s
        if (newlyExtracted === lastExtractedCount && newlyExtracted > 0) {
          entityPlateauTicks++;
        } else {
          entityPlateauTicks = 0;
          lastExtractedCount = newlyExtracted;
        }

        if (entityPlateauTicks >= 3) {
          clearEntityInterval();
          setEntityLoading(false);
          toast({
            title: "Entity extraction complete ✅",
            description: `${newlyExtracted} articles extracted in ${elapsed}s. Run again for remaining or proceed to Cluster.`,
          });
        }
      } catch (err) {
        console.warn("pollEntityProgress failed:", err);
      }
    }, 2000);

    try {
      const { error } = await supabase.functions.invoke("extract-entities", { method: "POST" });
      if (error) throw error;
    } catch (e: any) {
      console.error("extract-entities error:", e);
      toast({
        title: "Entity extraction trigger issue",
        description: e?.message ?? "Failed to invoke extract-entities function.",
        variant: "destructive",
      });
      setTimeout(() => { clearEntityInterval(); setEntityLoading(false); }, 8000);
    }
  }, [entityLoading, supabase, toast, pollEntityProgress, clearEntityInterval]);

  const runEmbed = React.useCallback(async () => {
    if (embedLoading) return;

    clearEmbedInterval();

    setEmbedLoading(true);
    setEmbedElapsed(0);
    setEmbedProgress("Counting articles...");
    setEmbedTotal(null);
    setEmbedDone(null);

    const startTime = Date.now();
    // Snapshot taken on first poll so we know the baseline
    let baselineHave: number | null = null;
    let totalEligible: number | null = null;

    // Start polling immediately — timer ticks every 2s
    embedIntervalRef.current = window.setInterval(async () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setEmbedElapsed(elapsed);

      if (elapsed > 90) {
        clearEmbedInterval();
        setEmbedLoading(false);
        toast({
          title: "Embedding timeout",
          description: "Stopped polling after 90s. Check Edge Function logs — the job may still be running.",
          variant: "destructive",
        });
        return;
      }

      try {
        const { needEmbedding, haveEmbedding } = await pollEmbedProgress();

        if (baselineHave === null) {
          // First poll: establish baseline and total eligible
          baselineHave = haveEmbedding;
          totalEligible = needEmbedding;   // how many need embedding right now
          setEmbedTotal(totalEligible);
          setEmbedDone(0);
          setEmbedProgress(totalEligible === 0
            ? "Nothing to embed"
            : `0 / ${totalEligible} embedded`
          );

          if (totalEligible === 0) {
            clearEmbedInterval();
            setEmbedLoading(false);
            toast({ title: "Nothing to embed", description: "All articles in the window already have embeddings." });
            return;
          }
          return; // wait for next tick before declaring progress
        }

        // Subsequent polls: measure how many new rows got embeddings
        const newlyEmbedded = haveEmbedding - baselineHave;
        const remaining = Math.max(0, (totalEligible ?? 0) - newlyEmbedded);
        setEmbedDone(newlyEmbedded);
        setEmbedProgress(`${newlyEmbedded} / ${totalEligible ?? "?"} embedded — ${remaining} remaining`);

        if (remaining === 0 && newlyEmbedded > 0) {
          clearEmbedInterval();
          setEmbedLoading(false);
          toast({
            title: "Embedding complete ✅",
            description: `All ${newlyEmbedded} articles embedded in ${elapsed}s. Run Cluster next.`,
          });
        }
      } catch (err) {
        console.warn("pollEmbedProgress failed:", err);
        // Don't stop polling on a single network blip
      }
    }, 2000);

    try {
      // Invoke the embed edge function directly (no RPC wrapper needed).
      // If CRON_SECRET is configured on the function, remove it from the
      // embed function's secrets for admin-triggered calls, or wrap it in
      // an RPC like run_cluster_http that injects the secret server-side.
      const { error } = await supabase.functions.invoke("embed", { method: "POST" });
      if (error) throw error;
    } catch (e: any) {
      console.error("embed edge function error:", e);
      toast({
        title: "Embed trigger issue",
        description: e?.message ?? "Failed to invoke embed function. It may still be running server-side.",
        variant: "destructive",
      });
      // Keep polling a bit longer in case the function ran anyway
      setTimeout(() => { clearEmbedInterval(); setEmbedLoading(false); }, 8000);
    }
  }, [embedLoading, supabase, toast, pollEmbedProgress, clearEmbedInterval]);

  // Cluster progress polling — uses topic_cluster_items as source of truth.
  //   eligible  = ingestion_queue items with embeddings (total candidates)
  //   clustered = topic_cluster_items rows (actual items assigned to a cluster)
  //   clusters  = total topic_clusters rows
  //
  // NOTE: ingestion_queue.finished_at is NOT set by the cluster function,
  // so it cannot be used to track clustering progress. topic_cluster_items
  // is the correct source of truth — one row per article assigned to a cluster.
  const pollClusterProgress = React.useCallback(async () => {
    const [eligibleRes, clusteredRes, clusterCountRes] = await Promise.all([
      supabase
        .from("ingestion_queue")
        .select("*", { count: "exact", head: true })
        .not("embedding", "is", null)
        .eq("embed_status", "done"),
      supabase
        .from("topic_cluster_items")
        .select("*", { count: "exact", head: true }),
      supabase
        .from("topic_clusters")
        .select("*", { count: "exact", head: true }),
    ]);

    if (eligibleRes.error)     throw eligibleRes.error;
    if (clusteredRes.error)    throw clusteredRes.error;
    if (clusterCountRes.error) throw clusterCountRes.error;

    return {
      eligible:  eligibleRes.count  ?? 0,
      clustered: clusteredRes.count ?? 0,
      clusters:  clusterCountRes.count ?? 0,
    };
  }, [supabase]);

  // ✅ Run cluster with real-time polling — mirrors embed progress pattern:
  //   First poll snapshots baseline, subsequent polls show delta progress
  //   "X / Y clustered — Z remaining, N clusters" updating every 2s
  const runCluster = React.useCallback(async () => {
    if (clusterLoading) return;

    clearClusterInterval();

    setClusterLoading(true);
    setClusterElapsed(0);
    setClusterProgress("Counting...");
    setClusterEligible(null);
    setClusterClustered(null);
    setClusterResult(null);

    toast({
      title: "Clustering started",
      description: "Monitoring progress in real-time...",
    });

    const startTime = Date.now();
    let baselineClustered: number | null = null;
    let baselineClusters: number | null = null;
    let totalEligible: number | null = null;
    // Plateau detection state
    let lastClusteredCount = 0;
    let settleTicks = 0;

    // Start polling IMMEDIATELY — same pattern as embed
    clusterIntervalRef.current = window.setInterval(async () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setClusterElapsed(elapsed);

      if (elapsed > 120) {
        clearClusterInterval();
        setClusterLoading(false);
        setClusterResult("Last run: polling timed out after 120s — check Edge Function logs; the job may still have finished.");
        toast({
          title: "Clustering timeout",
          description: "Stopped polling after 120s. Check Edge Function logs — the job may still be running.",
          variant: "destructive",
        });
        return;
      }

      try {
        const current = await pollClusterProgress();

        if (baselineClustered === null) {
          // First poll: snapshot baseline
          baselineClustered = current.clustered;
          baselineClusters  = current.clusters;
          totalEligible     = current.eligible;
          setClusterEligible(totalEligible);
          setClusterClustered(0);
          const alreadyClustered = current.clustered;
          const unclustered = Math.max(0, (totalEligible ?? 0) - alreadyClustered);
          setClusterProgress(
            totalEligible === 0
              ? "Nothing eligible"
              : unclustered === 0
              ? `All ${alreadyClustered} articles already clustered`
              : `0 / ${unclustered} unclustered articles to process`
          );

          if (totalEligible === 0) {
            clearClusterInterval();
            setClusterLoading(false);
            setClusterResult("Last run: nothing eligible to cluster.");
            toast({
              title: "Nothing to cluster",
              description: "No embedded articles found.",
            });
          } else if (unclustered === 0) {
            clearClusterInterval();
            setClusterLoading(false);
            setClusterResult(`Last run: all ${alreadyClustered} articles already clustered.`);
            toast({
              title: "Already clustered ✅",
              description: `All ${alreadyClustered} articles are already assigned to clusters. Proceed to step 4.`,
            });
          }
          return; // wait for next tick before tracking progress
        }

        // Subsequent polls: delta from baseline
        // current.clustered = total topic_cluster_items (absolute, not delta)
        // newlyClustered    = items added to clusters THIS run
        const newlyClustered = current.clustered - baselineClustered;
        const newClusters    = current.clusters  - (baselineClusters ?? 0);
        // remaining = items that have embeddings but are not yet in any cluster
        const totalClustered = current.clustered;
        const remaining      = Math.max(0, (totalEligible ?? 0) - totalClustered);

        setClusterClustered(newlyClustered);
        setClusterProgress(
          remaining === 0
            ? `All ${totalClustered} articles clustered — ${newClusters} new clusters`
            : `${newlyClustered} newly clustered — ${remaining} remaining, ${newClusters} clusters`
        );

        // Fast-path: all eligible items clustered in one run
        if (remaining === 0) {
          clearClusterInterval();
          setClusterLoading(false);
          setClusterResult(`Last run: ${newClusters} clusters from ${newlyClustered} articles — all eligible articles clustered.`);
          toast({
            title: "Clustering complete! ✅",
            description: `${newClusters} clusters from ${newlyClustered} articles in ${elapsed}s`,
          });
          return;
        }

        // Settle detection: the cluster job runs once (1–4s) and commits its results
        // in a single step, so once the clustered count stops changing the run is done.
        // We track stability REGARDLESS of whether new clusters formed — a run that
        // produces 0 new clusters (all remaining articles are singletons with no
        // same-event match) is a valid completion, not a hang. The `elapsed >= 8` gate
        // ensures the async pg_net trigger has actually run before we conclude 0.
        if (newlyClustered === lastClusteredCount) {
          settleTicks++;
        } else {
          settleTicks = 0;
          lastClusteredCount = newlyClustered;
        }

        if (settleTicks >= 3 && elapsed >= 8) {
          clearClusterInterval();
          setClusterLoading(false);
          if (newClusters > 0) {
            setClusterResult(
              `Last run: ${newClusters} new clusters from ${newlyClustered} articles — ${remaining} articles remain (no same-event match yet).`
            );
            toast({
              title: "Clustering complete! ✅",
              description: `${newClusters} new clusters from ${newlyClustered} articles in ${elapsed}s. ${remaining} articles remain unclustered.`,
            });
          } else {
            // Run finished but produced 0 new clusters: the remaining articles are
            // singletons with no same-event match in the current window.
            setClusterProgress(`No new clusters — ${remaining} singletons remain`);
            setClusterResult(
              `Last run: no new clusters. The ${remaining} remaining articles have no same-event match, so no more clusters can be formed from them right now. They stay eligible for 72h in case another outlet covers the same story.`
            );
            toast({
              title: "Run complete — no new clusters",
              description: `No more clusters can be formed with the ${remaining} remaining articles: they have no same-event match in the current window. They stay eligible for 72h in case matching coverage arrives.`,
            });
          }
        }
      } catch (err) {
        console.warn("pollClusterProgress failed:", err);
        // Don’t stop polling on a single network blip
      }
    }, 2000);

    try {
      // Try RPC first. Falls back to direct edge call if pg_net is not enabled.
      let rpcFailed = false;
      try {
        const rpcPromise = supabase.rpc("run_cluster_http");
        await withTimeout(rpcPromise as any, 30_000, "run_cluster_http");
      } catch (rpcErr: any) {
        console.warn("run_cluster_http RPC failed, trying direct edge call:", rpcErr?.message);
        rpcFailed = true;
      }

      if (rpcFailed) {
        const jwt = getJwt();
        const edgeResp = await fetch(`${SUPABASE_URL}/functions/v1/cluster`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${jwt}`,
            "apikey": SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({}),
        });
        if (!edgeResp.ok) {
          const errText = await edgeResp.text().catch(() => edgeResp.status.toString());
          throw new Error(`Cluster edge function failed: ${errText}`);
        }
      }
    } catch (e: any) {
      console.error("run_cluster_http error/timeout:", e);

      toast({
        title: "Cluster trigger issue",
        description:
          e?.message ??
          "Failed to trigger cluster job. The job may still run if it was triggered server-side.",
        variant: "destructive",
      });

      // Let polling continue briefly, but ensure UI doesn’t hang forever
      setTimeout(() => {
        clearClusterInterval();
        setClusterLoading(false);
      }, 8000);
    }
  }, [clusterLoading, supabase, toast, pollClusterProgress, clearClusterInterval]);

  // enrich-images responds synchronously with real counts (unlike
  // cluster/embed/extract-entities, which trigger async pg_net jobs and
  // need DB polling) — so this loops direct awaited calls instead of
  // polling. MIRROR_BACKFILL_BATCH_SIZE server-side is 30 rows/invocation;
  // a round that comes back with fewer than 30 processed means the backlog
  // is drained, so the loop stops itself rather than needing a fixed count.
  //
  // Calls run_enrich_images_http() (an RPC), NOT enrich-images directly.
  // enrich-images has zero CORS handling AND requires an x-cron-secret
  // header matching a server-side-only secret — calling it straight from
  // the browser fails on both counts, confirmed against the real deploy
  // (CORS preflight blocked, and even past that it would 401). The RPC
  // reads that secret from Vault server-side and makes the call from
  // Postgres instead — same pattern run_cluster_http() already uses for
  // the Cluster button, adapted to return the real response body
  // synchronously since this loop needs the actual counts back each round.
  const MIRROR_BATCH_SIZE = 30;
  const MIRROR_MAX_ROUNDS = 25; // safety cap (~750 rows) so a stuck backlog can't loop forever

  const runMirrorImages = React.useCallback(async () => {
    if (mirrorLoading) return;

    setMirrorLoading(true);
    setMirrorElapsed(0);
    setMirrorProgress("Starting...");
    setMirrorResult(null);

    const startTime = Date.now();
    let totalMirrored = 0;
    let totalFailed = 0;
    let rounds = 0;

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        rounds++;
        setMirrorElapsed(Math.floor((Date.now() - startTime) / 1000));
        setMirrorProgress(`Round ${rounds}... ${totalMirrored} mirrored so far`);

        const { data, error } = await supabase.rpc("run_enrich_images_http");
        if (error) throw error;

        const roundMirrored = (data as any)?.backfill_mirrored ?? 0;
        const roundFailed = (data as any)?.backfill_failed ?? 0;
        totalMirrored += roundMirrored;
        totalFailed += roundFailed;

        const processedThisRound = roundMirrored + roundFailed;
        if (processedThisRound < MIRROR_BATCH_SIZE) break; // backlog drained
        if (rounds >= MIRROR_MAX_ROUNDS) break; // safety cap hit
      }

      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setMirrorElapsed(elapsed);
      setMirrorProgress("");
      setMirrorResult(
        `Last run: ${totalMirrored} mirrored, ${totalFailed} failed/no-image, across ${rounds} round${rounds === 1 ? "" : "s"} (${elapsed}s).` +
          (rounds >= MIRROR_MAX_ROUNDS
            ? " Hit the safety cap — click again if a backlog still remains."
            : "")
      );
      toast({
        title: totalMirrored > 0 ? "Mirroring complete ✅" : "Nothing to mirror",
        description: `${totalMirrored} images copied to Storage, ${totalFailed} failed or had no image, in ${rounds} round${rounds === 1 ? "" : "s"}.`,
      });
    } catch (e: any) {
      console.error("enrich-images error:", e);
      setMirrorProgress("");
      setMirrorResult(`Last run: failed after ${rounds} round(s) — ${e?.message ?? "unknown error"}.`);
      toast({
        title: "Mirroring trigger issue",
        description: e?.message ?? "Failed to invoke enrich-images function.",
        variant: "destructive",
      });
    } finally {
      setMirrorLoading(false);
    }
  }, [mirrorLoading, supabase, toast]);

  // Create drafts progress polling
  const pollCreateDraftsProgress = React.useCallback(async () => {
    const { count, error } = await supabase
      .from("topic_drafts")
      .select("*", { count: "exact", head: true });

    if (error) throw error;
    return count || 0;
  }, [supabase]);

  const runCreateDrafts = React.useCallback(async () => {
    if (createDraftsLoading) return;

    clearDraftsInterval();

    setCreateDraftsLoading(true);
    setCreateDraftsElapsed(0);
    setCreateDraftsProgress("Starting...");

    // Force auth hydration (helps “works only after refresh”)
    supabase.auth.getSession().catch(() => {});

    toast({
      title: "Create drafts started",
      description: "Monitoring progress in real-time...",
    });

    const startTime = Date.now();
    let initialDrafts: number | null = null;

    // NEW: track whether RPC finished
    let rpcFinished = false;
    let rpcFailed: string | null = null;

    // Start polling immediately
    draftsIntervalRef.current = window.setInterval(async () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setCreateDraftsElapsed(elapsed);

      // IMPORTANT: timeout must run even if polling fails
      const hardTimeoutSec = 60; // slightly higher than 45 so we can handle slow DB/cache
      if (elapsed > hardTimeoutSec) {
        clearDraftsInterval();
        setCreateDraftsLoading(false);

        toast({
          title: "Create drafts timed out",
          description:
            "No visible progress after 60s. The job may still be running. Try Refresh or check logs.",
          variant: "destructive",
        });
        return;
      }

      try {
        const currentDrafts = await pollCreateDraftsProgress();

        if (initialDrafts == null) {
          initialDrafts = currentDrafts;
        }

        const newDrafts = currentDrafts - initialDrafts;
        setCreateDraftsProgress(`${newDrafts} drafts created`);

        // Success path
        if (newDrafts > 0) {
          clearDraftsInterval();
          setCreateDraftsLoading(false);

          toast({
            title: "Drafts created ✅",
            description: `Created ${newDrafts} topic drafts in ${elapsed}s`,
          });

          await load();
          return;
        }

        // NEW: if RPC already finished and we still have 0 after a few seconds, stop
        if (rpcFinished && elapsed >= 6 && newDrafts === 0) {
          clearDraftsInterval();
          setCreateDraftsLoading(false);

          toast({
            title: "No drafts created",
            description: rpcFailed
              ? `Trigger error: ${rpcFailed}`
              : "No eligible clusters found (most recent clusters already have drafts). Run Cluster again after ingesting new items, or expand backend search window.",
            variant: rpcFailed ? "destructive" : "default",
          });

          return;
        }
      } catch (err) {
        // Keep polling; but we no longer skip timeout because timeout is above
        console.warn("pollCreateDraftsProgress failed:", err);
        setCreateDraftsProgress("Polling failed… retrying");
      }
    }, 2000);

    try {
      // Trigger RPC but don’t block UI updates
      const rpcPromise = supabase.rpc("run_create_drafts_http");

      // client timeout so the awaited call can't hang forever
      await withTimeout(rpcPromise as any, 60000, "run_create_drafts_http");

      rpcFinished = true;
    } catch (e: any) {
      console.error("run_create_drafts_http error/timeout:", e);
      rpcFinished = true;
      rpcFailed = e?.message ?? String(e);

      toast({
        title: "Create drafts trigger issue",
        description:
          rpcFailed ??
          "Failed to trigger create drafts job. The job may still run if it was triggered server-side.",
        variant: "destructive",
      });
    }
  }, [
    createDraftsLoading,
    supabase,
    toast,
    pollCreateDraftsProgress,
    load,
    clearDraftsInterval,
  ]);

  const runClassifyParents = React.useCallback(async () => {
    if (classifyParentsLoading) return;

    setClassifyParentsLoading(true);
    setClassifyParentsProgress("Running...");

    toast({
      title: "Parent classification started",
      description: "Classifying topic drafts into themes...",
    });

    try {
      const { data, error } = await supabase.functions.invoke("classify-parent-topics");

      if (error) {
        toast({
          title: "Classify Parents failed",
          description: error.message,
          variant: "destructive",
        });
        return;
      }

      const { classified = 0, proposed = 0, skipped = 0 } = (data as any) ?? {};
      setClassifyParentsProgress(`${classified} classified · ${proposed} proposed · ${skipped} skipped`);

      toast({
        title: "Parent classification complete ✅",
        description: `Classified: ${classified} · New themes proposed: ${proposed} · Skipped: ${skipped}`,
      });

      setTimeout(() => { void load(); }, 1500);
    } catch (e: any) {
      toast({
        title: "Classify Parents error",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setClassifyParentsLoading(false);
    }
  }, [classifyParentsLoading, supabase, toast, load]);

  // --------------------
  // Bulk actions
  // --------------------
  const [bulkApproving, setBulkApproving] = React.useState(false);
  const [bulkCreatingQDrafts, setBulkCreatingQDrafts] = React.useState(false);

  const bulkApproveSelected = React.useCallback(async () => {
    if (bulkApproving) return;
    if (selectedIds.size === 0) return;

    // Only approve drafts that are not already approved
    const eligible = rows.filter((r) => selectedIds.has(r.id) && r.status !== "approved").map((r) => r.id);
    if (eligible.length === 0) {
      toast({
        title: "Nothing to approve",
        description: "All selected drafts are already approved.",
      });
      return;
    }

    setBulkApproving(true);
    const now = new Date().toISOString();
    const chunkSize = 10; // ✅ safe batching (per your earlier alignment)

    let updated = 0;
    try {
      for (let i = 0; i < eligible.length; i += chunkSize) {
        const chunk = eligible.slice(i, i + chunkSize);
        const { error } = await supabase
          .from("topic_drafts")
          .update({ status: "approved", approved_at: now, rejected_at: null })
          .in("id", chunk);

        if (error) throw error;
        updated += chunk.length;

        toast({
          title: "Bulk approve in progress",
          description: `${updated}/${eligible.length} approved…`,
        });

        // small breather to avoid hammering PostgREST
        await sleep(150);
      }

      toast({
        title: "Bulk approve complete ✅",
        description: `Approved ${updated} drafts.`,
      });

      await load();
    } catch (e: any) {
      console.error("bulkApproveSelected failed:", e);
      toast({
        title: "Bulk approve failed",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setBulkApproving(false);
    }
  }, [bulkApproving, selectedIds, rows, supabase, toast, load]);

  const bulkCreateQuestionDraftsSelected = React.useCallback(async () => {
    if (bulkCreatingQDrafts) return;
    if (selectedIds.size === 0) return;

    // Only create where we don't already have a question draft
    const eligible = rows
      .filter((r) => selectedIds.has(r.id) && !topicDraftHasQDraft.has(r.id))
      .map((r) => r.id);

    if (eligible.length === 0) {
      toast({
        title: "Nothing to create",
        description: "All selected drafts already have question drafts.",
      });
      return;
    }

    setBulkCreatingQDrafts(true);
    const batchSize = 5; // ✅ safe batching (per your earlier alignment)

    let ok = 0;
    let failed = 0;

    try {
      for (let i = 0; i < eligible.length; i += batchSize) {
        const batch = eligible.slice(i, i + batchSize);

        // Run up to 5 in parallel
        const results = await Promise.all(
          batch.map(async (topic_draft_id) => {
            try {
              const { data, error } = await supabase.functions.invoke("admin-create-question-draft", {
                body: { topic_draft_id },
              });

              if (error) throw error;
              if (!(data as any)?.ok) throw new Error("Edge function returned ok=false");
              return { ok: true as const };
            } catch (err: any) {
              return { ok: false as const, err: err?.message ?? String(err) };
            }
          }),
        );

        results.forEach((r) => {
          if (r.ok) ok += 1;
          else failed += 1;
        });

        toast({
          title: "Bulk question drafts in progress",
          description: `${ok + failed}/${eligible.length} processed… (ok=${ok}, failed=${failed})`,
        });

        await sleep(250);
      }

      toast({
        title: "Bulk question draft creation complete ✅",
        description: `Created ${ok} question drafts${failed ? ` (failed ${failed})` : ""}.`,
        variant: failed ? "destructive" : "default",
      });

      await load();
    } catch (e: any) {
      console.error("bulkCreateQuestionDraftsSelected failed:", e);
      toast({
        title: "Bulk create failed",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setBulkCreatingQDrafts(false);
    }
  }, [bulkCreatingQDrafts, selectedIds, rows, topicDraftHasQDraft, supabase, toast, load]);

  return (
    <Card className="max-w-6xl mx-auto">
      <CardHeader className="space-y-3 pb-3">

        {/* Row 1: Title + Refresh */}
        <div className="flex items-center justify-between">
          <CardTitle>Topic Drafts</CardTitle>
          <Button variant="outline" size="icon" onClick={load} title="Refresh" disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Row 2: Filters + bulk actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search draft title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48"
          />
          <Input
            type="datetime-local"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value ? new Date(e.target.value).toISOString() : "")}
            className="w-44"
          />
          <Input
            type="datetime-local"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value ? new Date(e.target.value).toISOString() : "")}
            className="w-44"
          />
          <select
            className="border rounded px-2 py-1 text-sm h-9"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | DraftStatus)}
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2 border rounded px-2 py-1 ml-auto">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAllVisible}
              title="Select all visible"
            />
            <span className="text-xs text-muted-foreground">Selected: {selectedCount}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
              disabled={selectedCount === 0}
            >
              Clear
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={bulkApproveSelected}
              disabled={selectedCount === 0 || bulkApproving}
              title="Bulk approve uses the same update as single approve"
            >
              {bulkApproving ? "Approving…" : "Bulk Approve"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={bulkCreateQuestionDraftsSelected}
              disabled={selectedCount === 0 || bulkCreatingQDrafts}
              title="Creates question drafts (skips ones that already exist)"
            >
              {bulkCreatingQDrafts ? "Creating…" : "Bulk Create Question Drafts"}
            </Button>
          </div>
        </div>

        {/* Row 3: Pipeline — full width, never wraps */}
        <div className="flex items-center gap-1 rounded border bg-slate-50 px-3 py-2 overflow-x-auto">
          <span className="text-xs text-muted-foreground font-medium shrink-0 mr-1">Pipeline:</span>

          <Button
            variant="outline"
            onClick={runEmbed}
            disabled={embedLoading}
            className="shrink-0 min-w-[190px]"
            title="Step 1: Generate vector embeddings for all un-embedded articles"
          >
            {embedLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {!embedLoading && <Cpu className="mr-2 h-4 w-4" />}
            {embedLoading ? `${embedProgress} (${embedElapsed}s)` : "1. Run Embedding"}
          </Button>

          <span className="text-muted-foreground text-xs px-1 shrink-0">→</span>

          <Button
            variant="outline"
            onClick={runExtractEntities}
            disabled={entityLoading}
            className="shrink-0 min-w-[190px]"
            title="Step 2: Extract named entities from embedded articles for higher-quality clustering"
          >
            {entityLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {!entityLoading && <Cpu className="mr-2 h-4 w-4" />}
            {entityLoading ? `Extracting... ${entityElapsed}s (${entityProgress})` : "2. Extract Entities"}
          </Button>

          <span className="text-muted-foreground text-xs px-1 shrink-0">→</span>

          <Button
            variant="outline"
            onClick={runCluster}
            disabled={clusterLoading}
            className="shrink-0 min-w-[190px]"
            title="Step 3: Group embedded articles into topic clusters"
          >
            {clusterLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {clusterLoading ? `Clustering... ${clusterElapsed}s (${clusterProgress})` : "3. Run Cluster"}
          </Button>

          <span className="text-muted-foreground text-xs px-1 shrink-0">→</span>

          <Button
            variant="outline"
            onClick={runCreateDrafts}
            disabled={createDraftsLoading}
            className="shrink-0 min-w-[200px]"
            title="Step 4: Generate topic drafts from clusters for admin review"
          >
            {createDraftsLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {createDraftsLoading ? `Creating... ${createDraftsElapsed}s (${createDraftsProgress})` : "4. Create Topic Drafts"}
          </Button>

          <span className="text-muted-foreground text-xs px-1 shrink-0">→</span>

          <Button
            variant="outline"
            onClick={runClassifyParents}
            disabled={classifyParentsLoading}
            className="shrink-0 min-w-[200px]"
            title="Step 5: Classify topic drafts into parent themes (proposes new themes if none match)"
          >
            {classifyParentsLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {classifyParentsLoading
              ? `Classifying... (${classifyParentsProgress})`
              : "5. Classify Parents"}
          </Button>
        </div>

        {clusterResult && (
          <div className="mt-2 flex items-start gap-2 rounded border bg-slate-50 px-3 py-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{clusterResult}</span>
          </div>
        )}

        {/* Mirror Images — separate from the numbered 1-5 pipeline above on
            purpose: it's a maintenance step, not a content-generation step,
            and inserting it into that numbering would mean renumbering two
            parallel copies of those buttons for no real benefit. Must run
            after Cluster (3) and before Bulk Create Question Drafts above —
            see the comment on the mirrorLoading state for why. */}
        <div className="mt-2 flex items-center gap-2 rounded border bg-amber-50 px-3 py-2">
          <Button
            variant="outline"
            onClick={runMirrorImages}
            disabled={mirrorLoading}
            className="shrink-0 min-w-[220px]"
            title="Run after Run Cluster, before Bulk Create Question Drafts — copies each article's cover photo into our own Storage so cover_image_url stops depending on the live publisher URL (fixes hotlink blocks like NDTV, and the CMYK-photo decode issue). Safe to run more than once."
          >
            {mirrorLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {!mirrorLoading && <ImageIcon className="mr-2 h-4 w-4" />}
            {mirrorLoading ? `Mirroring... ${mirrorElapsed}s — ${mirrorProgress}` : "Mirror Images to Storage"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Run after Run Cluster, before Bulk Create Question Drafts — covers freeze at that step.
          </span>
        </div>

        {mirrorResult && (
          <div className="mt-2 flex items-start gap-2 rounded border bg-slate-50 px-3 py-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{mirrorResult}</span>
          </div>
        )}

      </CardHeader>

      <CardContent className="space-y-3">
        {loading && (
          <div className="p-4 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground space-y-3">
            <div className="font-medium">No topic drafts found.</div>
            <div className="text-xs space-y-2 bg-slate-50 p-3 rounded border">
              <p className="font-semibold">📋 Pipeline Instructions:</p>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li>
                  <strong>Run Embedding</strong> — Generates vector embeddings for un-embedded articles
                </li>
                <li>
                  <strong>Extract Entities</strong> — Extracts named people, orgs, locations from each article for higher-quality clustering
                </li>
                <li>
                  <strong>Run Cluster</strong> — Groups embedded articles into topic clusters
                </li>
                <li>
                  <strong>Mirror Images to Storage</strong> — Copies each article's cover photo into our own Storage before covers get assigned
                </li>
                <li>
                  <strong>Create Topic Drafts</strong> — Generates drafts from clusters for review
                </li>
                <li>
                  <strong>Refresh</strong> — See your new drafts and review/approve them
                </li>
              </ol>
              <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
                <p className="font-semibold text-yellow-800">💡 Tip:</p>
                <p className="text-yellow-700">
                  Always run Embedding before Clustering — Cluster requires embeddings to exist first.
                  Run Mirror Images after Cluster, before Bulk Create Question Drafts — cover_image_url
                  freezes at that step and never re-syncs to a mirror completed afterward.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={runEmbed} disabled={embedLoading}>
                {embedLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {!embedLoading && <Cpu className="mr-2 h-4 w-4" />}
                {embedLoading ? `${embedProgress} (${embedElapsed}s)` : "1. Run Embedding"}
              </Button>
              <Button variant="outline" onClick={runExtractEntities} disabled={entityLoading}>
                {entityLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {!entityLoading && <Cpu className="mr-2 h-4 w-4" />}
                {entityLoading ? `Extracting... ${entityElapsed}s` : "2. Extract Entities"}
              </Button>
              <Button variant="outline" onClick={runCluster} disabled={clusterLoading}>
                {clusterLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {clusterLoading ? `Clustering... ${clusterElapsed}s (${clusterProgress})` : "3. Run Cluster"}
              </Button>
              <Button
                variant="outline"
                onClick={runMirrorImages}
                disabled={mirrorLoading}
                title="Run before Bulk Create Question Drafts — mirrors cover photos to Storage"
              >
                {mirrorLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {!mirrorLoading && <ImageIcon className="mr-2 h-4 w-4" />}
                {mirrorLoading ? `Mirroring... ${mirrorElapsed}s` : "Mirror Images"}
              </Button>
              <Button variant="outline" onClick={runCreateDrafts} disabled={createDraftsLoading}>
                {createDraftsLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {createDraftsLoading ? `Creating... ${createDraftsElapsed}s` : "4. Create Topic Drafts"}
              </Button>
              <Button variant="outline" onClick={runClassifyParents} disabled={classifyParentsLoading}>
                {classifyParentsLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {classifyParentsLoading ? `Classifying...` : "5. Classify Parents"}
              </Button>
              <Button variant="outline" onClick={load} disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Refresh
              </Button>
            </div>
          </div>
        )}

        {rows.map((row) => (
          <TopicDraftRowView
            key={row.id}
            row={row}
            onChanged={load}
            hasQuestionDraft={topicDraftHasQDraft.has(row.id)}
            selected={selectedIds.has(row.id)}
            onToggleSelected={toggleRowSelected}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function TopicDraftRowView({
  row,
  onChanged,
  hasQuestionDraft,
  selected,
  onToggleSelected,
}: {
  row: TopicDraftRow;
  onChanged: () => void;
  hasQuestionDraft: boolean;
  selected: boolean;
  onToggleSelected: (id: string) => void;
}) {
  const sourceName = row.location_label ?? row.news_items?.title ?? "—";
  const newsUrl = row.news_items?.url ?? null;
  const newsTitle = row.news_items?.title ?? null;

  return (
    <div className={`border rounded p-4 space-y-3 ${selected ? "ring-2 ring-slate-200" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="pt-1 pr-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelected(row.id)}
            title="Select"
          />
        </div>
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium">{sourceName}</span>
            <StatusBadge status={row.status} />
            {hasQuestionDraft && (
              <Badge variant="secondary" className="text-xs">
                Question Draft ✅
              </Badge>
            )}
            <span>{row.created_at ? new Date(row.created_at).toLocaleString() : "—"}</span>
          </div>
          <h3 className="text-lg font-semibold break-words">{row.title}</h3>
          {row.tags && row.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-1">
              {row.tags.map((t, i) => (
                <Badge key={`${t}-${i}`} variant="secondary">
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 items-end">
          <EditTopicDialog row={row} onSaved={onChanged} />
          <div className="flex gap-2">
            <CreateQuestionDraftButton
              row={row}
              onCreated={onChanged}
              disabled={hasQuestionDraft}
              disabledReason="Question draft already exists for this Topic Draft"
            />
            <StatusButtons row={row} onChanged={onChanged} />
          </div>
        </div>
      </div>

      {row.summary && <p className="text-sm whitespace-pre-wrap">{row.summary}</p>}

      {newsUrl && (
        <a
          href={newsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-blue-600 underline"
        >
          View article <ExternalLink className="h-3 w-3" />
        </a>
      )}
      {newsTitle && (
        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">Article: {newsTitle}</div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: DraftStatus }) {
  let cls = "";
  let label = "";

  switch (status) {
    case "draft":
      cls = "bg-slate-100 text-slate-700";
      label = "Draft";
      break;
    case "approved":
      cls = "bg-emerald-100 text-emerald-700";
      label = "Approved";
      break;
    case "rejected":
      cls = "bg-rose-100 text-rose-700";
      label = "Rejected";
      break;
  }

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function EditTopicDialog({ row, onSaved }: { row: TopicDraftRow; onSaved: () => void }) {
  const supabase = getSupabase()!;
  const { toast } = useToast();

  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState(row.title);
  const [summary, setSummary] = React.useState(row.summary ?? "");
  const [tags, setTags] = React.useState((row.tags ?? []).join(", "));
  const [location, setLocation] = React.useState(row.location_label ?? "");
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    if (saving) return;
    setSaving(true);

    const patch: any = { title, summary };
    if (tags.trim()) patch.tags = tags.split(",").map((t) => t.trim());
    if (location.trim()) patch.location_label = location.trim();

    const { error } = await supabase.from("topic_drafts").update(patch).eq("id", row.id);

    if (error) {
      toast({
        title: "Failed to update draft",
        description: error.message,
        variant: "destructive",
      });
      setSaving(false);
      return;
    }

    toast({
      title: "Draft updated",
      description: "Topic draft saved successfully.",
    });

    setOpen(false);
    setSaving(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Edit2 className="h-4 w-4 mr-1" /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit Topic Draft</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Topic title" />
          </div>
          <div>
            <Label>Summary</Label>
            <Textarea
              rows={4}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Short topic summary used to generate questions."
            />
          </div>
          <div>
            <Label>Tags (comma-separated)</Label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="politics, local, zoning" />
          </div>
          <div>
            <Label>Location label</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g., New Jersey" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusButtons({
  row,
  onChanged,
}: {
  row: TopicDraftRow;
  onChanged: () => void;
}) {
  const supabase = getSupabase()!;
  const { toast } = useToast();

  const [loadingStatus, setLoadingStatus] = React.useState<DraftStatus | null>(null);
  const [optimisticStatus, setOptimisticStatus] = React.useState<DraftStatus>(row.status);

  React.useEffect(() => {
    setOptimisticStatus(row.status);
  }, [row.status]);

  const updateStatus = async (status: DraftStatus) => {
    if (loadingStatus) return;

    setOptimisticStatus(status);
    setLoadingStatus(status);

    const now = new Date().toISOString();

    const patch: any = { status };
    if (status === "approved") {
      patch.approved_at = now;
      patch.rejected_at = null;
    } else if (status === "rejected") {
      patch.rejected_at = now;
    }

    try {
      // ✅ IMPORTANT: Use authenticated Supabase client (respects session + RLS)
      const { error } = await supabase.from("topic_drafts").update(patch).eq("id", row.id);

      if (error) throw error;

      toast({
        title: "Status updated",
        description: `Topic draft marked as ${status}.`,
      });

      void onChanged();
    } catch (e: any) {
      setOptimisticStatus(row.status);
      toast({
        title: "Status update failed",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setLoadingStatus(null);
    }
  };

  const effectiveStatus = optimisticStatus;

  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => updateStatus("approved")}
        disabled={effectiveStatus === "approved" || loadingStatus === "approved"}
      >
        {loadingStatus === "approved" ? "Approving…" : effectiveStatus === "approved" ? "Approved" : "Approve"}
      </Button>

      <Button
        size="sm"
        variant="outline"
        onClick={() => updateStatus("rejected")}
        disabled={effectiveStatus === "rejected" || loadingStatus === "rejected"}
      >
        {loadingStatus === "rejected" ? "Rejecting…" : effectiveStatus === "rejected" ? "Rejected" : "Reject"}
      </Button>
    </div>
  );
}

function CreateQuestionDraftButton({
  row,
  onCreated,
  disabled,
  disabledReason,
}: {
  row: TopicDraftRow;
  onCreated: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const supabase = getSupabase()!;
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);

  const handleClick = async () => {
    if (loading || disabled) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-create-question-draft", {
        body: { topic_draft_id: row.id },
      });

      if (error) {
        console.error("admin-create-question-draft error:", error);
        toast({
          title: "Failed to create question draft",
          description: error.message ?? "Edge function returned an error.",
          variant: "destructive",
        });
        return;
      }

      const payload: any = data ?? {};
      if (!payload?.ok) {
        toast({
          title: "Question draft not created",
          description: "The function completed but did not return ok=true. Check logs.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Question draft created",
          description: "A question draft was generated from this topic.",
        });
        onCreated();
      }
    } catch (e: any) {
      console.error("admin-create-question-draft exception:", e);
      toast({
        title: "Question draft creation failed",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const isDisabled = loading || !!disabled;

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleClick}
      disabled={isDisabled}
      title={disabled ? disabledReason : undefined}
    >
      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {disabled ? "Question Draft Exists" : loading ? "Creating…" : "Create Question Draft"}
    </Button>
  );
}
