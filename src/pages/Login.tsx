import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";

export default function Login() {
  const sb = React.useMemo(getSupabase, []);
  const nav = useNavigate();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!sb) return setMsg("Supabase is OFF (check env).");
    try {
      setBusy(true);
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;

      // Optional touch last_seen_at; ignore errors
      try {
        const uid = (await sb.auth.getUser()).data.user?.id;
        if (uid) {
          await sb.from("users").update({ last_seen_at: new Date().toISOString() }).eq("id", uid);
        }
      } catch {}

      setMsg("Logged in.");
      nav("/profile");
    } catch (err: any) {
      setMsg(err.message || "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-2xl font-bold">Log in</h1>

      <form className="space-y-4" onSubmit={onLogin}>
        <input
          type="email"
          className="w-full border rounded px-3 py-2"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <input
          type="password"
          className="w-full border rounded px-3 py-2"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <button
          type="submit"
          className="w-full rounded bg-slate-900 text-white py-2"
          disabled={busy}
        >
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>

      {msg && <p className="text-sm text-slate-700">{msg}</p>}

      <div className="text-sm">
        <Link className="underline" to="/reset-password">
          Forgot password?
        </Link>
      </div>
    </div>
  );
}
