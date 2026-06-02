// src/auth/route-guards.tsx
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
    // Check token exists and is not expired
    if (!parsed?.access_token) return false;
    const expiresAt = parsed?.expires_at;
    if (expiresAt && Date.now() / 1000 > expiresAt) return false;
    return true;
  } catch {
    return false;
  }
}

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

/** Public-only routes: render only when NOT authed; show spinner while loading; redirect home if authed. */
export function PublicOnly({ children }: { children: React.ReactNode }) {
  const status = useAuthStatus();

  if (status === "loading") return <Spinner />;
  if (status === "authed") return <Navigate to={ROUTES.HOME} replace />;
  return <>{children}</>;
}
