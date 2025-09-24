
- export function getSupabase() {
-   try {
-     const { createClient } = require("@supabase/supabase-js");
-     const url =
-       (typeof process !== "undefined" ? (process as any).env?.NEXT_PUBLIC_SUPABASE_URL : undefined) ||
-       (globalThis as any)?.NEXT_PUBLIC_SUPABASE_URL;
-     const key =
-       (typeof process !== "undefined" ? (process as any).env?.NEXT_PUBLIC_SUPABASE_ANON_KEY : undefined) ||
-       (globalThis as any)?.NEXT_PUBLIC_SUPABASE_ANON_KEY;
-     return url && key ? createClient(url, key) : null;
-   } catch {
-     return null;
-   }
- }
+ import { createClient } from "@supabase/supabase-js";
+
+ export function getSupabase() {
+   try {
+     const url =
+       import.meta.env.VITE_SUPABASE_URL ||
+       (globalThis as any)?.VITE_SUPABASE_URL; // optional fallback
+     const key =
+       (import.meta.env.VITE_SUPABASE_ANON_KEY ??
+        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) || // support your current name
+       (globalThis as any)?.VITE_SUPABASE_ANON_KEY ||
+       (globalThis as any)?.VITE_SUPABASE_PUBLISHABLE_KEY;
+     return url && key ? createClient(url, key) : null;
+   } catch {
+     return null;
+   }
+ }
