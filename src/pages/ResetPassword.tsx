import * as React from "react";
import { getSupabase } from "../lib/supabaseClient";

export default function ResetPassword() {
  const sb = React.useMemo(getSupabase, []);
  const [email, setEmail] = React.useState("");
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onReset(e: React.FormEvent) {
    e.preventDefault();
    if (!sb) return setMsg("Supabase is OFF");
    try {
      setBusy(true);
      const redirectTo = window.location.origin + "/login";
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      setMsg("Password reset email sent.");
    } catch (err: any) {
      setMsg(err.message || "Failed to send reset email");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md p-6 space-y-3">
      <h1 className="text-xl font-semibold">Reset password</h1>
      <form onSubmit={onReset} className="space-y-3">
        <input className="w-full border rounded px-3 py-2" type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required />
        <button className="rounded bg-slate-900 text-white px-4 py-2" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
      </form>
      {msg && <p className="text-sm text-slate-700">{msg}</p>}
    </div>
  );
}
