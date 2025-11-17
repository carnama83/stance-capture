import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import AdminRunWorkerButton from "@/components/AdminRunWorkerButton";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL!;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY!;
const sb = createClient(supabaseUrl, supabaseAnonKey);

type Source = { id: string; name: string | null };
type Item = {
  id: string;
  source_id: string;
  title: string;
  url: string;
  summary: string | null;
  published_at: string | null;
  created_at: string;
};

export default function AdminNewsIndex() {
  const [sources, setSources] = useState<Source[]>([]);
  const [rows, setRows] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize] = useState(25);

  const [q, setQ] = useState("");
  const [sourceId, setSourceId] = useState<string | "">("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  // load sources (id + name) for dropdown
  useEffect(() => {
    (async () => {
      const { data, error } = await sb
        .from("topic_sources")
        .select("id,name")
        .order("name", { ascending: true });
      if (!error && data) setSources(data as any);
    })();
  }, []);

  const filtersDesc = useMemo(() => {
    const parts: string[] = [];
    if (q) parts.push(`“${q}”`);
    if (sourceId) parts.push(`source:${sourceId.slice(0, 8)}`);
    if (from) parts.push(`from:${from}`);
    if (to) parts.push(`to:${to}`);
    return parts.join(" · ") || "All items";
  }, [q, sourceId, from, to]);

  async function load() {
    setLoading(true);
    try {
      let query = sb.from("news_items").select("*").order("created_at", { ascending: false });

      if (q) query = query.ilike("title", `%${q}%`);
      if (sourceId) query = query.eq("source_id", sourceId);
      if (from) query = query.gte("published_at", new Date(from).toISOString());
      if (to) {
        const toEnd = new Date(to);
        toEnd.setHours(23, 59, 59, 999);
        query = query.lte("published_at", toEnd.toISOString());
      }

      const fromIdx = page * pageSize;
      const toIdx = fromIdx + pageSize - 1;
      const { data, error } = await query.range(fromIdx, toIdx);
      if (error) throw error;
      setRows((data ?? []) as any);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, sourceId, from, to, page]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">News Items</h1>
        <AdminRunWorkerButton />
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        <div className="md:col-span-2">
          <label className="block text-xs text-slate-500">Search title</label>
          <input
            value={q}
            onChange={(e) => { setPage(0); setQ(e.target.value); }}
            placeholder="e.g., earnings, election, launch"
            className="w-full border rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500">Source</label>
          <select
            className="w-full border rounded-lg px-3 py-2"
            value={sourceId}
            onChange={(e) => { setPage(0); setSourceId(e.target.value); }}
          >
            <option value="">All</option>
            {sources.map(s => (
              <option key={s.id} value={s.id}>{s.name ?? s.id.slice(0, 8)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500">From (published)</label>
          <input
            type="date"
            className="w-full border rounded-lg px-3 py-2"
            value={from}
            onChange={(e) => { setPage(0); setFrom(e.target.value); }}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500">To (published)</label>
          <input
            type="date"
            className="w-full border rounded-lg px-3 py-2"
            value={to}
            onChange={(e) => { setPage(0); setTo(e.target.value); }}
          />
        </div>
      </div>

      <div className="text-sm text-slate-500">Showing: {filtersDesc}</div>

      {/* Table */}
      <div className="overflow-auto border rounded-xl">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
              <th>Published</th>
              <th>Title</th>
              <th>Source</th>
              <th>Link</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-3 py-6 text-center">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-500">No results</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="border-t [&>td]:px-3 [&>td]:py-2">
                <td className="whitespace-nowrap">{r.published_at ? new Date(r.published_at).toLocaleString() : "—"}</td>
                <td className="max-w-[48ch]">
                  <div className="font-medium">{r.title}</div>
                  {r.summary && <div className="text-slate-500 line-clamp-2">{r.summary}</div>}
                </td>
                <td className="font-mono text-xs">{r.source_id.slice(0, 8)}</td>
                <td>
                  <a className="text-blue-600 underline" href={r.url} target="_blank" rel="noreferrer">Open</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-end gap-2">
        <button
          className="px-3 py-2 border rounded-lg"
          onClick={() => setPage(p => Math.max(p - 1, 0))}
          disabled={page === 0 || loading}
        >Prev</button>
        <div className="px-2 text-sm">Page {page + 1}</div>
        <button
          className="px-3 py-2 border rounded-lg"
          onClick={() => setPage(p => p + 1)}
          disabled={loading || rows.length < pageSize}
        >Next</button>
      </div>
    </div>
  );
}
