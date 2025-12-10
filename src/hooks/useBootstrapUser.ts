// src/hooks/useBootstrapUser.ts
import { useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Local client just for bootstrapping
const sb = createClient(supabaseUrl, supabaseAnonKey);

export function useBootstrapUser() {
  useEffect(() => {
    let isMounted = true;

    // Case 1: App loads & session already exists
    const checkInitial = async () => {
      try {
        const { data } = await sb.auth.getSession();
        if (!isMounted) return;

        if (data.session?.user) {
          await sb.rpc("bootstrap_user_after_login");
        }
      } catch (err) {
        console.error("bootstrap_user_after_login (initial) failed:", err);
      }
    };

    checkInitial();

    // Case 2: User logs in / session changes
    const { data: subscription } = sb.auth.onAuthStateChange(
      (_event, session) => {
        if (session?.user) {
          sb
            .rpc("bootstrap_user_after_login")
            .catch((err) =>
              console.error(
                "bootstrap_user_after_login (auth state change) failed:",
                err
              )
            );
        }
      }
    );

    return () => {
      isMounted = false;
      subscription?.subscription?.unsubscribe?.();
    };
  }, []);
}
