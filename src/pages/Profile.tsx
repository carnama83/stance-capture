import * as React from "react";
import { getSupabase } from "../lib/supabaseClient";

export default function Profile() {
  const sb = React.useMemo(getSupabase, []);
  const [row, setRow] = React.useState<any>(null);
  const [msg, setMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      if (!sb) return setMsg("Supabase is OFF");
      try {
        const uid = (await sb.auth.getUser()).data.user?.id;
        if (!uid) setMsg("Not logged in. Showing anonymous preview.");
        const { data, error } = await sb.from("profiles").select("*").eq("user_id", uid).maybeSingle();
        if (error) throw error;
        setRow(data);
      } catch (err: any) {
        setMsg(err.message);
      }
    })();
  }, [sb]);

  const handle = row?.display_handle_mode === "username"
    ? (row?.username || row?.random_id)
    : row?.random_id;

  return (
    <div className="mx-auto max-w-xl p-6 space-y-3">
      <h1 className="text-xl font-semibold">Profile</h1>
      {msg && <p className="text-sm">{msg}</p>}
      {row ? (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <img src={row.avatar_url || "https://placehold.co/64x64"} className="h-16 w-16 rounded-full object-cover" alt="avatar" />
            <div>
              <div className="text-lg font-semibold">@{handle}</div>
              <div className="text-sm text-slate-600">{row.bio || "No bio yet."}</div>
            </div>
          </div>
        </div>
      ) : <div className="text-sm">Loading…</div>}
    </div>
  );
}
