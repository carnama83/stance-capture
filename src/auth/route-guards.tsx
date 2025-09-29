//src/auth/route-guards.tsx

import * as React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";
import { useAuthReady } from "./AuthContext";

type Session = import("@supabase/supabase-js").Session;

export function useSession() {
  const sb = React.useMemo(getSupabase, []);
  const [session, setSession] = React.useState<Session | null>(null);

  React.useEffect(() => {
    if (!sb) return;
    // Prime current session
    sb.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    // React to changes
    const { data: { subscription } } = sb.auth.onAuthStateChange((_evt, s) => {
      setSession(s ?? null);
    });
    return () => subscription?.unsubscribe();
  }, [sb]);

  return session;
}

/** Private routes: render only when authed; otherwise redirect to /login. */
export function Protected({ children }: { children: React.ReactNode }) {
  const ready = useAuthReady();
  const session = useSession();
  const loc = useLocation();

  if (!ready) return null;
  if (!session) return <Navigate to="/login" replace state={{ from: loc }} />;
  return <>{children}</>;
}

/** Public-only routes (login/signup): render only when NOT authed; otherwise go home. */
export function PublicOnly({ children }: { children: React.ReactNode }) {
  const ready = useAuthReady();
  const session = useSession();

  if (!ready) return null;
  return session ? <Navigate to="/" replace /> : <>{children}</>;
}
