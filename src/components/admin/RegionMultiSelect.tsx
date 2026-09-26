import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { getSupabase } from "@/lib/supabaseClient";
import { Loader2, Globe2 } from "lucide-react";

export type Region = {
  id: string;
  type: "city" | "county" | "state" | "country" | "global";
  name: string;
  iso_code: string | null;
  parent_id?: string | null;
  parent?: { name: string } | null;
};

// Epic R R-11: the picker used to load the first 500 locations ordered by
// type then name and filter them in the browser. Types sort alphabetically,
// so all 500 were cities ("88", "Aaronsburg", ...) and no state, county or
// country — nor almost any of the ~31k cities — could ever be chosen. Now the
// small broad levels are preloaded and everything else is searched on the
// server as the admin types, broad levels ranked first.
const TYPE_RANK: Record<Region["type"], number> = { global: 0, country: 1, state: 2, county: 3, city: 4 };
const SELECT_COLUMNS = "id, type, name, iso_code, parent_id";
const SEARCH_LIMIT = 60;

// Parent names (for telling identical city/county names apart) are fetched
// with a second lookup by id rather than a PostgREST self-embed, which depends
// on the schema cache knowing the locations_parent_id_fkey relationship.
async function withParents(supabase: ReturnType<typeof getSupabase>, rows: Region[]): Promise<Region[]> {
  const ids = [...new Set(rows.filter(r => (r.type === "city" || r.type === "county") && r.parent_id).map(r => r.parent_id as string))];
  if (!supabase || ids.length === 0) return rows;
  const { data } = await supabase.from("locations").select("id, name").in("id", ids);
  const names = new Map((data ?? []).map((l: { id: string; name: string }) => [l.id, l.name]));
  return rows.map(r => (r.parent_id && names.has(r.parent_id) ? { ...r, parent: { name: names.get(r.parent_id)! } } : r));
}

function byRankThenName(a: Region, b: Region) {
  return (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9) || a.name.localeCompare(b.name);
}

export const RegionMultiSelect: React.FC<{
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
}> = ({ value, onChange, placeholder }) => {
  const supabase = getSupabase()!;
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [broad, setBroad] = React.useState<Region[]>([]);
  const [results, setResults] = React.useState<Region[]>([]);
  const [known, setKnown] = React.useState<Record<string, Region>>({});
  const [q, setQ] = React.useState("");

  const remember = React.useCallback((rows: Region[]) => {
    setKnown(prev => {
      const next = { ...prev };
      for (const r of rows) next[r.id] = r;
      return next;
    });
  }, []);

  // Broad levels (global, countries, states — about a hundred rows) are
  // always listed, so the common ledger regions are one click away.
  React.useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("locations")
        .select(SELECT_COLUMNS)
        .in("type", ["global", "country", "state"])
        .order("name")
        .limit(500);
      if (!error && data) {
        const rows = (data as unknown as Region[]).sort(byRankThenName);
        setBroad(rows);
        remember(rows);
      }
    })();
  }, []);

  // Selected ids that arrive from outside (e.g. a saved value) still get a label.
  React.useEffect(() => {
    const missing = value.filter(id => !known[id]);
    if (missing.length === 0) return;
    (async () => {
      const { data } = await supabase.from("locations").select(SELECT_COLUMNS).in("id", missing);
      if (data) remember(await withParents(supabase, data as unknown as Region[]));
    })();
  }, [value, known]);

  // Server-side search across every level, debounced.
  React.useEffect(() => {
    const term = q.trim().replace(/[%_\\]/g, "");
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data, error } = await supabase
        .from("locations")
        .select(SELECT_COLUMNS)
        .ilike("name", `%${term}%`)
        .order("name")
        .limit(SEARCH_LIMIT);
      if (cancelled) return;
      if (!error && data) {
        const rows = (await withParents(supabase, data as unknown as Region[])).sort(byRankThenName);
        if (cancelled) return;
        setResults(rows);
        remember(rows);
      }
      setLoading(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const term = q.trim().toLowerCase();
  const broadMatches = term
    ? broad.filter(r => r.name.toLowerCase().includes(term) || (r.iso_code ?? "").toLowerCase().includes(term))
    : broad;
  // Broad matches are always included, so a state is never crowded out of
  // the server's result cap by cities that sort before it ("New Jersey" vs
  // the many "New ..." cities).
  const list = term.length >= 2
    ? [...broadMatches, ...results.filter(r => !broadMatches.some(b => b.id === r.id))].sort(byRankThenName)
    : broadMatches;

  const single = value.length === 1 ? known[value[0]] : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="justify-start gap-2">
          <Globe2 className="h-4 w-4" />
          {single
            ? single.name
            : value.length
              ? `${value.length} region${value.length > 1 ? "s" : ""}`
              : placeholder ?? "Select regions (optional)"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96">
        <div className="flex items-center gap-2 mb-2">
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search regions (2+ letters for cities and counties)..." />
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        </div>
        <div className="max-h-72 overflow-auto space-y-2">
          {!loading && term.length >= 2 && list.length === 0 && (
            <p className="text-xs text-muted-foreground px-1">No matching regions.</p>
          )}
          {list.map(r => {
            const checked = value.includes(r.id);
            return (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={checked}
                  onCheckedChange={c => {
                    if (c) onChange([...value, r.id]);
                    else onChange(value.filter(x => x !== r.id));
                  }}
                />
                <span className="w-16 shrink-0 text-muted-foreground uppercase text-xs">{r.type}</span>
                <span className="font-medium truncate">
                  {r.name}
                  {r.parent?.name && (r.type === "city" || r.type === "county") && (
                    <span className="font-normal text-muted-foreground"> — {r.parent.name}</span>
                  )}
                </span>
                {r.iso_code && <Badge variant="secondary" className="ml-auto shrink-0">{r.iso_code}</Badge>}
              </label>
            );
          })}
          {term.length >= 2 && results.length === SEARCH_LIMIT && (
            <p className="text-[11px] text-muted-foreground px-1">
              Showing the first {SEARCH_LIMIT} matches — type more to narrow down.
            </p>
          )}
        </div>
        {value.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {value.map(id => {
              const r = known[id];
              if (!r) return null;
              return <Badge key={id} variant="outline">{r.name}</Badge>;
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
