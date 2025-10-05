/* =============================
File: src/lib/createSupabase.ts
============================= */
import { createClient as _create } from "@supabase/supabase-js";


export function createSupabase() {
const url = (import.meta as any).env.VITE_SUPABASE_URL as string;
const anon = (import.meta as any).env.VITE_SUPABASE_ANON_KEY as string;
if (!url || !anon) {
console.warn("Supabase env missing — Admin pages will not function without auth.");
}
return _create(url, anon, { auth: { persistSession: true, autoRefreshToken: true } });
}
