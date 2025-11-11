// src/auth/route-guards.tsx
import * as React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";
import { useAuthReady } from "./AuthContext";
import { ROUTES } from "@/routes/paths";

type Session = import("@supabase/supabase-js").Session;

export function useSession() {
  const sb = React.useMemo(getSupabase, []);
  const [session, setSession] = React.useState<Session | null>(null);

  React.useEffect(() => {
    if (!sb) return;
    let mounted = true;

    // Prime current session
    sb.auth.getSession().then(({ data }) => {
      if (mounted) setSession(data.session ?? null);
    });

    // React to changes
    const { data: { subscription } } = sb.auth.onAuthStateChange((_evt, s) => {
      if (mounted) setSession(s ?? null);
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [sb]);

  return session;
}

const Spinner = () => (
  <div className="p-6 text-sm text-muted-foreground" role="status" aria-live="polite">
    Loading…
  </div>
);

/** Private routes: render only when authed; otherwise redirect to /login. */
export function Protected({ children }: { children: React.ReactNode }) {
  const ready = useAuthReady();
  const session = useSession();
  const loc = useLocation();

  // While auth is initializing, don't redirect (prevents bounce)
  if (!ready) return <Spinner />;

  // After ready → if still no session, go to login and preserve intent
  if (!session) return <Navigate to={ROUTES.LOGIN} replace state={{ from: loc }} />;

  return <>{children}</>;
}

/** Public-only routes (login/signup): render only when NOT authed; otherwise go home. */
export function PublicOnly({ children }: { children: React.ReactNode }) {
  const ready = useAuthReady();
  const session = useSession();

  if (!ready) return <Spinner />;
  return session ? <Navigate to={ROUTES.HOME} replace /> : <>{children}</>;
}
