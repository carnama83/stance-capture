import * as React from "react";
import { Link } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";

export default function ResetPassword() {
  const sb = React.useMemo(getSupabase, []);

  const [email, setEmail] = React.useState("");
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onReset(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!sb) return setMsg("Supabase is OFF (check env).");
    try {
      setBusy(true);
      const redirectTo = window.location.origin + "/#/login"; // HashRouter-safe redirect
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      setMsg("Password reset email sent. Check your inbox.");
    } catch (err: any) {
      setMsg(err.message || "Failed to send reset email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-2xl font-bold">Reset password</h1>

      <form className="space-y-4" onSubmit={onReset}>
        <input
          type="email"
          className="w-full border rounded px-3 py-2"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <button
          type="submit"
          className="w-full rounded bg-slate-900 text-white py-2"
          disabled={busy}
        >
          {busy ? "Sending…" : "Send reset link"}
        </button>
      </form>

      {msg && <p className="text-sm text-slate-700">{msg}</p>}
      <p className="text-sm">
        Remembered your password?{" "}
        <Link to="/login" className="underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
