// src/routes/admin/elections/Index.tsx
//
// Admin: Elections Index page (Epic EL — Phase EL-1)
//
// Lists all elections with tier, state, phase info, and legal review status.
// Entry point to the Election Creation Wizard.
//
// EL-QA-001: Admin creates Lok Sabha election (schema visible here)
// EL-QA-002: Admin creates Vidhan Sabha election
// EL-QA-007: Legal review gate visible on state badge

import * as React from "react";
import { Link } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import {
  RefreshCw,
  Loader2,
  Plus,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Vote,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ElectionState =
  | "UPCOMING"
  | "CAMPAIGN_ACTIVE"
  | "MCC_ACTIVE"
  | "SILENCE"
  | "POLLING"
  | "COUNTING"
  | "POST_ELECTION_RESULT_PENDING"
  | "POST_ELECTION_COALITION_FORMING"
  | "RESULT_DECLARED"
  | "ARCHIVED";

type ElectionRow = {
  id: string;
  name: string;
  tier_code: string;
  country: string;
  election_subtype: string;
  is_snap: boolean;
  state: ElectionState;
  state_changed_at: string;
  legal_review_completed: boolean;
  phase_number: number | null;
  total_phases: number | null;
  phase_label: string | null;
  parent_election_id: string | null;
  polling_start_at: string | null;
  polling_end_at: string | null;
  mcc_start_at: string | null;
  silence_start_at: string | null;
  created_at: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATE_STYLES: Record<ElectionState, string> = {
  UPCOMING:                       "bg-slate-100 text-slate-700 border-slate-300",
  CAMPAIGN_ACTIVE:                "bg-green-50 text-green-700 border-green-300",
  MCC_ACTIVE:                     "bg-blue-50 text-blue-700 border-blue-300",
  SILENCE:                        "bg-red-50 text-red-700 border-red-300",
  POLLING:                        "bg-orange-50 text-orange-700 border-orange-300",
  COUNTING:                       "bg-yellow-50 text-yellow-700 border-yellow-300",
  POST_ELECTION_RESULT_PENDING:   "bg-purple-50 text-purple-700 border-purple-300",
  POST_ELECTION_COALITION_FORMING:"bg-violet-50 text-violet-700 border-violet-300",
  RESULT_DECLARED:                "bg-emerald-50 text-emerald-700 border-emerald-300",
  ARCHIVED:                       "bg-gray-100 text-gray-500 border-gray-300",
};

const TIER_LABELS: Record<string, string> = {
  IN_VIDHAN_SABHA:  "Vidhan Sabha",
  IN_LOK_SABHA:     "Lok Sabha",
  US_PRESIDENTIAL:  "US Presidential",
  US_SENATE:        "US Senate",
  US_HOUSE:         "US House",
  US_GOVERNOR:      "US Governor",
  US_STATE_SENATE:  "US State Senate",
  US_STATE_HOUSE:   "US State House",
};

function StateBadge({ state }: { state: ElectionState }) {
  const label = state.replace(/_/g, " ");
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold border uppercase tracking-wide ${STATE_STYLES[state] ?? "bg-slate-100 text-slate-600 border-slate-300"}`}
    >
      {label}
    </span>
  );
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ─── Election Card ─────────────────────────────────────────────────────────────

function ElectionCard({ row }: { row: ElectionRow }) {
  const isPhased = (row.total_phases ?? 1) > 1;

  return (
    <Card className="p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm truncate">{row.name}</span>
            {row.is_snap && (
              <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700">
                SNAP
              </Badge>
            )}
            {isPhased && row.phase_number && (
              <Badge variant="outline" className="text-[10px]">
                Phase {row.phase_number}/{row.total_phases}
                {row.phase_label ? ` · ${row.phase_label}` : ""}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">
              {TIER_LABELS[row.tier_code] ?? row.tier_code}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground uppercase">
              {row.election_subtype}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <StateBadge state={row.state} />
          {row.legal_review_completed ? (
            <span title="Legal review complete">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            </span>
          ) : (
            <span title="Legal review pending — cannot go ACTIVE">
              <XCircle className="h-4 w-4 text-red-500" />
            </span>
          )}
        </div>
      </div>

      {/* Date row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {row.mcc_start_at && (
          <div>
            <span className="font-medium text-foreground">MCC</span>
            <div>{fmtDate(row.mcc_start_at)}</div>
          </div>
        )}
        {row.silence_start_at && (
          <div>
            <span className="font-medium text-red-600">Silence</span>
            <div>{fmtDate(row.silence_start_at)}</div>
          </div>
        )}
        <div>
          <span className="font-medium text-foreground">Polling</span>
          <div>
            {row.polling_start_at
              ? row.polling_end_at && row.polling_end_at !== row.polling_start_at
                ? `${fmtDate(row.polling_start_at)} – ${fmtDate(row.polling_end_at)}`
                : fmtDate(row.polling_start_at)
              : "—"}
          </div>
        </div>
        <div>
          <span className="font-medium text-foreground">Created</span>
          <div>{fmtDate(row.created_at)}</div>
        </div>
      </div>

      {/* Legal review warning */}
      {!row.legal_review_completed && row.state === "UPCOMING" && (
        <div className="flex items-center gap-2 rounded bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Legal review not completed — election cannot advance to Campaign Active.
        </div>
      )}
    </Card>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminElectionsPage() {
  const { toast } = useToast();

  const [elections, setElections] = React.useState<ElectionRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<"all" | "active" | "upcoming" | "archived">("all");

  const fetchElections = React.useCallback(async () => {
    setLoading(true);
    try {
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const projectRef = supabaseUrl.replace("https://", "").split(".")[0];
      let jwt = anonKey;
      try {
        const raw = localStorage.getItem(`sb-${projectRef}-auth-token`);
        if (raw) { const p = JSON.parse(raw); if (p?.access_token) jwt = p.access_token; }
      } catch {}

      const headers = { "apikey": anonKey, "Authorization": `Bearer ${jwt}` };

      const STATE_FILTERS: Record<string, string> = {
        active:   "state=in.(CAMPAIGN_ACTIVE,MCC_ACTIVE,SILENCE,POLLING,COUNTING)",
        upcoming: "state=eq.UPCOMING",
        archived: "state=in.(RESULT_DECLARED,ARCHIVED)",
      };

      const filterParam = filter !== "all" ? `&${STATE_FILTERS[filter]}` : "";
      const url = `${supabaseUrl}/rest/v1/elections?select=*&order=created_at.desc${filterParam}`;

      const res = await fetch(url, { headers });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `HTTP ${res.status}`); }
      setElections(await res.json());
    } catch (err: any) {
      toast({ title: "Failed to load elections", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [filter, toast]);

  React.useEffect(() => { fetchElections(); }, [fetchElections]);

  const filters: { value: typeof filter; label: string }[] = [
    { value: "all",      label: "All" },
    { value: "upcoming", label: "Upcoming" },
    { value: "active",   label: "Active" },
    { value: "archived", label: "Archived" },
  ];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Vote className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold">Elections</h1>
            <p className="text-xs text-muted-foreground">
              Epic EL · India Vidhan Sabha (priority) · Lok Sabha &amp; USA deferred
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={fetchElections}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
          <Button asChild size="sm">
            <Link to="/admin/elections/new">
              <Plus className="h-4 w-4 mr-1" />
              New Election
            </Link>
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {filters.map((f) => (
          <Button
            key={f.value}
            variant={filter === f.value ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {/* Election list */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading elections…
        </div>
      ) : elections.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground space-y-3">
          <Vote className="h-8 w-8 mx-auto opacity-30" />
          <p className="text-sm">No elections found.</p>
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/elections/new">Create your first election</Link>
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {elections.map((e) => (
            <ElectionCard key={e.id} row={e} />
          ))}
        </div>
      )}
    </div>
  );
}
