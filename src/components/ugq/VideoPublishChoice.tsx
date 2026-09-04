// src/components/ugq/VideoPublishChoice.tsx
// Epic X — shown inside the existing "here's how this looks" preview modal
// once a video proposal's status is "in_review" and preview_reframe is
// populated. Calls ugq-confirm-publish with the chosen video_publish_choice.
//
// Auth: getJwt()/supabaseHeaders() from src/lib/env.ts — same pattern as
// every other user-facing raw-fetch call in this codebase.
//
// Sep 2026, NEW: derogatoryFlagReason (from ugq-submit/ugq-screen's
// checkVideoFraming — see that file) is informational only, deliberately
// NOT a gate: unlike the "leading" framing check (which forces a re-record
// before publish is even possible), a derogatory-language flag is shown as
// a recommendation with a Re-record shortcut, but Publish stays directly
// clickable underneath it — the proposer decides.

import { useState } from "react";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";

type Authority = { id: string; name: string; domain: string; jurisdiction_level: string };

function parseAuthorities(raw: unknown): Authority[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .map((a) => ({
      id: String(a.id ?? ""),
      name: String(a.name ?? ""),
      domain: String(a.domain ?? ""),
      jurisdiction_level: String(a.jurisdiction_level ?? ""),
    }))
    .filter((a) => a.id && a.name);
}

// Sep 2026: "raw_plus_avatar" (AI-narrated alternate audio track) dropped —
// no TTS/avatar synthesis backend exists, so offering it was a dead choice.
// Revisit if that infra ever gets built.
type PublishChoice = "raw_only" | "raw_plus_overlay";

const OPTIONS: { value: PublishChoice; label: string; description: string }[] = [
  {
    value: "raw_plus_overlay",
    label: "Raw video with neutral overlay (recommended)",
    description: "Your video plays as recorded. A neutral title and question sit alongside it — never gated behind watching the clip.",
  },
  {
    value: "raw_only",
    label: "Raw video only",
    description: "Just your video, exactly as recorded — no overlay text.",
  },
];

export function VideoPublishChoice({
  proposalId,
  derogatoryFlagReason = null,
  onReRecord,
  onPublished,
}: {
  proposalId: string;
  // Sep 2026, NEW: non-null means the framing check flagged language that
  // could read as derogatory toward a named person — shown as a dismissible
  // recommendation, not a block. Null/undefined (the default) renders
  // nothing extra, so callers that don't fetch this field yet are unaffected.
  derogatoryFlagReason?: string | null;
  // Only required when derogatoryFlagReason is present, to route "Re-record"
  // back to VideoRecorderPanel — optional otherwise so existing callers
  // don't need to wire a no-op.
  onReRecord?: () => void;
  // Sep 2026, NEW: ugq-confirm-publish already returns up to 3 AI-suggested
  // authorities (same as the text/voice path) — relayed here so the caller
  // can show the same post-publish tagging UI instead of it silently
  // defaulting to empty for video.
  onPublished: (questionId: string, suggestedAuthorities: Authority[]) => void;
}) {
  const [choice, setChoice] = useState<PublishChoice>("raw_plus_overlay");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publish = async () => {
    const jwt = getJwt();
    if (!jwt) { setError("Please sign in again."); return; }
    setPublishing(true);
    setError(null);
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/ugq-confirm-publish`, {
        method: "POST",
        headers: supabaseHeaders(jwt),
        body: JSON.stringify({ proposal_id: proposalId, video_publish_choice: choice }),
      });
      const json = await resp.json();
      if (!resp.ok || !json.ok) throw new Error(json.message ?? "Publish failed");
      onPublished(json.question_id, parseAuthorities(json.suggested_authorities));
    } catch (e) {
      setError((e as Error).message || "Something went wrong. Please try again.");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Sep 2026, NEW: informational recommendation only — Publish below
          stays fully clickable either way, this just offers a shortcut back
          to re-recording if the proposer wants to act on it. */}
      {derogatoryFlagReason && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <p className="font-medium">Before you publish</p>
          <p className="mt-0.5">{derogatoryFlagReason}</p>
          {onReRecord && (
            <button
              type="button"
              onClick={onReRecord}
              className="mt-2 text-sm font-medium text-amber-900 underline underline-offset-2"
            >
              Re-record instead
            </button>
          )}
        </div>
      )}

      <p className="text-sm font-medium text-neutral-900">How should this be published?</p>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      <div className="flex flex-col gap-2">
        {OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className="flex cursor-pointer items-start gap-3 rounded-md border border-neutral-200 p-3 has-[:checked]:border-neutral-900"
          >
            <input
              type="radio"
              name="video_publish_choice"
              value={opt.value}
              checked={choice === opt.value}
              onChange={() => setChoice(opt.value)}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium text-neutral-900">{opt.label}</span>
              <span className="block text-sm text-neutral-600">{opt.description}</span>
            </span>
          </label>
        ))}
      </div>
      <button
        type="button"
        onClick={publish}
        disabled={publishing}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {publishing ? "Publishing…" : "Publish"}
      </button>
    </div>
  );
}
