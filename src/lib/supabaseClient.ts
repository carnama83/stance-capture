// src/lib/supabaseClient.ts
// Singleton Supabase client — only ONE instance must exist in the app.
// detectSessionInUrl is DISABLED because this app uses HashRouter, which
// produces /#/auth/callback#access_token=... — a double-hash that Supabase
// cannot auto-parse. OAuthCallbackPage handles token extraction manually.
//
// Reads credentials from src/lib/env.ts — never reads import.meta.env directly.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, IS_DEV } from "@/lib/env";

console.log("[ENV CHECK]", {
  mode: import.meta.env.MODE,
  url: SUPABASE_URL,
  keyPresent: Boolean(SUPABASE_ANON_KEY),
});

let cached: SupabaseClient | null = null;
let warned = false;

export function getSupabase(): SupabaseClient | null {
  if (cached) return cached;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    if (!warned && IS_DEV) {
      console.warn(
        "[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.\n" +
        "Create a .env.development file — see .env.development.example for the template."
      );
      warned = true;
    }
    return null;
  }

  cached = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // CRITICAL: must be false for HashRouter apps.
      // Supabase cannot parse /#/auth/callback#access_token=... (double-hash).
      // OAuthCallbackPage calls setSession() manually after extracting the token.
      detectSessionInUrl: false,
      flowType: "implicit",
      // Pass-through lock: avoids the @supabase/auth-js navigator.locks deadlock
      // where a request hangs after the tab regains focus (visibility-triggered
      // token refresh holding the Web Lock). Single-user app: no cross-tab lock needed.
      lock: async (_name: string, _acquireTimeout: number, fn: () => Promise<any>) => fn(),
    },
  });

  return cached;
}
