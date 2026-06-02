// src/auth/route-guards.tsx
//
// FIX (Bug #5 — PRIMARY / IMMEDIATE): readSessionFromStorage() was returning
// `true` for any token whose `expires_at` field was missing, zero, or NaN.
// The guard was `if (expiresAt && ...)` — falsy for all three cases — so it
// skipped the expiry check entirely and reported the token as valid. A stale
// token left in localStorage from a previous session (or written by
// OAuthCallbackPage's seedSessionToStorage with parseInt(undefined) → NaN)
// caused PublicOnly to treat the user as already authenticated, immediately
// bouncing them from /login back to "/" before the login page ever rendered.
// Fix: require expires_at to be a finite positive number and treat anything
// else as expired (fall through to the async getSession() validation path).
//
// FIX (Bug #4): PublicOnly now uses a short grace period before redirecting an
// authed user away from /login. Without this, when signInWithPassword() resolves,
// both Login.tsx (handleSuccessfulLogin) and PublicOnly (via useAuthStatus) receive
// the SIGNED_IN event. PublicOnly's <Navigate to="/" replace /> was firing as a
// React render, occasionally winning the race against window.location.href in
// handleSuccessfulLogin and discarding the return_to value.
//
// The fix adds a `loginGrace` flag: when status transitions from "loading" → "authed"
// while on a public-auth path, we hold at "loading" for one render tick so
// Login.tsx's synchronous window.location.href assignment can run first.

import * as React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";
import { ROUTES } from "@/routes/paths";

/** Tiny loading UI to avoid layout jumpiness while auth resolves. */
const Spinner = () => (
  <div className="p-6 text-sm text-muted-foreground" role="status" aria-live="polite">
    Loading…
  </div>
);

// ── localStorage fast-path (bypass auth mutex) ────────────────────────────────
// getSession() acquires an async lock during background token refresh.
// Reading directly from localStorage is synchronous and lock-free.
// Established pattern: see supabaseClient.ts sessionRef seed.
const PROJECT_REF = "yzxzpnomcarnxixhjlba";
const AUTH_STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

function readSessionFromStorage(): boolean {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed?.access_token) return false;

    // FIX (Bug #5): The original guard was `if (expiresAt && ...)`.
    // That is falsy when expiresAt is 0, NaN, null, or undefined — all of which
    // caused the check to be skipped and the token incorrectly marked as valid.
    // Sources of bad expiresAt values:
    //   - OAuthCallbackPage.seedSessionToStorage writes parseInt(expiresAt) where
    //     expiresAt may be undefined → parseInt(undefined) = NaN
    //   - Old session entries in localStorage written before this field was added
    //   - Any token stored without an expiry (e.g. during testing)
    //
    // Rule: if expires_at is absent or not a finite positive number, treat the
    // token as unverifiable and fall through to the async getSession() path
    // (which validates with the server). Do NOT assume it is valid.
    const expiresAtNum = Number(parsed?.expires_at);
    if (!Number.isFinite(expiresAtNum) || expiresAtNum <= 0) return false;
    if (Date.now() / 1000 > expiresAtNum) return false;

    return true;
  } catch {
    return false;
  }
}

// Routes where a newly-authed user might still be mid-redirect.
// PublicOnly will not fire its <Navigate> immediately when auth transitions
// from loading→authed on these paths; it waits one extra render tick.
const PUBLIC_AUTH_PATHS = new Set([
  ROUTES.LOGIN,
  ROUTES.SIGNUP,
  ROUTES.RESET_PASSWORD,
]);

/**
 * useAuthStatus
 * Robustly determines the user's auth state without racing:
 * - Fast path: reads session from localStorage synchronously (no lock)
 * - Subscribes to auth changes for future state transitions
 * - Falls back to getSession() for validation after fast-path resolves
 */
function useAuthStatus(): "loading" | "authed" | "anon" {
  const sb = React.useMemo(getSupabase, []);

  // ── Synchronous fast-path initialisation ───────────────────────────────────
  // Seed from localStorage so Protected routes never flash the spinner
  // when a valid session already exists in storage.
  const [status, setStatus] = React.useState<"loading" | "authed" | "anon">(() => {
    const hasSession = readSessionFromStorage();
    return hasSession ? "authed" : "loading";
  });

  React.useEffect(() => {
    if (!sb) {
      setStatus("anon");
      return;
    }
    let mounted = true;
    let resolved = status === "authed"; // already resolved if fast-path found session

    const resolve = (s: "authed" | "anon") => {
      if (!mounted) return;
      resolved = true;
      setStatus(s);
    };

    // 1) Subscribe to auth changes — handles login, logout, token refresh
    const { data: sub } = sb.auth.onAuthStateChange((_evt, session) => {
      if (!mounted) return;
      resolve(session ? "authed" : "anon");
    });

    // 2) If fast-path did NOT find a session, also call getSession() as fallback
    //    (handles edge cases where localStorage is stale but session is valid)
    if (!resolved) {
      sb.auth.getSession()
        .then(({ data }) => resolve(data.session ? "authed" : "anon"))
        .catch(() => resolve("anon"));

      // Safety net: never hang indefinitely
      const timeout = setTimeout(() => resolve("anon"), 3000);

      return () => {
        mounted = false;
        clearTimeout(timeout);
        sub?.subscription?.unsubscribe?.();
      };
    }

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, [sb]);

  return status;
}

/** Private routes: render only when authed; show spinner while loading; redirect to login if anon. */
export function Protected({ children }: { children: React.ReactNode }) {
  const status = useAuthStatus();
  const loc = useLocation();

  if (status === "loading") return <Spinner />;
  if (status === "anon") {
    return <Navigate to={ROUTES.LOGIN} replace state={{ from: loc }} />;
  }
  return <>{children}</>;
}

/**
 * PublicOnly — render only when NOT authed.
 *
 * Shows spinner while loading. If authed and on a public-auth path (login,
 * signup, reset-password), defers for one render tick before redirecting home.
 * This gives Login.tsx's synchronous window.location.href assignment time to
 * run first, so return_to is always consumed correctly before we navigate away.
 */
export function PublicOnly({ children }: { children: React.ReactNode }) {
  const status = useAuthStatus();
  const loc = useLocation();

  // One-tick grace period flag: set when we first detect authed on a login path.
  // Cleared immediately in the next useLayoutEffect, by which point Login.tsx
  // has already called window.location.href and the page is navigating away.
  const [graceActive, setGraceActive] = React.useState(false);

  const isLoginPath = PUBLIC_AUTH_PATHS.has(loc.pathname as any);

  React.useLayoutEffect(() => {
    if (status === "authed" && isLoginPath && !graceActive) {
      // Activate grace for exactly one render cycle.
      setGraceActive(true);
    }
    if (graceActive) {
      // Clear on the very next layout effect — one tick is enough.
      setGraceActive(false);
    }
  }, [status, isLoginPath]); // eslint-disable-line react-hooks/exhaustive-deps

  if (status === "loading" || graceActive) return <Spinner />;
  if (status === "authed") return <Navigate to={ROUTES.HOME} replace />;
  return <>{children}</>;
}
