// src/pages/Login.tsx
// PRODUCTION VERSION: Clean, simple, reliable auth flow

import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";

export default function Login() {
  const sb = React.useMemo(getSupabase, []);
  const navigate = useNavigate();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // MFA state
  const [needsMfa, setNeedsMfa] = React.useState(false);
  const [mfaCode, setMfaCode] = React.useState("");

  // ✅ PRODUCTION FIX: Simple, clean redirect handling
  const handleSuccessfulLogin = React.useCallback(() => {
    const returnTo = sessionStorage.getItem("return_to");
    
    if (returnTo && returnTo.startsWith("#/")) {
      // Hash router
      sessionStorage.removeItem("return_to");
      window.location.hash = returnTo;
    } else if (returnTo && returnTo.startsWith("/")) {
      // Regular path
      sessionStorage.removeItem("return_to");
      navigate(returnTo, { replace: true });
    } else {
      // Default: go home
      navigate("/", { replace: true });
    }
  }, [navigate]);

  // ✅ Auth listener - only redirect on SIGNED_IN event
  React.useEffect(() => {
    if (!sb) return;

    const { data: { subscription } } = sb.auth.onAuthStateChange(
      (event, session) => {
        // Only handle fresh sign-ins, not initial page load
        if (event === "SIGNED_IN" && session) {
          handleSuccessfulLogin();
        }
      }
    );

    return () => subscription?.unsubscribe();
  }, [sb, handleSuccessfulLogin]);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!sb) return setMsg("Supabase is OFF (check env).");

    try {
      setBusy(true);

      // 1) Primary auth
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;

      // 2) MFA needed?
      const aal = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal.error) throw aal.error;
      if (aal.data.currentLevel === "aal1" && aal.data.nextLevel === "aal2") {
        setNeedsMfa(true);
        setMsg("Enter the code from your authenticator app.");
        setBusy(false);
        return;
      }

      // 3) Success - auth listener will handle redirect
      // Just show message and keep loading state
      if (data.session) {
        setMsg("Logged in. Redirecting...");
        // Don't set busy to false - let redirect happen
      } else {
        setMsg("If email confirmation is required, please confirm and sign in again.");
        setBusy(false);
      }
    } catch (err: any) {
      setMsg(err.message || "Login failed.");
      setBusy(false);
    }
  }

  async function verifyMfa() {
    if (!sb) return setMsg("Supabase is OFF (check env).");
    setMsg(null);

    try {
      setBusy(true);

      // Choose a TOTP factor
      const lf = await sb.auth.mfa.listFactors();
      if (lf.error) throw lf.error;
      const factor = lf.data.totp?.[0];
      if (!factor) throw new Error("No authenticator factors found.");

      // Challenge + verify
      const ch = await sb.auth.mfa.challenge({ factorId: factor.id });
      if (ch.error) throw ch.error;
      const vr = await sb.auth.mfa.verify({
        factorId: factor.id,
        challengeId: ch.data.id,
        code: mfaCode.trim(),
      });
      if (vr.error) throw vr.error;

      setMsg("Logged in. Redirecting...");
      // Auth listener will handle redirect
    } catch (err: any) {
      setMsg(err.message || "Invalid code. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen">
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

        {/* MFA prompt */}
        {needsMfa && (
          <div className="rounded border p-3 space-y-2">
            <div className="text-sm">Enter the 6-digit code from your authenticator app.</div>
            <input
              inputMode="numeric"
              maxLength={8}
              className="w-full border rounded px-3 py-2"
              placeholder="123456"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.trim())}
            />
            <div className="flex gap-2">
              <button
                className="rounded bg-slate-900 text-white px-4 py-2"
                onClick={verifyMfa}
                disabled={busy || mfaCode.length < 6}
              >
                {busy ? "Verifying…" : "Verify"}
              </button>
              <button
                className="rounded border px-4 py-2"
                onClick={() => {
                  setNeedsMfa(false);
                  setMfaCode("");
                  setMsg(null);
                }}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {msg && <p className="text-sm text-slate-700">{msg}</p>}

        <div className="text-sm">
          <Link className="underline" to="/reset-password">
            Forgot password?
          </Link>
        </div>
      </div>
    </div>
  );
}
