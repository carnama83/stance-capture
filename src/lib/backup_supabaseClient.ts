// src/lib/supabaseClient.ts
export function getSupabase() {
  try {
    const { createClient } = require("@supabase/supabase-js");
    const url =
      (typeof process !== "undefined" ? (process as any).env?.NEXT_PUBLIC_SUPABASE_URL : undefined) ||
      (globalThis as any)?.NEXT_PUBLIC_SUPABASE_URL;
    const key =
      (typeof process !== "undefined" ? (process as any).env?.NEXT_PUBLIC_SUPABASE_ANON_KEY : undefined) ||
      (globalThis as any)?.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return url && key ? createClient(url, key) : null;
  } catch {
    return null;
  }
}
