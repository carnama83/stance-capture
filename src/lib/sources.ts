// lib/sources.ts
import { supabase } from "@/lib/supabase";

export type TopicSource = {
  id: string;
  name: string;
  kind: "rss" | "api" | "social";
  endpoint: string;
  is_enabled: boolean;
  last_polled_at: string | null;
  last_status: string | null;
  last_error: string | null;
  success_count: number;
  failure_count: number;
};

export async function listSources(params?: {
  kind?: TopicSource["kind"] | null;
  enabled?: boolean | null;
  q?: string | null;
}) {
  const q = supabase.from("v_source_health").select("*");
  if (params?.kind) q.eq("kind", params.kind);
  if (params?.enabled != null) q.eq("is_enabled", params.enabled);
  if (params?.q) q.or(`name.ilike.%${params.q}%,endpoint.ilike.%${params.q}%`);
  return q.order("is_enabled", { ascending: false }).order("last_polled_at", { ascending: false, nullsFirst: false });
}

export async function createSource(values: Partial<TopicSource>) {
  return supabase.from("topic_sources").insert(values).select().single();
}

export async function updateSource(id: string, values: Partial<TopicSource>) {
  return supabase.from("topic_sources").update(values).eq("id", id).select().single();
}

export async function toggleSource(id: string, enabled: boolean) {
  return supabase.from("topic_sources").update({ is_enabled: enabled }).eq("id", id).select().single();
}

export async function deleteSource(id: string) {
  // or implement soft-delete; for now hard delete:
  return supabase.from("topic_sources").delete().eq("id", id);
}

export async function runSourceNow(id: string) {
  return supabase.rpc("admin_ingest_source", { p_source_id: id });
}
