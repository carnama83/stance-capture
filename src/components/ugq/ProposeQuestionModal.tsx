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
import { Loader2, CheckCircle2, Lightbulb, Sparkles, ExternalLink, Landmark, ChevronDown, Wand2, Mic, Square, Trash2, Play, Pause, Check } from "lucide-react";
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
// Aug 2026, NEW: bounds for the "add more context" refine textarea — kept
// in sync with ugq-refine-preview's own REFINE_MIN_LEN/REFINE_MAX_LEN so
// the button disables at the same point the backend would reject anyway.
const REFINE_MIN_LEN = 5;
const REFINE_MAX_LEN = 500;
// Aug 2026, NEW: voice recording input. Matches ugq-transcribe-voice's
// MAX_AUDIO_BYTES budget — auto-stops the recording client-side rather than
// relying solely on the server's byte-size defense-in-depth check.
const MAX_RECORDING_SECONDS = 90;

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

// Aug 2026, NEW: formats seconds as m:ss for the recording timer.
function formatMMSS(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
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

  // Refine state (Aug 2026, NEW) — see handleRefine. Only relevant during
  // phase==="review", independent of the poll state above (by the time
  // refine is available, previewReframe is already populated, so the poll
  // effect's own guard already keeps it from firing concurrently).
  const [refineOpen, setRefineOpen] = React.useState(false);
  const [refineText, setRefineText] = React.useState("");
  const [refining, setRefining] = React.useState(false);
  const [refineError, setRefineError] = React.useState<string | null>(null);

  // Voice recording state (Aug 2026, NEW) — see startRecording/stopRecording/
  // handleUseRecording. voiceRecordingPath does double duty: it's both the
  // Storage path forwarded to ugq-submit AND the signal (non-null) that the
  // current question text originated from a transcription, used to set
  // input_mode at submit time. "Record again" is the one explicit action
  // that clears it — short of that, further manual edits to the transcribed
  // text still count as voice-origin, which is the right call for an
  // admin-facing trust signal (imperfect edge cases here are harmless).
  const [inputMode, setInputMode] = React.useState<"text" | "voice">("text");
  const [recordingState, setRecordingState] = React.useState<"idle" | "recording" | "recorded" | "transcribing">("idle");
  const [recordedBlobUrl, setRecordedBlobUrl] = React.useState<string | null>(null);
  const [recordedMimeType, setRecordedMimeType] = React.useState<string | null>(null);
  const [recordingSeconds, setRecordingSeconds] = React.useState(0);
  const [voiceRecordingPath, setVoiceRecordingPath] = React.useState<string | null>(null);
  const [voiceError, setVoiceError] = React.useState<string | null>(null);
  // Live bar heights (px) driven by the mic via AnalyserNode while
  // recordingState==="recording" — see startWaveformLoop. Falls back to a
  // flat baseline if AudioContext isn't available; recording itself still
  // works either way, this is purely decorative.
  const [waveformLevels, setWaveformLevels] = React.useState<number[]>(Array(24).fill(4));
  // Playback state for the custom "recorded" preview player.
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [playbackPosition, setPlaybackPosition] = React.useState(0);

  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const audioChunksRef = React.useRef<Blob[]>([]);
  const streamRef = React.useRef<MediaStream | null>(null);
  const recordingTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const waveformFrameRef = React.useRef<number | null>(null);
  // Distinguishes the trash/cancel button (discard, back to idle) from the
  // stop button (keep it, go to preview) — both call MediaRecorder.stop(),
  // which only fires one onstop handler, so this flag tells it which
  // outcome the user actually wanted.
  const cancelledRef = React.useRef(false);
  const audioPlayerRef = React.useRef<HTMLAudioElement | null>(null);

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
      setRefineOpen(false);
      setRefineText("");
      setRefining(false);
      setRefineError(null);
      setInputMode("text");
      setRecordingState("idle");
      if (recordedBlobUrl) URL.revokeObjectURL(recordedBlobUrl);
      setRecordedBlobUrl(null);
      setRecordedMimeType(null);
      setRecordingSeconds(0);
      setVoiceRecordingPath(null);
      setVoiceError(null);
      setWaveformLevels(Array(24).fill(4));
      setIsPlaying(false);
      setPlaybackPosition(0);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      if (waveformFrameRef.current) {
        cancelAnimationFrame(waveformFrameRef.current);
        waveformFrameRef.current = null;
      }
      audioContextRef.current?.close().catch(() => {});
      audioContextRef.current = null;
      analyserRef.current = null;
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
          // Aug 2026, NEW: non-null voiceRecordingPath means this question
          // originated from a voice recording (even if edited afterward) —
          // see the voice recording state block for exactly when this
          // clears. ugq-submit needs a matching update to persist these two
          // fields on the new proposal row; harmless extra JSON otherwise.
          input_mode: voiceRecordingPath ? "voice" : "text",
          voice_recording_path: voiceRecordingPath,
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
    if (!proposalId || phase === "publishing" || refining) return;
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

  // Aug 2026, NEW: lets the proposer add extra context and get ugq-screen to
  // regenerate the preview before they commit to Publish — see
  // ugq-refine-preview. Deliberately does NOT touch `phase` (stays
  // "review" throughout) since this is still the same review step, just
  // iterating on it; `refining` is a separate, local loading flag so the
  // Publish/Not now buttons can be disabled during a regeneration without
  // the phase machinery treating this like the publishing step itself.
  async function handleRefine() {
    const trimmedContext = refineText.trim();
    if (trimmedContext.length < REFINE_MIN_LEN || trimmedContext.length > REFINE_MAX_LEN || refining || !proposalId) return;
    setRefining(true);
    setRefineError(null);
    try {
      const jwt = getJwt();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/ugq-refine-preview`, {
        method: "POST",
        headers: supabaseHeaders(jwt),
        body: JSON.stringify({ proposal_id: proposalId, additional_context: trimmedContext }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json?.ok) {
        setRefineError(json?.message ?? "Couldn't regenerate just now. Please try again.");
        return;
      }

      if (json.refined === false) {
        // Backend tried and failed both attempts — it left the existing
        // preview untouched, so just surface the message and keep going.
        setRefineError(json.message ?? "Couldn't regenerate with that context — your original preview is still here.");
        return;
      }

      setPreviewReframe(parsePreviewReframe(json.preview_reframe));
      setRefineOpen(false);
      setRefineText("");
      setRefineError(null);
    } catch (_e) {
      setRefineError("Network error. Please check your connection and try again.");
    } finally {
      setRefining(false);
    }
  }

  // ── Voice recording (Aug 2026, NEW) ──────────────────────────────────────
  // Records via MediaRecorder, then hands the blob to ugq-transcribe-voice
  // and drops the returned transcript straight into `question` — the SAME
  // state the typed flow uses — before switching inputMode back to "text".
  // This means the proposer reviews/edits their transcribed text in the
  // exact same textarea, with the exact same MIN_LEN/MAX_LEN validation and
  // Submit button, that typed proposals already use. No parallel submit
  // path exists for voice; it only ever produces text that feeds the
  // existing one.
  function pickRecorderMimeType(): string | null {
    if (typeof MediaRecorder === "undefined") return null;
    // iOS Safari doesn't support webm/opus at all — only mp4/aac. Feature-
    // detect rather than UA-sniff, since that's robust across browser
    // version changes.
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mp4;codecs=aac"];
    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported?.(type)) return type;
    }
    return ""; // MediaRecorder exists but none of our preferred types matched — let it use its own default
  }

  function stopMediaStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  // Stops the live waveform animation and releases the AudioContext. Safe
  // to call multiple times / when nothing is active.
  function cleanupWaveformAnalysis() {
    if (waveformFrameRef.current) {
      cancelAnimationFrame(waveformFrameRef.current);
      waveformFrameRef.current = null;
    }
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    analyserRef.current = null;
    setWaveformLevels(Array(24).fill(4));
  }

  // Best-effort real-time waveform: samples the mic via an AnalyserNode and
  // renders it as bars in the recording pill. Purely decorative — if
  // AudioContext isn't available (older browser, odd permissions state),
  // recording still works fine, the bars just stay flat.
  function startWaveformLoop(stream: MediaStream) {
    try {
      const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const audioCtx = new AudioContextClass();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64; // small on purpose — gives ~24 chunky bars, not a fine-grained spectrum
      source.connect(analyser);
      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;

      const barsCount = 24;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const chunk = Math.max(1, Math.floor(data.length / barsCount));

      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(data);
        const levels: number[] = [];
        for (let i = 0; i < barsCount; i++) {
          let sum = 0;
          for (let j = 0; j < chunk; j++) sum += data[i * chunk + j] ?? 0;
          const avg = sum / chunk;
          levels.push(Math.max(4, Math.min(28, (avg / 255) * 28)));
        }
        setWaveformLevels(levels);
        waveformFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (_e) {
      // No waveform this session — recording itself is unaffected.
    }
  }

  async function startRecording() {
    setVoiceError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setVoiceError("Voice recording isn't supported in this browser. Please type your question instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickRecorderMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        cleanupWaveformAnalysis();
        stopMediaStream();
        // cancelRecording() sets this before calling stop() — discard
        // entirely and go back to idle rather than the usual "recorded"
        // preview state.
        if (cancelledRef.current) {
          cancelledRef.current = false;
          setRecordingState("idle");
          setRecordingSeconds(0);
          return;
        }
        const usedMimeType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: usedMimeType });
        setRecordedMimeType(usedMimeType);
        setRecordedBlobUrl(URL.createObjectURL(blob));
        setRecordingState("recorded");
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      startWaveformLoop(stream);
      setRecordingState("recording");
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((s) => {
          if (s + 1 >= MAX_RECORDING_SECONDS) {
            stopRecording();
            return MAX_RECORDING_SECONDS;
          }
          return s + 1;
        });
      }, 1000);
    } catch (_e) {
      setVoiceError("Couldn't access your microphone. Check your browser's permission settings, or type your question instead.");
    }
  }

  // Stop + keep: transitions to the "recorded" preview/playback state.
  function stopRecording() {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    mediaRecorderRef.current?.stop();
  }

  // Stop + discard (the trash icon shown WHILE recording, matching the
  // WhatsApp-style pattern) — goes straight back to idle, skips the preview
  // state entirely.
  function cancelRecording() {
    cancelledRef.current = true;
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    mediaRecorderRef.current?.stop();
    setVoiceError(null);
  }

  function discardAndReRecord() {
    if (recordedBlobUrl) URL.revokeObjectURL(recordedBlobUrl);
    setRecordedBlobUrl(null);
    setRecordedMimeType(null);
    setRecordingSeconds(0);
    setRecordingState("idle");
    setVoiceError(null);
    setIsPlaying(false);
    setPlaybackPosition(0);
    setVoiceRecordingPath(null); // explicit "start over" — this is the one action that clears voice origin
  }

  function togglePlayback() {
    const audio = audioPlayerRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
  }

  async function handleUseRecording() {
    if (!recordedBlobUrl || !recordedMimeType) return;
    setRecordingState("transcribing");
    setVoiceError(null);
    try {
      const blobRes = await fetch(recordedBlobUrl);
      const blob = await blobRes.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Read failed"));
        reader.readAsDataURL(blob);
      });

      const jwt = getJwt();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/ugq-transcribe-voice`, {
        method: "POST",
        headers: supabaseHeaders(jwt),
        body: JSON.stringify({ audio_base64: base64, mime_type: recordedMimeType }),
      });
      const resJson = await res.json().catch(() => ({}));

      if (!res.ok || !resJson?.ok) {
        setVoiceError(resJson?.message ?? "Couldn't transcribe that recording. Please try again.");
        setRecordingState("recorded"); // back to the playback/retry state, keep the recording
        return;
      }

      setQuestion(String(resJson.transcript ?? "").slice(0, MAX_LEN));
      setVoiceRecordingPath(typeof resJson.voice_recording_path === "string" ? resJson.voice_recording_path : null);
      if (recordedBlobUrl) URL.revokeObjectURL(recordedBlobUrl);
      setRecordedBlobUrl(null);
      setRecordedMimeType(null);
      setRecordingState("idle");
      setInputMode("text"); // hand off to the existing text review/submit flow
    } catch (_e) {
      setVoiceError("Network error while transcribing. Please try again.");
      setRecordingState("recorded");
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
    // Aug 2026, NEW: if the proposer closes the modal mid-recording, stop
    // the mic stream, timer, and waveform analysis rather than leaving them
    // running in the background — the reset effect handles this on the NEXT
    // open, but there's no reason to keep the mic live in the meantime.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (waveformFrameRef.current) {
      cancelAnimationFrame(waveformFrameRef.current);
      waveformFrameRef.current = null;
    }
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    analyserRef.current = null;
    onOpenChange(false);
  }

  // Decorative bar pattern for the "recorded" playback state — NOT a real
  // waveform of the audio (that needs offline decoding, more complexity
  // than this UI polish pass warrants); the LIVE recording bars above are
  // real (driven by AnalyserNode), this static pattern just echoes that
  // visual language while previewing. Regenerates per new recording via the
  // recordedBlobUrl dependency so it isn't identical every time, but is
  // stable within one preview (doesn't jitter on re-render).
  const playbackBarHeights = React.useMemo(
    () => Array.from({ length: 28 }, (_, i) => 6 + Math.round(10 * Math.abs(Math.sin(i * 0.9)))),
    [recordedBlobUrl],
  );

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

            {/* Aug 2026, NEW: "add more context and regenerate" — lets the
                proposer course-correct the preview before Publish instead of
                either publishing something that missed the mark or
                abandoning the proposal outright. */}
            {preview ? (
              <div className="pt-0.5">
                {!refineOpen ? (
                  <button
                    type="button"
                    onClick={() => setRefineOpen(true)}
                    disabled={refining}
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline disabled:opacity-50"
                  >
                    <Wand2 className="h-3 w-3" /> Add more context and regenerate
                  </button>
                ) : (
                  <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <Label htmlFor="ugq-refine-context" className="text-xs text-slate-600">
                      What should we add or fix?
                    </Label>
                    <Textarea
                      id="ugq-refine-context"
                      value={refineText}
                      onChange={(e) => setRefineText(e.target.value.slice(0, REFINE_MAX_LEN))}
                      placeholder="e.g. this happened in March, or it's specifically about UP"
                      rows={2}
                      disabled={refining}
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-400">
                        {refineText.trim().length}/{REFINE_MAX_LEN}
                      </span>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={refining}
                          onClick={() => { setRefineOpen(false); setRefineText(""); setRefineError(null); }}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          disabled={refining || refineText.trim().length < REFINE_MIN_LEN}
                          onClick={handleRefine}
                        >
                          {refining ? (
                            <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Regenerating&#x2026;</>
                          ) : (
                            "Regenerate preview"
                          )}
                        </Button>
                      </div>
                    </div>
                    {refineError ? <p className="text-xs text-red-600">{refineError}</p> : null}
                  </div>
                )}
              </div>
            ) : null}

            {errorMsg ? <p className="text-sm text-red-600">{errorMsg}</p> : null}

            <DialogFooter>
              <Button variant="ghost" onClick={close} disabled={phase === "publishing" || refining}>
                {preview ? "Not now" : "Done"}
              </Button>
              {preview ? (
                <Button onClick={handlePublish} disabled={phase === "publishing" || refining}>
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
                <div className="flex items-center justify-between">
                  <Label htmlFor="ugq-question">Your question</Label>
                  {/* Aug 2026, NEW: Type/Record toggle. Disabled mid-recording
                      or mid-transcription so switching away doesn't orphan
                      a live mic stream or in-flight request. */}
                  <div className="flex rounded-md border border-slate-200 p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setInputMode("text")}
                      disabled={recordingState === "recording" || recordingState === "transcribing"}
                      className={`px-2.5 py-1 rounded transition-colors disabled:opacity-50 ${
                        inputMode === "text" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      Type
                    </button>
                    <button
                      type="button"
                      onClick={() => setInputMode("voice")}
                      disabled={recordingState === "recording" || recordingState === "transcribing"}
                      className={`px-2.5 py-1 rounded flex items-center gap-1 transition-colors disabled:opacity-50 ${
                        inputMode === "voice" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      <Mic className="h-3 w-3" /> Record
                    </button>
                  </div>
                </div>

                {inputMode === "text" ? (
                  <>
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
                    {voiceRecordingPath ? (
                      <div className="flex items-center gap-1 text-[11px] text-slate-500">
                        <Mic className="h-3 w-3" />
                        <span>From your recording</span>
                        <span>&#183;</span>
                        <button
                          type="button"
                          onClick={() => { discardAndReRecord(); setInputMode("voice"); }}
                          className="text-blue-600 hover:underline"
                        >
                          Record again
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-5 flex flex-col items-center justify-center gap-2.5 min-h-[148px]">
                    {recordingState === "idle" ? (
                      <>
                        <button
                          type="button"
                          onClick={startRecording}
                          aria-label="Start recording"
                          className="h-14 w-14 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-colors"
                        >
                          <Mic className="h-6 w-6" />
                        </button>
                        <p className="text-xs text-slate-500">Tap to record &#183; up to {formatMMSS(MAX_RECORDING_SECONDS)}</p>
                      </>
                    ) : recordingState === "recording" ? (
                      <>
                        <div className="w-full flex items-center gap-2.5 rounded-full border border-slate-200 bg-white pl-2 pr-2 py-2 shadow-sm">
                          <button
                            type="button"
                            onClick={cancelRecording}
                            aria-label="Cancel recording"
                            className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          <span className="h-2 w-2 shrink-0 rounded-full bg-red-500 animate-pulse" />
                          <span className="text-sm tabular-nums text-slate-700 shrink-0">{formatMMSS(recordingSeconds)}</span>
                          <div className="flex-1 flex items-center justify-center gap-[3px] h-8 overflow-hidden">
                            {waveformLevels.map((h, i) => (
                              <span
                                key={i}
                                className="w-[3px] rounded-full bg-slate-400 transition-[height] duration-75"
                                style={{ height: `${h}px` }}
                              />
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={stopRecording}
                            aria-label="Stop recording"
                            className="h-9 w-9 shrink-0 rounded-full bg-slate-900 hover:bg-slate-800 text-white flex items-center justify-center"
                          >
                            <Square className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <p className="text-[11px] text-slate-400">up to {formatMMSS(MAX_RECORDING_SECONDS)}</p>
                      </>
                    ) : recordingState === "recorded" ? (
                      <>
                        <div className="w-full flex items-center gap-2.5 rounded-full border border-slate-200 bg-white pl-2 pr-2 py-2 shadow-sm">
                          <button
                            type="button"
                            onClick={discardAndReRecord}
                            aria-label="Discard recording"
                            className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={togglePlayback}
                            aria-label={isPlaying ? "Pause" : "Play"}
                            className="h-8 w-8 shrink-0 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
                          >
                            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
                          </button>
                          <div className="flex-1 flex items-center gap-[3px] h-8 overflow-hidden">
                            {playbackBarHeights.map((h, i) => (
                              <span
                                key={i}
                                className={`w-[3px] rounded-full bg-slate-300 ${isPlaying ? "animate-pulse" : ""}`}
                                style={{ height: `${h}px`, animationDelay: `${i * 40}ms` }}
                              />
                            ))}
                          </div>
                          <span className="text-xs tabular-nums text-slate-500 shrink-0">
                            {formatMMSS(isPlaying || playbackPosition > 0 ? Math.floor(playbackPosition) : recordingSeconds)}
                          </span>
                          <button
                            type="button"
                            onClick={handleUseRecording}
                            aria-label="Use this recording"
                            className="h-9 w-9 shrink-0 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        </div>
                        <audio
                          ref={audioPlayerRef}
                          src={recordedBlobUrl ?? undefined}
                          className="hidden"
                          onPlay={() => setIsPlaying(true)}
                          onPause={() => setIsPlaying(false)}
                          onEnded={() => { setIsPlaying(false); setPlaybackPosition(0); }}
                          onTimeUpdate={(e) => setPlaybackPosition(e.currentTarget.currentTime)}
                        />
                      </>
                    ) : (
                      <>
                        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
                        <p className="text-xs text-slate-500">Transcribing your recording&#x2026;</p>
                      </>
                    )}
                    {voiceError ? <p className="text-xs text-red-600 text-center">{voiceError}</p> : null}
                  </div>
                )}
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
              <Button onClick={handleSubmit} disabled={!canSubmit || recordingState === "recording" || recordingState === "transcribing"}>
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
