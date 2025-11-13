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

/**
 * useAuthStatus
 * Robustly determines the user's auth state without racing:
 * - Subscribes to auth changes BEFORE calling getSession()
 * - Resolves to one of: "loading" | "authed" | "anon"
 */
function useAuthStatus(): "loading" | "authed" | "anon" {
  const sb = React.useMemo(getSupabase, []);
  const [status, setStatus] = React.useState<"loading" | "authed" | "anon">("loading");

  React.useEffect(() => {
    if (!sb) {
      setStatus("anon");
      return;
    }
    let mounted = true;
    let resolved = false;

    const resolve = (s: "authed" | "anon") => {
      if (!mounted || resolved) return;
      resolved = true;
      setStatus(s);
    };

    // 1) Subscribe first to catch INITIAL_SESSION immediately
    const { data: sub } = sb.auth.onAuthStateChange((_evt, session) => {
      resolve(session ? "authed" : "anon");
    });

    // 2) Also query current session; whichever finishes first wins
    sb.auth.getSession()
      .then(({ data }) => resolve(data.session ? "authed" : "anon"))
      .catch(() => resolve("anon"));

    // 3) Safety net: never hang indefinitely
    const timeout = setTimeout(() => resolve("anon"), 3000);

    return () => {
      mounted = false;
      clearTimeout(timeout);
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
    // preserve intended location to return after login
    return <Navigate to={ROUTES.LOGIN} replace state={{ from: loc }} />;
  }
  // authed
  return <>{children}</>;
}

/** Public-only routes: render only when NOT authed; show spinner while loading; redirect home if authed. */
export function PublicOnly({ children }: { children: React.ReactNode }) {
  const status = useAuthStatus();

  if (status === "loading") return <Spinner />;
  if (status === "authed") return <Navigate to={ROUTES.HOME} replace />;
  // anon
  return <>{children}</>;
}
