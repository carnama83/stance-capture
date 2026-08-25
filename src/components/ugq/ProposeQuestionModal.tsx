// src/components/ugq/ProposeQuestionModal.tsx
// Epic UGQ — Build Step 3: question proposal modal (spec §9.2).
//
// Submits to the ugq-submit Edge Function using the established auth-mutex
// bypass (getJwt() + raw fetch via supabaseHeaders), not the SDK.
//
// v1 scope notes:
//   - Topic is shown as a fixed chip only when launched with a preset (e.g. from
//     a topic page). There is no topic picker yet — admins assign the topic in
//     Gate 2. (auto_topic suggestion is stored by ugq-screen for that UI.)
//   - Location pre-fills from `defaultLocation` if the caller passes it.
//
// Aug 2026: ugq-submit returns `preview_reframe` — a fast, UNVERIFIED preview
// of how the raw text might read as a polished stance question, now
// including web-search-grounded `context_summary` + `supporting_links` too
// (generated in parallel with Gate 1 screening — see ugq-screen).
//
// Aug 2026 (later same week, REPLACED below): publishing used to happen
// silently and automatically the instant Gate 1 cleared. That's superseded —
// the proposer now reviews the full preview (question, both slider labels,
// background context) and explicitly clicks Publish. Two new phases exist
// for this: "review" (preview shown, Publish button) and "publishing"
// (calling ugq-confirm-publish). ugq-submit's old `published`/`question_id`
// fields are still handled for backward compat, in case an environment ever
// flips UGQ_AUTOPUBLISH_ENABLED back on server-side — in that case the modal
// just skips straight to "published".
//
// Aug 2026 (same batch): after a successful publish, ugq-confirm-publish also
// returns up to 3 AI-suggested authorities from authority_registry. The
// proposer can tag one of those, or browse the full registry for something
// else. Tagging does NOT make anything public immediately — it lands in
// user_authority_suggestions as 'user_tagged' and an admin has to confirm it
// (ugq-moderate) before it becomes the public "who's responsible" answer.

import * as React from "react";
import { Loader2, CheckCircle2, Lightbulb, Sparkles, ExternalLink, Landmark, ChevronDown } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";

const MIN_LEN = 20;
const MAX_LEN = 1000;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetTopicId?: string | null;
  presetTopicTitle?: string | null;
  presetConstituencyId?: string | null;
  defaultLocation?: string | null;
};

// Shape returned by ugq-submit's `preview_reframe` field. Null/absent when
// the proposal was rejected or the preview call failed — always handle that.
type PreviewReframe = {
  question: string;
  slider_low_label: string | null;
  slider_high_label: string | null;
  context_summary: string | null;
  supporting_links: string[];
  quality_notes?: string | null;
  // Aug 2026, NEW: og:image/twitter:image scraped from supporting_links (or
  // the proposer's source_url) by ugq-screen's attachCoverImage, at preview
  // time — so this can be null either because scraping hasn't run yet on an
  // old row, or because it genuinely found nothing. Either way, absent just
  // means no image to show.
  cover_image_url: string | null;
};

type Authority = { id: string; name: string; domain: string; jurisdiction_level: string };

function parsePreviewReframe(raw: unknown): PreviewReframe | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const question = typeof r.question === "string" ? r.question.trim() : "";
  if (!question) return null;
  return {
    question,
    slider_low_label: typeof r.slider_low_label === "string" ? r.slider_low_label : null,
    slider_high_label: typeof r.slider_high_label === "string" ? r.slider_high_label : null,
    context_summary: typeof r.context_summary === "string" && r.context_summary.trim() ? r.context_summary.trim() : null,
    supporting_links: Array.isArray(r.supporting_links)
      ? r.supporting_links.filter((u): u is string => typeof u === "string")
      : [],
    quality_notes: typeof r.quality_notes === "string" ? r.quality_notes : null,
    cover_image_url: typeof r.cover_image_url === "string" && r.cover_image_url.trim()
      ? r.cover_image_url.trim() : null,
  };
}

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

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

// Static, non-interactive preview of the real stance scale — matches
// QuestionStanceSlider's visual language exactly (same gradient colors/track
// height, same thumb border/size as ui/slider.tsx) so what the proposer sees
// here isn't a different-looking placeholder. Thumb sits at center/Neutral
// since there's no real position yet — nobody's answered this question.
function StanceScalePreview({ low, high }: { low: string | null; high: string | null }) {
  if (!low && !high) return null;
  return (
    <div className="pt-1.5">
      <p className="text-[10.5px] text-slate-500 mb-2">
        Here&#x2019;s how the stance scale will appear to users:
      </p>
      <div className="relative py-1.5">
        <div
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full"
          style={{
            height: "8px",
            background: "linear-gradient(to right, rgba(248,113,113,0.3), rgba(203,213,225,0.3), rgba(74,222,128,0.3))",
          }}
          aria-hidden
        />
        <div
          className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-400 bg-white"
          aria-hidden
        />
      </div>
      <div className="flex items-start justify-between gap-2 text-[11px] text-slate-600">
        <span className="max-w-[42%] leading-tight">{low ?? "Oppose"}</span>
        <span className="text-slate-400 shrink-0">Neutral</span>
        <span className="max-w-[42%] text-right leading-tight">{high ?? "Support"}</span>
      </div>
    </div>
  );
}

// Cover image found via og:image/twitter:image scraping at preview time
// (Aug 2026, NEW — see ugq-screen's attachCoverImage). Best-effort scrape
// result, not guaranteed reachable, so this hides itself silently on load
// failure rather than showing a broken-image icon.
function CoverImagePreview({ src }: { src: string | null }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => { setFailed(false); }, [src]); // reset if a new preview replaces this one
  if (!src || failed) return null;
  return (
    <img
      src={src}
      alt=""
      className="w-full h-36 object-cover rounded-md"
      onError={() => setFailed(true)}
    />
  );
}

export function ProposeQuestionModal({
  open,
  onOpenChange,
  presetTopicId = null,
  presetTopicTitle = null,
  presetConstituencyId = null,
  defaultLocation = null,
}: Props) {
  const [question, setQuestion] = React.useState("");
  const [sourceUrl, setSourceUrl] = React.useState("");
  const [location, setLocation] = React.useState(defaultLocation ?? "");
  const [phase, setPhase] = React.useState<"form" | "submitting" | "review" | "publishing" | "published">("form");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [proposalId, setProposalId] = React.useState<string | null>(null);
  const [previewReframe, setPreviewReframe] = React.useState<PreviewReframe | null>(null);
  const [questionId, setQuestionId] = React.useState<string | null>(null);
  const [autoPublished, setAutoPublished] = React.useState(false); // legacy path fallback, see header note

  // Polling state — see the effect below. Only relevant while phase==="review"
  // and previewReframe is still null (ugq-submit's ~20s internal wait gave up
  // before ugq-screen finished — the screening itself keeps running
  // server-side regardless, this just picks up the result once it lands
  // instead of leaving the proposer at a dead end).
  const [pollAttempts, setPollAttempts] = React.useState(0);
  const [pollExhausted, setPollExhausted] = React.useState(false);

  // Authority tagging (post-publish) state.
  const [suggestedAuthorities, setSuggestedAuthorities] = React.useState<Authority[]>([]);
  const [tagStatus, setTagStatus] = React.useState<"idle" | "tagging" | "tagged" | "skipped">("idle");
  const [taggedName, setTaggedName] = React.useState<string | null>(null);
  const [tagError, setTagError] = React.useState<string | null>(null);
  const [browseOpen, setBrowseOpen] = React.useState(false);
  const [browseLoading, setBrowseLoading] = React.useState(false);
  const [allAuthorities, setAllAuthorities] = React.useState<Authority[] | null>(null);
  const [browseSelection, setBrowseSelection] = React.useState("");

  // Reset to a clean form each time the modal opens.
  React.useEffect(() => {
    if (open) {
      setQuestion("");
      setSourceUrl("");
      setLocation(defaultLocation ?? "");
      setPhase("form");
      setErrorMsg(null);
      setProposalId(null);
      setPreviewReframe(null);
      setQuestionId(null);
      setAutoPublished(false);
      setPollAttempts(0);
      setPollExhausted(false);
      setSuggestedAuthorities([]);
      setTagStatus("idle");
      setTaggedName(null);
      setTagError(null);
      setBrowseOpen(false);
      setBrowseLoading(false);
      setAllAuthorities(null);
      setBrowseSelection("");
    }
  }, [open, defaultLocation]);

  // Poll for a preview that wasn't ready in time. Only active while
  // phase==="review" AND previewReframe is still null AND we haven't given
  // up yet — naturally stops (via the cleanup below) the moment any of those
  // flips: preview arrives, phase changes (published/closed/back to form),
  // or the attempt cap is hit. Reads the proposal directly via REST — RLS
  // (uqp_select_own_or_admin) already lets a proposer read their own row, so
  // no new endpoint is needed for this.
  const POLL_INTERVAL_MS = 3000;
  const POLL_MAX_ATTEMPTS = 10; // 10 * 3s = 30s of polling on top of ugq-submit's own ~20s wait

  React.useEffect(() => {
    if (phase !== "review" || previewReframe || !proposalId || pollExhausted) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      try {
        const jwt = getJwt();
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/user_question_proposals?id=eq.${proposalId}&select=status,preview_reframe,rejection_reason,rejection_note,reframed_question_id`,
          { headers: supabaseHeaders(jwt) },
        );
        if (!res.ok || cancelled) return; // transient — try again next tick
        const rows = await res.json().catch(() => []);
        const row = Array.isArray(rows) && rows.length ? (rows[0] as Record<string, unknown>) : null;
        if (!row || cancelled) return;

        if (row.status === "rejected") {
          clearInterval(timer);
          setErrorMsg(typeof row.rejection_note === "string" && row.rejection_note
            ? row.rejection_note
            : "Your question wasn't accepted. Try rephrasing it.");
          setPhase("form");
          return;
        }

        if (row.status === "published" && typeof row.reframed_question_id === "string") {
          // Backward-compat auto-publish path resolved while we were
          // waiting — same handling as the direct response case in
          // handleSubmit.
          clearInterval(timer);
          setQuestionId(row.reframed_question_id);
          setAutoPublished(true);
          setPhase("published");
          return;
        }

        const parsed = parsePreviewReframe(row.preview_reframe);
        if (parsed) {
          clearInterval(timer);
          setPreviewReframe(parsed); // stays in "review" — now renders the full preview + Publish button
          return;
        }

        setPollAttempts((n) => {
          const next = n + 1;
          if (next >= POLL_MAX_ATTEMPTS) {
            clearInterval(timer);
            setPollExhausted(true);
          }
          return next;
        });
      } catch {
        // Network hiccup — just try again next tick, don't give up on one blip.
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [phase, previewReframe, proposalId, pollExhausted]);

  const trimmed = question.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_LEN;
  const canSubmit = trimmed.length >= MIN_LEN && trimmed.length <= MAX_LEN && phase === "form";

  async function handleSubmit() {
    if (!canSubmit) return;
    setPhase("submitting");
    setErrorMsg(null);
    try {
      const jwt = getJwt();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/ugq-submit`, {
        method: "POST",
        headers: supabaseHeaders(jwt),
        body: JSON.stringify({
          raw_question: trimmed,
          source_url: sourceUrl.trim() || null,
          location_label: location.trim() || null,
          suggested_topic_id: presetTopicId,
          constituency_id: presetConstituencyId,
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json?.ok) {
        const msg = json?.message ?? "Something went wrong. Please try again.";
        setErrorMsg(msg);
        setPhase("form");
        return;
      }

      if (json.status === "rejected") {
        setErrorMsg(json.message ?? "Your question wasn't accepted. Try rephrasing it.");
        setPhase("form");
        return;
      }

      setProposalId(typeof json.proposal_id === "string" ? json.proposal_id : null);
      setPreviewReframe(parsePreviewReframe(json.preview_reframe));

      // Backward compat: if this environment still has silent auto-publish on
      // (UGQ_AUTOPUBLISH_ENABLED=true server-side), ugq-submit already
      // published it — skip straight to the published screen instead of
      // asking the user to publish something that's already live.
      if (json.published === true && typeof json.question_id === "string") {
        setQuestionId(json.question_id);
        setAutoPublished(true);
        setPhase("published");
        return;
      }

      setPhase("review");
    } catch (_e) {
      setErrorMsg("Network error. Please check your connection and try again.");
      setPhase("form");
    }
  }

  async function handlePublish() {
    if (!proposalId || phase === "publishing") return;
    setPhase("publishing");
    setErrorMsg(null);
    try {
      const jwt = getJwt();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/ugq-confirm-publish`, {
        method: "POST",
        headers: supabaseHeaders(jwt),
        body: JSON.stringify({ proposal_id: proposalId }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json?.ok) {
        setErrorMsg(json?.message ?? "Couldn't publish just now. Please try again.");
        setPhase("review");
        return;
      }

      setQuestionId(json.question_id);
      setSuggestedAuthorities(parseAuthorities(json.suggested_authorities));
      setPhase("published");
    } catch (_e) {
      setErrorMsg("Network error. Please check your connection and try again.");
      setPhase("review");
    }
  }

  async function tagAuthority(authorityId: string, fallbackName?: string) {
    if (!questionId || tagStatus === "tagging") return;
    setTagStatus("tagging");
    setTagError(null);
    try {
      const jwt = getJwt();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/ugq-tag-authority`, {
        method: "POST",
        headers: supabaseHeaders(jwt),
        body: JSON.stringify({ question_id: questionId, authority_id: authorityId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        setTagError(json?.message ?? "Couldn't tag that authority. Please try again.");
        setTagStatus("idle");
        return;
      }
      setTaggedName(typeof json.authority_name === "string" ? json.authority_name : fallbackName ?? null);
      setTagStatus("tagged");
    } catch (_e) {
      setTagError("Network error. Please try again.");
      setTagStatus("idle");
    }
  }

  async function openBrowseAuthorities() {
    setBrowseOpen(true);
    if (allAuthorities !== null) return; // already loaded
    setBrowseLoading(true);
    try {
      const jwt = getJwt();
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/authority_registry?select=id,name,domain,jurisdiction_level&order=name.asc`,
        { headers: supabaseHeaders(jwt) },
      );
      const json = await res.json().catch(() => []);
      setAllAuthorities(parseAuthorities(json));
    } catch (_e) {
      setAllAuthorities([]);
    } finally {
      setBrowseLoading(false);
    }
  }

  function close() {
    onOpenChange(false);
  }

  const preview = previewReframe;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        // Aug 2026: a click outside was silently discarding an already-saved
        // preview mid-review (proposal + screening had already completed —
        // only the browser's copy of the preview was lost). Only explicit
        // actions (the X, Cancel, Not now, Done) should close this now.
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {phase === "published" ? (
          <div className="flex flex-col items-center text-center py-6 gap-3">
            <CheckCircle2 className="h-10 w-10 text-green-600" />
            <DialogTitle className="text-lg">You&#x2019;re live!</DialogTitle>
            <DialogDescription>
              {autoPublished
                ? "Your question is live right now. Our team will also give it a quick review shortly."
                : "Your question is live right now. Our team will also give it a quick review shortly."}
            </DialogDescription>

            {preview ? (
              <div className="w-full mt-1 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-left space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-green-700">
                  <Sparkles className="h-3.5 w-3.5" />
                  Your question, live now
                </div>
                <CoverImagePreview src={preview.cover_image_url} />
                <p className="text-sm text-slate-800 leading-snug">{preview.question}</p>
                <StanceScalePreview low={preview.slider_low_label} high={preview.slider_high_label} />
              </div>
            ) : null}

            {/* Authority tagging — only offered once, right after publish. */}
            {tagStatus === "tagged" ? (
              <div className="w-full rounded-lg border border-purple-200 bg-purple-50 px-4 py-3 text-left">
                <p className="text-sm text-purple-800">
                  <Landmark className="h-3.5 w-3.5 inline mr-1 -mt-0.5" />
                  Tagged <strong>{taggedName}</strong> &#x2014; sent to our team to confirm.
                </p>
              </div>
            ) : tagStatus === "skipped" ? null : (
              <div className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left space-y-2">
                <p className="text-xs font-medium text-slate-600">
                  <Landmark className="h-3.5 w-3.5 inline mr-1 -mt-0.5" />
                  Think this is related to a specific authority?
                </p>
                {suggestedAuthorities.length > 0 && !browseOpen ? (
                  <div className="flex flex-wrap gap-1.5">
                    {suggestedAuthorities.map((a) => (
                      <Button
                        key={a.id}
                        size="sm"
                        variant="outline"
                        disabled={tagStatus === "tagging"}
                        onClick={() => tagAuthority(a.id, a.name)}
                      >
                        {tagStatus === "tagging" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                        Tag {a.name}
                      </Button>
                    ))}
                  </div>
                ) : null}

                {browseOpen ? (
                  <div className="space-y-2">
                    {browseLoading ? (
                      <p className="text-xs text-slate-500 flex items-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading authorities&#x2026;
                      </p>
                    ) : (allAuthorities?.length ?? 0) > 0 ? (
                      <>
                        <select
                          value={browseSelection}
                          onChange={(e) => setBrowseSelection(e.target.value)}
                          className="w-full h-9 rounded-md border border-slate-300 px-2 text-sm bg-white"
                        >
                          <option value="">Select an authority&#x2026;</option>
                          {allAuthorities!.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name} {a.domain ? `(${a.domain})` : ""}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          disabled={!browseSelection || tagStatus === "tagging"}
                          onClick={() => {
                            const picked = allAuthorities!.find((a) => a.id === browseSelection);
                            if (picked) tagAuthority(picked.id, picked.name);
                          }}
                        >
                          {tagStatus === "tagging" ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Tagging&#x2026;</> : "Tag this authority"}
                        </Button>
                      </>
                    ) : (
                      <p className="text-xs text-slate-500">No authorities found.</p>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={openBrowseAuthorities}
                    className="inline-flex items-center gap-0.5 text-xs text-blue-600 hover:underline"
                  >
                    Browse all authorities <ChevronDown className="h-3 w-3" />
                  </button>
                )}

                {tagError ? <p className="text-xs text-red-600">{tagError}</p> : null}

                {tagStatus !== "tagging" && (
                  <button
                    type="button"
                    onClick={() => setTagStatus("skipped")}
                    className="text-[11px] text-slate-400 hover:text-slate-600 hover:underline"
                  >
                    No thanks, skip this
                  </button>
                )}
              </div>
            )}

            <div className="flex gap-2 mt-1">
              {/* asChild assumes the standard shadcn/ui Button (Radix Slot) —
                  if your Button doesn't support asChild, swap this for
                  <a href={...} className={buttonVariants({variant:"outline"})}> instead. */}
              {questionId ? (
                <Button variant="outline" asChild>
                  <a href={`#/q/${questionId}`} onClick={close}>
                    View it live <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                  </a>
                </Button>
              ) : null}
              <Button onClick={close}>Done</Button>
            </div>
          </div>
        ) : phase === "review" || phase === "publishing" ? (
          <div className="flex flex-col gap-3 py-2">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-amber-500" />
                {preview ? "Here\u2019s how this looks" : pollExhausted ? "Still processing" : "Almost ready"}
              </DialogTitle>
              <DialogDescription>
                {preview
                  ? "Review it, then publish when you're ready. Our team will also take a quick look shortly after."
                  : pollExhausted
                  ? "This is taking longer than usual \u2014 check My Proposals in a bit, or come back here later."
                  : "We're finishing up your preview \u2014 this can take up to a minute with everything we check."}
              </DialogDescription>
            </DialogHeader>

            {preview ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
                <CoverImagePreview src={preview.cover_image_url} />
                <p className="text-sm text-slate-800 leading-snug">{preview.question}</p>
                <StanceScalePreview low={preview.slider_low_label} high={preview.slider_high_label} />

                {preview.context_summary ? (
                  <div className="pt-2 mt-1 border-t border-amber-200/70 space-y-1">
                    <p className="text-[11px] font-medium text-amber-700">Background</p>
                    <p className="text-xs text-slate-700 leading-relaxed">{preview.context_summary}</p>
                    {preview.supporting_links.length > 0 ? (
                      <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
                        {preview.supporting_links.slice(0, 3).map((url) => (
                          <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                             className="text-[11px] text-slate-500 hover:text-slate-800 hover:underline">
                            {hostnameOf(url)}
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <p className="text-[11px] text-amber-700/80 pt-1">
                  Not fact-checked yet &#x2014; our team reviews shortly after this goes live and may refine the wording.
                </p>
              </div>
            ) : !pollExhausted ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                <p className="text-xs">Checking for your preview&#x2026;</p>
              </div>
            ) : null}

            {errorMsg ? <p className="text-sm text-red-600">{errorMsg}</p> : null}

            <DialogFooter>
              <Button variant="ghost" onClick={close} disabled={phase === "publishing"}>
                {preview ? "Not now" : "Done"}
              </Button>
              {preview ? (
                <Button onClick={handlePublish} disabled={phase === "publishing"}>
                  {phase === "publishing" ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Publishing&#x2026;</>
                  ) : (
                    "Publish"
                  )}
                </Button>
              ) : null}
            </DialogFooter>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-amber-500" />
                Propose a question
              </DialogTitle>
              <DialogDescription>
                Surface an issue you care about. If it meets our civic-framing bar, it goes
                live as a stance card &#x2014; with credit to you.
              </DialogDescription>
            </DialogHeader>

            {presetTopicTitle ? (
              <div>
                <Badge variant="secondary">Topic: {presetTopicTitle}</Badge>
              </div>
            ) : null}

            <div className="space-y-4 py-1">
              <div className="space-y-1.5">
                <Label htmlFor="ugq-question">Your question</Label>
                <Textarea
                  id="ugq-question"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value.slice(0, MAX_LEN))}
                  placeholder="What do you want the community to weigh in on?"
                  rows={4}
                  autoFocus
                />
                <div className="flex justify-between text-xs">
                  <span className={tooShort ? "text-amber-600" : "text-slate-400"}>
                    {tooShort ? `At least ${MIN_LEN} characters` : "\u00A0"}
                  </span>
                  <span className="text-slate-400">{trimmed.length}/{MAX_LEN}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ugq-source">Source link <span className="text-slate-400">(optional)</span></Label>
                <Input
                  id="ugq-source"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="Add a link for context"
                  inputMode="url"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ugq-location">Location <span className="text-slate-400">(optional)</span></Label>
                <Input
                  id="ugq-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Lucknow, UP"
                />
              </div>

              {errorMsg ? (
                <p className="text-sm text-red-600">{errorMsg}</p>
              ) : null}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={close} disabled={phase === "submitting"}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={!canSubmit}>
                {phase === "submitting" ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Reviewing&#x2026;</>
                ) : (
                  "Submit for review"
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ProposeQuestionModal;
