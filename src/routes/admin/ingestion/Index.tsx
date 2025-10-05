import * as React from "react";
import { createSupabase } from "@/lib/createSupabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { JsonViewer } from "@/components/admin/JsonViewer";
import { RefreshCw } from "lucide-react";

export default function AdminIngestionPage() {
  const supabase = React.useMemo(createSupabase, []);
  const [rows, setRows] = React.useState<any[]>([]);
  const [count, setCount] = React.useState<number | undefined>();
  const [page, setPage] = React.useState(1);
  const pageSize = 25;

  const [status, setStatus] = React.useState<string | undefined>();
  const [lang, setLang] = React.useState<string>("");
  const [sourceId, setSourceId] = React.useState<string | undefined>();
  const [sources, setSources] = React.useState<any[]>([]);
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");

  const loadSources = React.useCallback(async () => {
    const { data } = await supabase.from("topic_sources").select("id, name").order("name");
    setSources(data ?? []);
  }, []);

  const load = React.useCallback(async () => {
    let q = supabase
      .from("ingestion_queue")
      .select("*, topic_sources:source_id(name)", { count: "exact" })
      .order("published_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (status) q = q.eq("status", status);
    if (sourceId) q = q.eq("source_id", sourceId);
    if (lang) q = q.ilike("lang", lang);
    if (dateFrom) q = q.gte("published_at", dateFrom);
    if (dateTo) q = q.lte("published_at", dateTo);

    const { data, error, count: c } = await q;
    if (!error) {
      setRows(data ?? []);
      setCount(c ?? undefined);
    }
  }, [status, lang, sourceId, dateFrom, dateTo, page]);

  React.useEffect(() => { loadSources(); }, []);
  React.useEffect(() => { load(); }, [load]);

  const totalPages = count ? Math.max(1, Math.ceil(count / pageSize)) : 1;

  return (
    <Card className="max-w-7xl mx-auto">
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Ingestion Queue</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => { setPage(1); load(); }}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Filter bar */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
          <div>
            <label className="text-xs text-muted-foreground">Status</label>
            <Select value={status ?? ""} onValueChange={(v) => { setPage(1); setStatus(v || undefined); }}>
              <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Any</SelectItem>
                <SelectItem value="new">new</SelectItem>
                <SelectItem value="clustered">clustered</SelectItem>
                <SelectItem value="rejected">rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Lang</label>
            <Input value={lang} onChange={(e) => { setPage(1); setLang(e.target.value); }} placeholder="en" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Source</label>
            <Select value={sourceId ?? ""} onValueChange={(v) => { setPage(1); setSourceId(v || undefined); }}>
              <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Any</SelectItem>
                {sources.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">From (published_at)</label>
            <Input
              type="datetime-local"
              value={dateFrom}
              onChange={(e) => {
                setPage(1);
                setDateFrom(e.target.value ? new Date(e.target.value).toISOString() : "");
              }}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">To (published_at)</label>
            <Input
              type="datetime-local"
              value={dateTo}
              onChange={(e) => {
                setPage(1);
                setDateTo(e.target.value ? new Date(e.target.value).toISOString() : "");
              }}
            />
          </div>
        </div>

        {/* Table */}
        <div className="grid grid-cols-12 text-xs text-muted-foreground py-2">
          <div className="col-span-3">Title</div>
          <div className="col-span-2">Source</div>
          <div>Lang</div>
          <div>Status</div>
          <div className="col-span-2">Published</div>
          <div className="col-span-4">Expand</div>
        </div>
        <div className="divide-y">
          {rows.map(r => <IngestionRow key={r.id} row={r} />)}
          {!rows.length && <div className="p-6 text-sm text-muted-foreground">No results.</div>}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-end gap-2 mt-4 text-sm">
          <span>Page {page} / {totalPages}</span>
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
            Prev
          </Button>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            Next
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function IngestionRow({ row }: { row: any }) {
  const [openRaw, setOpenRaw] = React.useState(false);
  const [openNorm, setOpenNorm] = React.useState(false);
  return (
    <div className="grid grid-cols-12 items-start gap-2 py-3 text-sm">
      <div className="col-span-3 font-medium truncate" title={row.title}>{row.title}</div>
      <div className="col-span-2">{row.topic_sources?.name ?? "—"}</div>
      <div>{row.lang ?? "—"}</div>
      <div>{row.status}</div>
      <div className="col-span-2">{row.published_at ? new Date(row.published_at).toLocaleString() : "—"}</div>
      <div className="col-span-4 space-y-2">
        <Button size="sm" variant="outline" onClick={() => setOpenRaw(o => !o)}>Raw</Button>
        {openRaw && <JsonViewer value={row.raw} initiallyOpen />}
        <Button size="sm" variant="outline" onClick={() => setOpenNorm(o => !o)}>Normalized</Button>
        {openNorm && <JsonViewer value={row.normalized} initiallyOpen />}
      </div>
    </div>
  );
}
