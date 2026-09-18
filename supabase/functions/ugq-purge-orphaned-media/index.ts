// supabase/functions/ugq-purge-orphaned-media/index.ts
//
// UGQ-O3: reaper for UGQ media that no proposal ever claimed.
//
// Why orphans exist at all, and why this is a reaper rather than a "fix":
// ugq-transcribe-voice has to PERSIST the audio before it can transcribe it,
// but the path is only claimed when the proposer goes on to submit
// (ugq-submit writes user_question_proposals.voice_recording_path). Every
// abandoned recording and every re-record therefore leaves an object behind.
// That ordering is inherent -- you cannot transcribe a file you have not
// stored -- so the answer is retention with a sweeper, not a code change that
// avoids the upload.
//
// Measured on Dev before this existed: 46 of 56 voice objects orphaned, the
// newest from the same day, i.e. an actively growing leak rather than historic
// residue.
//
// Deletion goes through the Storage API, NOT a DELETE against storage.objects:
// removing the row would leave the underlying S3 blob behind, still stored and
// still billed, just unreachable. That is a worse state than the leak.
//
// SAFETY
//   - Only ever deletes objects NOT referenced by any proposal row.
//   - Never touches an object younger than p_min_age_hours (default 24), so a
//     recording being made right now is not swept out from under its proposer.
//   - dry_run defaults to TRUE. It has to be asked explicitly to delete.
//
// Auth: x-cron-secret must match CRON_SECRET (same contract as the other
// cron-invoked functions).
//
// Body: { "dry_run": boolean (default true), "min_age_hours": number (default 24) }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

const VOICE_BUCKET = "ugq-voice-recordings";

function restHeaders(extra: Record<string, string> = {}) {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function restGet(path: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: restHeaders() });
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  return await res.json();
}

// Storage's own delete endpoint, so the blob goes too.
async function storageRemove(bucket: string, paths: string[]): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
    method: "DELETE",
    headers: restHeaders(),
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!res.ok) {
    throw new Error(`storage delete failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run !== false;            // default TRUE
  const minAgeHours = Number.isFinite(body?.min_age_hours) ? Number(body.min_age_hours) : 24;

  try {
    // Every path any proposal points at. Read in full rather than per-object:
    // the table is small, and one round trip beats N.
    const proposals = await restGet(
      "user_question_proposals?select=voice_recording_path&voice_recording_path=not.is.null",
    );
    const claimed = new Set<string>();
    for (const p of proposals) {
      const v = p.voice_recording_path;
      if (typeof v === "string" && v.trim()) claimed.add(v.trim());
    }

    const cutoff = new Date(Date.now() - minAgeHours * 3600_000).toISOString();

    // storage.objects is exposed over PostgREST under the storage schema only
    // when configured; list through the Storage API instead, which always is.
    const listRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${VOICE_BUCKET}`, {
      method: "POST",
      headers: restHeaders(),
      body: JSON.stringify({ prefix: "", limit: 1000, sortBy: { column: "created_at", order: "asc" } }),
    });
    if (!listRes.ok) {
      throw new Error(`storage list failed: ${listRes.status} ${(await listRes.text()).slice(0, 300)}`);
    }
    const objects = await listRes.json();

    const orphans: string[] = [];
    const keptClaimed: string[] = [];
    const keptTooNew: string[] = [];

    for (const o of objects) {
      if (!o?.name) continue;                       // folder placeholder
      const isClaimed = claimed.has(o.name) ||
        [...claimed].some((c) => o.name.endsWith(c) || c.endsWith(o.name));
      if (isClaimed) { keptClaimed.push(o.name); continue; }
      if ((o.created_at ?? "") > cutoff) { keptTooNew.push(o.name); continue; }
      orphans.push(o.name);
    }

    let deleted = 0;
    if (!dryRun && orphans.length) {
      // Chunked: one oversized DELETE body that fails takes the whole sweep
      // with it, and a partial sweep is fine -- the next run picks up the rest.
      for (let i = 0; i < orphans.length; i += 50) {
        const chunk = orphans.slice(i, i + 50);
        await storageRemove(VOICE_BUCKET, chunk);
        deleted += chunk.length;
      }
    }

    const result = {
      bucket: VOICE_BUCKET,
      dry_run: dryRun,
      min_age_hours: minAgeHours,
      total_objects: objects.length,
      claimed_by_a_proposal: keptClaimed.length,
      too_new_to_touch: keptTooNew.length,
      orphaned: orphans.length,
      deleted,
      sample_orphans: orphans.slice(0, 10),
    };
    console.log(JSON.stringify({ event: "ugq_purge_orphaned_media", ...result }));

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ event: "ugq_purge_orphaned_media_failed", error: message }));
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
