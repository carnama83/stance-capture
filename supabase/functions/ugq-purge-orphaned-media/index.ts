// supabase/functions/ugq-purge-orphaned-media/index.ts
//
// UGQ-O3 / UGQ-O2: deletes UGQ voice and video media that nothing claims.
//
// Why orphans exist, and why this is a reaper rather than a code fix:
//   voice (O3) -- ugq-transcribe-voice must PERSIST the audio before it can
//     transcribe it, but the path is only claimed if the proposer goes on to
//     submit. Every abandoned take and every re-record leaks an object. You
//     cannot transcribe a file you have not stored, so the ordering is inherent.
//   video (O2) -- ugq-resubmit-video overwrites video_recording_path without
//     removing the object it replaces. Deleting inline at resubmit time would
//     mean that if the resubmit then failed, the proposer's only recording was
//     already gone; the sweeper's 24h age guard makes the ordering safe.
//
// WHO CHOOSES WHAT DIES: the caller does, in SQL, against storage.objects
// (admin.list_orphaned_ugq_media). v1 of this function discovered objects via
// the Storage list API and got it badly wrong -- that API is NOT recursive, so
// for objects stored at <user_id>/<uuid>.webm it returned the four TOP-LEVEL
// FOLDERS and matched none against a claimed path. A non-dry run would have
// passed folder prefixes to the delete endpoint and could have taken all 56
// objects, including the 10 in use. The dry-run default is all that caught it.
//
// So this function discovers nothing. It receives an explicit list and
// RE-VERIFIES every path before deleting -- deliberately duplicating the
// caller's check, because the check costs nothing and being wrong costs
// someone's only recording.
//
// Division of responsibility, stated so neither side assumes the other did it:
//   caller (SQL)  -- selects the candidate set AND applies the 24h age guard
//                    (only it can see storage.objects.created_at).
//   this function -- re-checks CLAIMS and path SHAPE, then deletes. It cannot
//                    see object age; it never widens the set it was given.
//
// Sep 2026, HARDENED (two latent faults in the previous revision):
//   1. The claim re-check fetched EVERY non-null value of each claim column
//      with no pagination. PostgREST caps returned rows (commonly 1000), so
//      past that the claimed-set would come back silently truncated and a
//      genuinely claimed recording would look unclaimed -- the safety check
//      would quietly start failing OPEN exactly as the data grew. The lookup
//      is now filtered to the requested paths and chunked, so it is bounded by
//      the request rather than by table size, and exact regardless of row count.
//   2. No shape guard on the incoming paths. Deletion posts `prefixes`, so a
//      FOLDER name would remove that whole subtree -- precisely the v1 failure
//      mode. Anything not shaped like <dir>/<file>.<ext> is now refused before
//      it can reach the delete endpoint.
//
// Deletion goes through the Storage API, never a DELETE against
// storage.objects: removing the row would strand the S3 blob, still stored and
// still billed, just unreachable.
//
// Auth: x-cron-secret must match CRON_SECRET.
// Body: { "bucket": string, "paths": string[], "dry_run": boolean (default true) }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

// Which columns can claim an object, per bucket. A video is claimed by a
// QUESTION as well as a proposal -- questions.video_recording_path carries it
// forward after publication, and checking proposals alone would delete live
// question media.
const CLAIMS: Record<string, Array<{ table: string; column: string }>> = {
  "ugq-voice-recordings": [
    { table: "user_question_proposals", column: "voice_recording_path" },
  ],
  "ugq-video-recordings": [
    { table: "user_question_proposals", column: "video_recording_path" },
    { table: "questions", column: "video_recording_path" },
  ],
};

// Bounds both the claim lookup and the delete calls. Small enough to keep the
// IN-list URL well inside any proxy limit, large enough that a real sweep is a
// couple of round trips.
const CHUNK = 50;

// A storage object here is always <dir>/<file>.<ext>. A bare folder name has no
// slash-separated filename and no extension -- and since the delete endpoint
// treats what it is given as a PREFIX, letting one through would remove the
// whole subtree. Refuse rather than trust the caller.
function isObjectShaped(p: string): boolean {
  if (!p || p.startsWith("/") || p.endsWith("/")) return false;
  if (p.includes("..")) return false;
  const slash = p.lastIndexOf("/");
  if (slash <= 0) return false; // must live under a directory
  const file = p.slice(slash + 1);
  return file.length > 0 && file.includes(".") && !file.startsWith(".");
}

function restHeaders(extra: Record<string, string> = {}) {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

// Exact, bounded claim lookup: asks only about the paths in THIS request.
// Returns the subset of `paths` that something still points at.
async function claimedAmong(
  paths: string[],
  spec: { table: string; column: string },
): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < paths.length; i += CHUNK) {
    const chunk = paths.slice(i, i + CHUNK);
    // PostgREST IN-list: each value double-quoted so slashes, dots and dashes
    // stay literal. URLSearchParams handles the percent-encoding.
    const inList = chunk.map((p) => JSON.stringify(p)).join(",");
    const params = new URLSearchParams();
    params.set("select", spec.column);
    params.set(spec.column, `in.(${inList})`);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${spec.table}?${params.toString()}`, {
      headers: restHeaders(),
    });
    if (!res.ok) {
      // Fail CLOSED: an unverifiable claim check must never be read as
      // "nothing claims these".
      throw new Error(
        `claim lookup ${spec.table}.${spec.column} failed: ${res.status} ${(await res.text()).slice(0, 200)}`,
      );
    }
    for (const row of await res.json()) {
      const v = row?.[spec.column];
      if (typeof v === "string" && v.trim()) found.add(v.trim());
    }
  }
  return found;
}

Deno.serve(async (req: Request) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run !== false; // default TRUE
  const bucket = typeof body?.bucket === "string" ? body.bucket : "ugq-voice-recordings";
  const requested: string[] = Array.isArray(body?.paths)
    ? body.paths
      .filter((p: unknown) => typeof p === "string" && p.trim())
      .map((p: string) => p.trim())
    : [];

  try {
    // An unknown bucket has no known claim columns, so "nothing claims it"
    // would be vacuously true for every object in it. Refuse instead.
    const claimSpecs = CLAIMS[bucket];
    if (!claimSpecs) {
      return new Response(
        JSON.stringify({ error: `Refusing to purge unknown bucket '${bucket}': no claim rule defined` }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }

    // No list means no work. Deliberately NOT a cue to go and find some --
    // that is the v1 bug this function exists in order not to have.
    if (!requested.length) {
      return new Response(
        JSON.stringify({ bucket, dry_run: dryRun, requested: 0, deleted: 0, message: "nothing to do" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    const malformed = requested.filter((p) => !isObjectShaped(p));
    const candidates = requested.filter(isObjectShaped);
    if (malformed.length) {
      console.error(JSON.stringify({
        event: "ugq_purge_refused_malformed_paths",
        bucket,
        count: malformed.length,
        sample: malformed.slice(0, 5),
      }));
    }

    // Independent re-check across every column that can claim this bucket.
    const claimed = new Set<string>();
    for (const spec of claimSpecs) {
      for (const p of await claimedAmong(candidates, spec)) claimed.add(p);
    }

    const refused = candidates.filter((p) => claimed.has(p));
    const safe = candidates.filter((p) => !claimed.has(p));

    if (refused.length) {
      console.error(JSON.stringify({
        event: "ugq_purge_refused_claimed_paths",
        bucket,
        count: refused.length,
        sample: refused.slice(0, 5),
      }));
    }

    let deleted = 0;
    if (!dryRun && safe.length) {
      // Chunked: one oversized request failing should not lose the whole sweep,
      // and a partial sweep is fine -- the next run picks up the remainder.
      for (let i = 0; i < safe.length; i += CHUNK) {
        const chunk = safe.slice(i, i + CHUNK);
        const del = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
          method: "DELETE",
          headers: restHeaders(),
          body: JSON.stringify({ prefixes: chunk }),
        });
        if (!del.ok) {
          throw new Error(
            `storage delete failed at offset ${i}: ${del.status} ${(await del.text()).slice(0, 300)}`,
          );
        }
        deleted += chunk.length;
      }
    }

    const result = {
      bucket,
      dry_run: dryRun,
      requested: requested.length,
      refused_malformed: malformed.length,
      refused_because_claimed: refused.length,
      eligible: safe.length,
      deleted,
      sample: safe.slice(0, 5),
    };
    console.log(JSON.stringify({ event: "ugq_purge_orphaned_media", ...result }));

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ event: "ugq_purge_orphaned_media_failed", bucket, error: message }));
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
