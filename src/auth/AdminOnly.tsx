import * as React from "react";
import { getSupabase } from "../lib/supabaseClient";

// Option C backend: we created `admin_users` and `is_admin_me()` in SQL.
// This component asks the DB if the current user is admin.
export default function AdminOnly({ children }: { children: React.ReactNode }) {
  const sb = React.useMemo(getSupabase, []);
  const [loading, setLoading] = React.useState(true);
  const [isAdmin, setIsAdmin] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!sb) throw new Error("Supabase not initialized");
        const { data, error } = await sb.rpc("is_admin_me");
        if (error) throw error;
        if (alive) setIsAdmin(!!data);
      } catch (e: any) {
        if (alive) setErr(e?.message || "Failed to check admin status");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [sb]);

  if (loading) return null; // or a tiny spinner
  if (err) {
    return (
      <div className="mx-auto max-w-lg p-6 text-sm text-slate-700">
        <h2 className="text-base font-semibold mb-2">Error</h2>
        <p>{err}</p>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg p-6 text-sm text-slate-700">
        <h2 className="text-base font-semibold mb-2">No access</h2>
        <p>Ask an administrator to grant you access to admin pages.</p>
      </div>
    );
  }
  return <>{children}</>;
}
