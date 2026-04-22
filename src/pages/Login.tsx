// src/pages/Login.tsx
// UPDATED VERSION: Uses consistent PageLayout with AppTopBar

import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";
import PageLayout from "../components/PageLayout";
import SocialAuthButtons from "../auth/SocialAuthButtons";

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

  // EMAIL CONFIRMATION BANNER: detect ?confirmed=1 in hash query string.
  // HashRouter puts query params inside window.location.hash, e.g.:
  //   /#/login?confirmed=1  →  hash = "#/login?confirmed=1"
  const [emailConfirmed, setEmailConfirmed] = React.useState(() => {
    const hash = window.location.hash; // e.g. "#/login?confirmed=1"
    const qIndex = hash.indexOf("?");
    if (qIndex === -1) return false;
    const params = new URLSearchParams(hash.slice(qIndex + 1));
    return params.get("confirmed") === "1";
  });

  // ✅ PRODUCTION FIX: Simple, clean redirect handling
  const handleSuccessfulLogin = React.useCallback(() => {
    const returnTo = sessionStorage.getItem("return_to");
    sessionStorage.removeItem("return_to");

    if (returnTo && (returnTo.startsWith("#/") || returnTo.startsWith("/"))) {
      // For specific return destinations, use location.href for a full reload
      // so the target page initialises fresh with the new auth state.
      const dest = returnTo.startsWith("#/")
        ? returnTo  // hash path — assign directly to hash
        : returnTo;
      window.location.href = `/#${dest.startsWith("/") ? dest : dest.slice(1)}`;
    } else {
      // Default: full reload to home so feed re-fetches with auth context
      window.location.href = "/";
    }
  }, []);

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
      }
    } catch (e: any) {
      setMsg(e.message || "Login failed");
      setBusy(false);
    }
  }

  async function verifyMfa() {
    setMsg(null);
    if (!sb) return setMsg("Supabase is OFF (check env).");
    if (!mfaCode || mfaCode.length < 6)
      return setMsg("Code must be at least 6 digits.");

    try {
      setBusy(true);

      const challengeResp = await sb.auth.mfa.challenge({ factorId: "your-factor-id" });
      if (challengeResp.error) throw challengeResp.error;

      const verifyResp = await sb.auth.mfa.verify({
        factorId: "your-factor-id",
        challengeId: challengeResp.data.id,
        code: mfaCode,
      });
      if (verifyResp.error) throw verifyResp.error;

      setMsg("MFA verified. Redirecting...");
      // Auth listener will handle redirect
    } catch (e: any) {
      setMsg(e.message || "MFA verification failed");
      setBusy(false);
    }
  }

  return (
    <PageLayout>
      <div className="mx-auto max-w-md p-6 space-y-4">
        <h1 className="text-2xl font-bold">Log in</h1>

        {/* EMAIL CONFIRMATION BANNER */}
        {emailConfirmed && (
          <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            <span className="mt-0.5">✓</span>
            <div>
              <span className="font-medium">Email confirmed!</span> Your account is verified. Log in below to continue setting up your profile.
            </div>
            <button
              type="button"
              className="ml-auto text-green-600 hover:text-green-800 leading-none"
              onClick={() => setEmailConfirmed(false)}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

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

        {/* Social login */}
        <SocialAuthButtons
          mode="login"
          onError={(e) => setMsg(e)}
        />

        <div className="text-sm text-center text-slate-600">
          Don't have an account?{" "}
          <Link className="underline text-slate-900" to="/signup">
            Sign up
          </Link>
        </div>
      </div>
    </PageLayout>
  );
}
