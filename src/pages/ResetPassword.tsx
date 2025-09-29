// src/pages/ResetPassword.tsx
import * as React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";
import PageLayout from "../components/PageLayout";
import { userMessageFromError } from "../lib/errors";

export default function ResetPassword() {
  const sb = React.useMemo(getSupabase, []);
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  const params = React.useMemo(() => new URLSearchParams(loc.hash.replace(/^#\/?|\?/g, "")), [loc.hash]);
  // Supabase sends access_token & type=recovery in the hash for the magic link
  const isRecovery = params.get("type") === "recovery";

  async function requestReset(e: React.FormEvent) {
    e.preventDefault();
    if (!sb) return setMsg("Supabase is OFF.");
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}${window.location.pathname}#/reset-password`,
      });
      if (error) throw error;
      setMsg("Check your email for the reset link.");
    } catch (e) {
      setMsg(userMessageFromError(e));
    } finally {
      setBusy(false);
    }
  }

  async function setNewPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!sb) return setMsg("Supabase is OFF.");
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
      setMsg("Password updated. You can log in now.");
      nav("/login", { replace: true });
    } catch (e) {
      setMsg(userMessageFromError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageLayout>
      <div className="mx-auto max-w-md p-6 space-y-4">
        <h1 className="text-2xl font-bold">Reset password</h1>

        {!isRecovery ? (
          <form className="space-y-4" onSubmit={requestReset}>
            <input
              type="email"
              className="w-full border rounded px-3 py-2"
              placeholder="Your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button className="w-full rounded bg-slate-900 text-white py-2" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={setNewPassword}>
            <input
              type="password"
              className="w-full border rounded px-3 py-2"
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button className="w-full rounded bg-slate-900 text-white py-2" disabled={busy}>
              {busy ? "Updating…" : "Set new password"}
            </button>
          </form>
        )}

        {msg && <p className="text-sm text-slate-700">{msg}</p>}
      </div>
    </PageLayout>
  );
}
