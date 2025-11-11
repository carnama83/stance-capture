// supabase/functions/ingest/logic.ts
export async function run(ctx: { func: string; traceId: string }) {
  // Your existing logic; return any useful stats (numbers/arrays)
  // e.g., return { inserted: 120, skipped: 7 }
  return { ok: true };
}
