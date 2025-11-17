import { useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL!;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY!;
const sb = createClient(supabaseUrl, supabaseAnonKey);

export default function AdminRunWorkerButton({ className = "" }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const { data, error } = await sb.functions.invoke("admin-run-worker", { body: {} });
      if (error) throw error;
      setMsg(JSON.stringify(data));
    } catch (e: any) {
      setMsg(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        onClick={run}
        disabled={busy}
        className="px-3 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {busy ? "Processing…" : "Process now"}
      </button>
      {msg && <span className="text-xs text-slate-600 break-all">{msg}</span>}
    </div>
  );
}
