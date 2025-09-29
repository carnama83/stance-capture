// src/pages/Login.tsx
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

  // MFA state
  const [needsMfa, setNeedsMfa] = React.useState(false);
  const [mfaCode, setMfaCode] = React.useState("");

  // --- navigate once (prevents double redirects) ---
  const navigatedRef = React.useRef(false);
  const navigateHomeOnce = React.useCallback(() => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;

    // If we stored a return hash (HashRouter), prefer it
    const back = sessionStorage.getItem("return_to");
    if (back && back.startsWith("#/")) {
      window.location.hash = back;
      sessionStorage.removeItem("return_to");
      return;
    }
    nav("/", { replace: true });
  }, [nav]);

  // Helper: wait until getSession() returns non-null (short timeout)
  const waitForSession = React.useCallback(
    async (ms = 2000) => {
      if (!sb) return false;
      const start = Date.now();
      while (Date.now() - start < ms) {
        const { data } = await sb.auth.getSession();
        if (data.session) return true;
        await new Promise((r) => setTimeout(r, 50));
      }
      return false;
    },
    [sb]
  );

  // ---- Redirect ONLY after a fresh SIGNED_IN event (not INITIAL_SESSION) ----
  React.useEffect(() => {
    if (!sb) return;

    const { data: { subscription } } = sb.auth.onAuthStateChange(
      async (event, session) => {
        if (event === "SIGNED_IN" && session) {
          // small defer so guards see the session
          await new Promise((r) => setTimeout(r, 50));
          const ok = await waitForSession();
          if (ok) navigateHomeOnce();
        }
      }
    );

    // Prime internals; do not redirect on INITIAL_SESSION
    sb.auth.getSession().finally(() => { /* no-op */ });

    return () => subscription?.unsubscribe();
  }, [sb, waitForSession, navigateHomeOnce]);

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
        return;
      }

      // 3) If session is already available, the listener will handle redirect.
      if (data.session) setMsg("Logged in.");
      else setMsg("If email confirmation is required, please confirm and sign in again.");
    } catch (err: any) {
      setMsg(err.message || "Login failed.");
    } finally {
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

      const ok = await waitForSession();
      if (!ok) {
        setMsg("Signed in, but session not visible yet. Try reloading.");
        return;
      }

      setMsg("Logged in.");
      // Navigation handled by the auth listener (navigateHomeOnce)
    } catch (err: any) {
      setMsg(err.message || "Invalid code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen">
      {/* If you’re using the PageLayout/AppTopBar wrapper, you can wrap this content with it.
          Keeping bare content here to avoid double wrappers if you already do that. */}
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
