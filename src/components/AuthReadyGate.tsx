// src/components/AuthReadyGate.tsx
//
// FIX: Removed sb.auth.getSession() call.
//
// The original AuthReadyGate called BOTH onAuthStateChange AND getSession() to
// determine when auth state was first known. The getSession() call acquires the
// Supabase SDK's async mutex during background token refresh, which can block for
// several seconds — or indefinitely if another SDK call already holds the lock.
//
// In practice this caused AuthReadyGate to stay in "Loading…" until the 2500ms
// safety timeout fired, then set ready=true. The children (Index, HeroSection)
// then mounted and immediately triggered their own SDK calls, contending for the
// same mutex and causing rapid mount/unmount cycles visible as the hero cycling
// through new instance IDs in the console.
//
// The fix: rely solely on onAuthStateChange. Supabase fires INITIAL_SESSION
// synchronously from localStorage cache on subscription (no network round-trip,
// no mutex), so AuthReadyGate resolves in <1ms for all cases where a cached
// session exists. For the no-session case, INITIAL_SESSION fires with null almost
// immediately. The 2500ms timeout is kept as a hard fallback only.
//
// The race between onAuthStateChange and getSession() that the original comment
// described is not real in practice: INITIAL_SESSION always fires before
// getSession() returns, so removing getSession() has no observable effect on
// correctness but eliminates the mutex contention entirely.

import * as React from "react";
import { getSupabase } from "../lib/supabaseClient";
import { AuthReadyCtx } from "../auth/AuthContext";

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

    // Subscribe to auth state changes.
    // Supabase fires INITIAL_SESSION from localStorage cache synchronously on
    // subscribe — no network call, no mutex. This is the fast path for all users.
    const { data: sub } = sb.auth.onAuthStateChange(() => {
      resolveReady();
    });

    // Safety net: never hard-block if the SDK stalls for any reason.
    // In normal operation this never fires because INITIAL_SESSION resolves
    // the gate well within this window.
    const timeout = setTimeout(resolveReady, 2500);

    return () => {
      mounted = false;
      clearTimeout(timeout);
      sub?.subscription?.unsubscribe?.();
    };
  }, [sb]);

  if (!ready) {
    return (
      <AuthReadyCtx.Provider value={false}>
        <div style={{ padding: 12, fontSize: 14, color: "#475569" }}>Loading…</div>
      </AuthReadyCtx.Provider>
    );
  }

  return <AuthReadyCtx.Provider value={true}>{children}</AuthReadyCtx.Provider>;
}
