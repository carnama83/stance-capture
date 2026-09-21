// src/pages/ProposalDetailPage.tsx
// Epic UGQ — full, untruncated detail view for a single proposal. Route:
// /profile/proposals/:id. MyProposalsPage's list cards link here instead of
// only ever showing a line-clamped snippet with no way to see the rest.
//
// Status-aware body:
//   - resubmit_requested (video only — see ugq-screen's leading-framing
//     gate on video_raw_transcript): shows the reason + the current caption
//     read-only, plus a "Re-record video" action that reopens
//     VideoRecorderPanel scoped to this proposal (resubmitProposalId prop —
//     see that file). Deliberately NOT an editable caption box: the gate
//     checks the unedited video transcript, not the caption, so editing
//     text here could never actually clear this status — only a brand-new
//     recording can (ugq-resubmit-video is what applies it in place).
//   - in_review with a ready preview: read-only text, plus the same
//     "ready to publish" action MyProposalsPage's list already offers —
//     Publish is a status transition, not a text edit, so it stays
//     available even though this view has no text-editing controls.
//   - everything else (proposed/screening/rejected/published/withdrawn/
//     reframing/approved): fully read-only.

import * as React from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowLeft, Loader2, Sparkles, ExternalLink, MessageSquare, AlertTriangle, Video, CheckCircle2, MapPin, Link2,
} from "lucide-react";
import PageLayout from "@/components/PageLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";
import { VideoRecorderPanel } from "@/components/ugq/VideoRecorderPanel";
import { useTranslation } from "react-i18next";

// Same shape as MyProposalsPage/ProposeQuestionModal's PreviewReframe,
// duplicated rather than shared — matches this codebase's existing
// convention (see MyProposalsPage's own header note) of not sharing small
// pieces across route trees.
type PreviewReframe = {
  question: string;
  slider_low_label: string | null;
  slider_high_label: string | null;
  context_summary: string | null;
  supporting_links: string[];
};

type ProposalDetail = {
  id: string;
  raw_question: string;
  status: string;
  rejection_reason: string | null;
  rejection_note: string | null;
  created_at: string;
  updated_at: string | null;
  source_url: string | null;
  location_label: string | null;
  input_mode: string;
  video_duration_seconds: number | null;
  framing_flag_reason: string | null;
  video_resubmit_count: number;
  preview_reframe: PreviewReframe | null;
  reframed_question_id: string | null;
  response_count: number;
  live_question: string | null;
  live_slider_low_label: string | null;
  live_slider_high_label: string | null;
  live_cover_image_url: string | null;
  hindi_rendition_text: string | null;
  hindi_rendition_status: string | null;
};

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
  };
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

async function fetchProposal(id: string): Promise<ProposalDetail | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_my_proposal`, {
    method: "POST",
    headers: supabaseHeaders(getJwt()),
    body: JSON.stringify({ p_id: id }),
  });
  if (!res.ok) throw new Error(`Failed to load proposal (${res.status})`);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const r = rows[0];
  return {
    id: String(r.id),
    raw_question: String(r.raw_question ?? ""),
    status: String(r.status ?? ""),
    rejection_reason: typeof r.rejection_reason === "string" ? r.rejection_reason : null,
    rejection_note: typeof r.rejection_note === "string" ? r.rejection_note : null,
    created_at: String(r.created_at ?? ""),
    updated_at: typeof r.updated_at === "string" ? r.updated_at : null,
    source_url: typeof r.source_url === "string" ? r.source_url : null,
    location_label: typeof r.location_label === "string" ? r.location_label : null,
    input_mode: String(r.input_mode ?? "text"),
    video_duration_seconds: typeof r.video_duration_seconds === "number" ? r.video_duration_seconds : null,
    framing_flag_reason: typeof r.framing_flag_reason === "string" ? r.framing_flag_reason : null,
    video_resubmit_count: Number(r.video_resubmit_count ?? 0),
    preview_reframe: parsePreviewReframe(r.preview_reframe),
    reframed_question_id: typeof r.reframed_question_id === "string" ? r.reframed_question_id : null,
    response_count: Number(r.response_count ?? 0),
    live_question: typeof r.live_question === "string" ? r.live_question : null,
    live_slider_low_label: typeof r.live_slider_low_label === "string" ? r.live_slider_low_label : null,
    live_slider_high_label: typeof r.live_slider_high_label === "string" ? r.live_slider_high_label : null,
    live_cover_image_url: typeof r.live_cover_image_url === "string" ? r.live_cover_image_url : null,
    hindi_rendition_text: typeof r.hindi_rendition_text === "string" ? r.hindi_rendition_text : null,
    hindi_rendition_status: typeof r.hindi_rendition_status === "string" ? r.hindi_rendition_status : null,
  };
}

const STATUS_STYLE: Record<string, { labelKey: string; cls: string }> = {
  proposed:            { labelKey: "proposals.statusUnderReview",   cls: "bg-amber-500 hover:bg-amber-500" },
  screening:           { labelKey: "proposals.statusUnderReview",   cls: "bg-amber-500 hover:bg-amber-500" },
  in_review:           { labelKey: "proposals.statusUnderReview",   cls: "bg-amber-500 hover:bg-amber-500" },
  resubmit_requested:  { labelKey: "proposals.statusNeedsRerecord", cls: "bg-orange-500 hover:bg-orange-500" },
  approved:            { labelKey: "proposals.statusApproved",       cls: "bg-blue-600 hover:bg-blue-600" },
  reframing:           { labelKey: "proposals.statusPreparing",      cls: "bg-blue-600 hover:bg-blue-600" },
  published:           { labelKey: "proposals.statusLive",           cls: "bg-emerald-600 hover:bg-emerald-600" },
  rejected:            { labelKey: "proposals.statusNotPublished",  cls: "bg-slate-400 hover:bg-slate-400" },
  withdrawn:           { labelKey: "proposals.statusWithdrawn",      cls: "bg-slate-400 hover:bg-slate-400" },
};

// Same static preview as MyProposalsPage/ProposeQuestionModal — duplicated
// per this codebase's existing convention (see MyProposalsPage's header).
function StanceScalePreview({ low, high }: { low: string | null; high: string | null }) {
  const { t } = useTranslation();
  if (!low && !high) return null;
  return (
    <div>
      <p className="text-[10.5px] text-slate-500 mb-2">
        {t("proposals.scalePreview")}
      </p>
      <div className="relative py-1.5">
        <div
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full"
          style={{ height: "8px", background: "linear-gradient(to right, rgba(248,113,113,0.3), rgba(203,213,225,0.3), rgba(74,222,128,0.3))" }}
          aria-hidden
        />
        <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-400 bg-white" aria-hidden />
      </div>
      <div className="flex items-start justify-between gap-2 text-[11px] text-slate-600">
        <span className="max-w-[42%] leading-tight">{low ?? "Oppose"}</span>
        <span className="text-slate-400 shrink-0">{t("ugq.neutralLabel")}</span>
        <span className="max-w-[42%] text-right leading-tight">{high ?? "Support"}</span>
      </div>
    </div>
  );
}

// Mirrors MyProposalsPage's InlinePublishCard — duplicated rather than
// shared (same convention), since Publish is a status transition available
// here too even though this view otherwise has no editing controls.
function ReadyToPublishCard({ proposalId, preview, onPublished }: {
  proposalId: string; preview: PreviewReframe; onPublished: () => void;
}) {
  const { t } = useTranslation();
  const [publishing, setPublishing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handlePublish() {
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/ugq-confirm-publish`, {
        method: "POST",
        headers: supabaseHeaders(getJwt()),
        body: JSON.stringify({ proposal_id: proposalId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        setError(json?.message ?? "Couldn't publish just now. Please try again.");
        setPublishing(false);
        return;
      }
      onPublished();
    } catch (_e) {
      setError("Network error. Please try again.");
      setPublishing(false);
    }
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
        <Sparkles className="h-3.5 w-3.5" /> {t("proposals.readyToPublish")}
      </div>
      <p className="text-sm text-slate-800 leading-snug">{preview.question}</p>
      <StanceScalePreview low={preview.slider_low_label} high={preview.slider_high_label} />
      {preview.context_summary && (
        <div className="pt-1.5 mt-0.5 border-t border-amber-200/70 space-y-1">
          <p className="text-[11px] font-medium text-amber-700">{t("ugq.background")}</p>
          <p className="text-xs text-slate-700 leading-relaxed">{preview.context_summary}</p>
          {preview.supporting_links.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {preview.supporting_links.slice(0, 3).map((url) => (
                <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                   className="text-[11px] text-slate-500 hover:text-slate-800 hover:underline">
                  {hostnameOf(url)}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end pt-0.5">
        <Button size="sm" disabled={publishing} onClick={handlePublish}>
          {publishing ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> {t("ugq.publishing")}</> : "Publish"}
        </Button>
      </div>
    </div>
  );
}

export default function ProposalDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [reRecording, setReRecording] = React.useState(false);

  const { data: proposal, isLoading, isError } = useQuery<ProposalDetail | null>({
    queryKey: ["my-proposal", id],
    queryFn: () => fetchProposal(id as string),
    enabled: !!id,
  });

  function refetchAll() {
    queryClient.invalidateQueries({ queryKey: ["my-proposal", id] });
    queryClient.invalidateQueries({ queryKey: ["my-proposals"] });
  }

  // Same base64 hand-off ProposeQuestionModal's transcribeAudioForVideo
  // uses for VideoRecorderPanel — duplicated here for the same reason every
  // other small piece in this file is (route trees don't share these).
  const transcribeAudio = React.useCallback(async (audioBlob: Blob) => {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Read failed"));
      reader.readAsDataURL(audioBlob);
    });
    const res = await fetch(`${SUPABASE_URL}/functions/v1/ugq-transcribe-voice`, {
      method: "POST",
      headers: supabaseHeaders(getJwt()),
      body: JSON.stringify({ audio_base64: base64, mime_type: audioBlob.type || "audio/webm" }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) throw new Error(json?.message ?? "Couldn't transcribe your recording.");
    return { transcript: String(json.transcript ?? "") };
  }, []);

  return (
    <PageLayout>
      <div className="max-w-2xl mx-auto py-6 space-y-4">
        <Link to="/profile/proposals" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> {t("nav.myProposals")}
        </Link>

        {isLoading && (
          <div className="flex items-center justify-center py-16 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> {t("common.loading")}
          </div>
        )}

        {isError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {t("proposalDetail.couldNotLoadThisProposal")}
          </div>
        )}

        {!isLoading && !isError && !proposal && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
            {t("proposalDetail.thisProposalDoesnTExist")}
          </div>
        )}

        {proposal && (() => {
  const { t } = useTranslation();
          const meta = STATUS_STYLE[proposal.status];
          const style = { label: meta ? t(meta.labelKey) : proposal.status, cls: meta?.cls ?? "bg-slate-400" };
          const readyToPublish = proposal.status === "in_review" && !!proposal.preview_reframe;
          const isVideo = proposal.input_mode === "video";
          const displayText = proposal.status === "published" && proposal.live_question
            ? proposal.live_question
            : proposal.raw_question;

          return (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={style.cls}>{style.label}</Badge>
                  {isVideo && (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <Video className="h-3.5 w-3.5" /> {t("proposalDetail.videoQuestion")}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-slate-400">
                    {t("proposalDetail.submitted")} {(() => { try { return formatDistanceToNow(new Date(proposal.created_at), { addSuffix: true }); } catch { return ""; } })()}
                    {proposal.updated_at && proposal.updated_at !== proposal.created_at ? (
                      <> {t("proposalDetail.updated")} {(() => { try { return formatDistanceToNow(new Date(proposal.updated_at as string), { addSuffix: true }); } catch { return ""; } })()}</>
                    ) : null}
                  </span>
                </div>

                <p className="text-base text-slate-900 leading-relaxed whitespace-pre-wrap">{displayText}</p>

                {proposal.status === "published" && proposal.hindi_rendition_text && proposal.hindi_rendition_status === "published" && (
                  <div className="pt-2 border-t border-slate-100">
                    <p className="text-[11px] font-medium text-slate-500 mb-1">हिंदी में</p>
                    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{proposal.hindi_rendition_text}</p>
                  </div>
                )}
                {proposal.status === "published" && !proposal.hindi_rendition_text && (
                  <p className="text-[11px] text-slate-400">{t("proposalDetail.hindiVersionIsStillBeing")}</p>
                )}

                {(proposal.location_label || proposal.source_url) && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 pt-1">
                    {proposal.location_label && (
                      <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {proposal.location_label}</span>
                    )}
                    {proposal.source_url && (
                      <a href={proposal.source_url} target="_blank" rel="noopener noreferrer"
                         className="inline-flex items-center gap-1 hover:text-slate-800 hover:underline">
                        <Link2 className="h-3 w-3" /> {hostnameOf(proposal.source_url)}
                      </a>
                    )}
                  </div>
                )}

                {proposal.status === "published" && (
                  <div className="flex items-center justify-between pt-1">
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <MessageSquare className="h-3.5 w-3.5" /> {proposal.response_count} {t("proposalDetail.stances")}
                    </span>
                    {proposal.reframed_question_id && (
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/q/${proposal.reframed_question_id}`}>
                          {t("proposals.viewLive")} <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                        </Link>
                      </Button>
                    )}
                  </div>
                )}

                {proposal.status === "rejected" && proposal.rejection_reason && (
                  <p className="text-xs text-slate-500">
                    {t("proposalDetail.reason")} {proposal.rejection_reason}
                    {proposal.rejection_note ? ` — ${proposal.rejection_note}` : ""}
                  </p>
                )}
              </div>

              {readyToPublish && proposal.preview_reframe && (
                <ReadyToPublishCard proposalId={proposal.id} preview={proposal.preview_reframe} onPublished={refetchAll} />
              )}

              {proposal.status === "resubmit_requested" && (
                <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 space-y-3">
                  <div className="flex gap-2 text-sm text-orange-900">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <p>
                      {proposal.framing_flag_reason ?? "This reads as leading — try asking more neutrally, without suggesting an answer."}
                    </p>
                  </div>
                  <p className="text-xs text-orange-800/80">
                    {t("proposalDetail.editingTheCaptionAboveWon")}
                    {proposal.video_resubmit_count > 0 ? ` (${proposal.video_resubmit_count} re-record${proposal.video_resubmit_count === 1 ? "" : "s"} so far.)` : ""}
                  </p>
                  {!reRecording ? (
                    <Button size="sm" onClick={() => setReRecording(true)}>
                      <Video className="h-3.5 w-3.5 mr-1.5" /> {t("proposalDetail.reRecordVideo")}
                    </Button>
                  ) : (
                    <VideoRecorderPanel
                      transcribeAudio={transcribeAudio}
                      resubmitProposalId={proposal.id}
                      onCancel={() => setReRecording(false)}
                      onSubmitted={() => {
                        setReRecording(false);
                        refetchAll();
                      }}
                    />
                  )}
                </div>
              )}

              {(proposal.status === "in_review" || proposal.status === "proposed" || proposal.status === "screening") && !readyToPublish && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t("proposalDetail.stillBeingReviewedWeLl")}
                </div>
              )}

              {proposal.status === "published" && (
                <p className="text-xs text-emerald-700 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {t("proposalDetail.thisQuestionIsLive")}
                </p>
              )}
            </div>
          );
        })()}
      </div>
    </PageLayout>
  );
}
