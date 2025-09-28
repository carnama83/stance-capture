//src/components/AuthReadyGate.tsx
import * as React from "react";
import { getSupabase } from "../lib/supabaseClient";

export default function AuthReadyGate({ children }: { children: React.ReactNode }) {
  const sb = React.useMemo(getSupabase, []);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    if (!sb) return;
    const { data: { subscription } } = sb.auth.onAuthStateChange(() => {
      setReady(true);                // fires on INITIAL_SESSION
    });
    sb.auth.getSession().finally(() => {}); // prime the event
    return () => subscription?.unsubscribe();
  }, [sb]);

  if (!ready) return null;           // or a tiny loader
  return <>{children}</>;
}
