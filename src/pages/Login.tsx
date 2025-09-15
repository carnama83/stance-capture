import * as React from "react";
import { getSupabase } from "../lib/supabaseClient";
import { Link } from "react-router-dom";

export default function Login() {
  const sb = React.useMemo(getSupabase, []);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!sb) return setMsg("Supabase is OFF");
    try {
      setBusy(true);
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // Optional: touch last_seen_at
      try {
        const uid = (await sb.auth.getUser()).data.user?.id;
        await sb.from("users").update({ last_seen_at: new Date().toISOString() }).eq("id", uid);
      } catch {}
      setMsg("Logged in.");
    } catch (err: any) {
      setMsg(err.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md p-6 space-y-3">
      <h1 className="text-xl font-semibold">Log in</h1>
      <form onSubmit={onLogin} className="space-y-3">
        <input className="w-full border rounded px-3 py-2" type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required />
        <input className="w-full border rounded px-3 py-2" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} required />
        <button className="rounded bg-slate-900 text-white px-4 py-2" disabled={busy}>{busy ? "Logging in…" : "Log in"}</button>
      </form>
      <div className="text-sm"><Link className="underline" to="/reset-password">Forgot password?</Link></div>
      {msg && <p className="text-sm text-slate-700">{msg}</p>}
    </div>
  );
}
