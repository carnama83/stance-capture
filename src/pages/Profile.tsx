import * as React from "react";
import { Link } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";

export default function Profile() {
  const sb = React.useMemo(getSupabase, []);
  const [row, setRow] = React.useState<any>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      if (!sb) return setMsg("Supabase is OFF (check env).");
      try {
        setBusy(true);
        const uid = (await sb.auth.getUser()).data.user?.id;
        if (!uid) {
          setMsg("Not logged in.");
          setBusy(false);
          return;
        }
        const { data, error } = await sb.from("profiles").select("*").eq("user_id", uid).maybeSingle();
        if (error) throw error;
        setRow(data);
      } catch (e: any) {
        setMsg(e.message);
      } finally {
        setBusy(false);
      }
    })();
  }, [sb]);

  const handle = row?.display_handle_mode === "username"
    ? (row?.username || row?.random_id)
    : row?.random_id;

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-4">
      <h1 className="text-2xl font-bold">My Profile</h1>

      {msg && <p className="text-sm text-slate-700">{msg}</p>}
      {busy && <div className="text-sm">Loading…</div>}

      {row && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <img
              src={row.avatar_url || "https://placehold.co/64x64"}
              className="h-16 w-16 rounded-full object-cover"
              alt={handle ? `Avatar of @${handle}` : "Avatar"}
            />
            <div>
              <div className="text-lg font-semibold">@{handle || "unknown"}</div>
              <div className="text-sm text-slate-600">{row.bio || "No bio yet."}</div>
            </div>
          </div>

          <div className="mt-4 text-sm">
            <Link to="/settings/profile" className="underline">
              Edit profile →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
