// src/hooks/useBootstrapUser.ts
import { useEffect } from "react";
import { getSupabaseClient } from "@/client/supabaseClient"; // adjust path to your helper

export function useBootstrapUser() {
  useEffect(() => {
    const supabase = getSupabaseClient();

    // 1) Run once on mount if there is already a session
    supabase.auth.getSession().then(({ data }) => {
      const session = data.session;
      if (!session?.user) return;

      supabase
        .rpc("bootstrap_user_after_login")
        .catch((err) => console.error("bootstrap_user_after_login (initial) failed", err));
    });

    // 2) Subscribe to auth state changes (login / logout)
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session?.user) return;

        supabase
          .rpc("bootstrap_user_after_login")
          .catch((err) => console.error("bootstrap_user_after_login (onAuthStateChange) failed", err));
      }
    );

    return () => {
      subscription?.subscription?.unsubscribe?.();
    };
  }, []);
}
