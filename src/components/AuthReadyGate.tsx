// src/components/AuthReadyGate.tsx
import * as React from "react";
import { getSupabase } from "../lib/supabaseClient";
import { AuthReadyCtx } from "../auth/AuthContext";

/**
 * Ensures the app only renders after Supabase auth is *known*.
 * Improvements:
 * - Subscribes *before* calling getSession() to catch INITIAL_SESSION.
 * - Races INITIAL_SESSION vs getSession() and resolves on the first to return.
 * - Adds a short safety timeout so the app never hard-blocks on edge cases.
 * - Cleans up subscriptions and avoids state updates after unmount.
 */
export default function AuthReadyGate({ children }: { children: React.ReactNode }) {
  const sb = React.useMemo(getSupabase, []);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    if (!sb) {
      setReady(true);
      return;
    }

    let mounted = true;
    let resolved = false;

    const resolveReady = () => {
      if (!mounted || resolved) return;
      resolved = true;
      setReady(true);
    };

    // 1) Subscribe first — reliably catches INITIAL_SESSION / SIGNED_IN / SIGNED_OUT
    const { data: sub } = sb.auth.onAuthStateChange(() => {
      resolveReady();
    });

    // 2) Also explicitly query current session; whichever returns first wins
    sb.auth.getSession().then(resolveReady).catch(resolveReady);

    // 3) Safety net: never hard-block if SDK stalls (network, extensions, etc.)
    const timeout = setTimeout(resolveReady, 2500);

    return () => {
      mounted = false;
      clearTimeout(timeout);
      sub?.subscription?.unsubscribe?.();
    };
  }, [sb]);

  if (!ready) {
    // Minimal skeleton so users see *something* while auth initializes
    return (
      <AuthReadyCtx.Provider value={false}>
        <div style={{ padding: 12, fontSize: 14, color: "#475569" }}>Loading…</div>
      </AuthReadyCtx.Provider>
    );
  }

  return <AuthReadyCtx.Provider value={true}>{children}</AuthReadyCtx.Provider>;
}
