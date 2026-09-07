// src/components/ugq/VideoRecorderPanel.tsx
// Epic X — video capture panel.
//
// Flow:
//   1. Record video+audio via MediaRecorder AND, in parallel on the same
//      MediaStream, a second audio-only MediaRecorder. Two tracks from one
//      getUserMedia() call, not two separate recordings.
//   2. On stop: upload the video blob via ugq-upload-video; send the
//      audio-only blob through whatever the EXISTING voice transcription
//      flow already uses (VoiceRecorderPanel / ugq-transcribe-voice) — wired
//      here as a prop so this component doesn't have to guess that contract.
//   3. Show the transcript for review/edit, same review step voice already
//      has — the EDITED text becomes raw_question; the ORIGINAL unedited
//      transcript is kept separately as video_raw_transcript for the
//      framing gate (see ugq-screen), since the audio track in the
//      published clip can't be un-said by a later text edit.
//   4. Submit via ugq-submit with input_mode: "video".
//
// Deliberately does NOT ask the proposer to pick a publish choice here —
// that happens later, at ugq-confirm-publish time, once they've seen the
// full preview (see VideoPublishChoice.tsx).
//
// Auth: uses the same getJwt()/supabaseHeaders() pattern as every other
// user-facing raw-fetch call in this codebase (see ProposeQuestionModal.tsx,
// src/lib/env.ts) — NOT a hand-rolled localStorage reader. The gateway for
// this project requires the `apikey` header on every request in addition to
// the user's Authorization bearer token; supabaseHeaders() is the only
// place that's supposed to know that.
//
// Anonymous-video feature (NEW): whether the proposer is currently in
// profiles.display_handle_mode = 'random_id' is snapshotted ONCE, right
// when recording starts (useDisplayIdentity + the `anonymousAtRecordStart`
// ref below) — not re-checked mid-flow. That snapshot decides which capture
// pipeline runs for THIS recording:
//   - Identified (username mode): unchanged from before this feature —
//     raw video is the public artifact, exactly as always.
//   - Anonymous (random_id mode): a THIRD parallel pipeline renders the
//     user's persistent avatar (avatarRenderer.ts) driven by a
//     voice-disguised copy of the mic audio (pitchShift.ts), and records
//     THAT as the public artifact instead. The original raw camera+mic
//     recording is kept, but uploaded as a private archival-only copy
//     (kind: "raw_archival" — see ugq-upload-video), never as the public
//     path. The live preview shows the avatar, not the camera, during
//     recording, so the proposer sees exactly what's about to be public.
// See the anonymous-video plan for the full design and why ugq-video-url
// itself needed no changes to support this.

import { useCallback, useEffect, useRef, useState } from "react";
import { SUPABASE_URL, SUPABASE_ANON_KEY, getJwt, supabaseHeaders } from "@/lib/env";
import { useDisplayIdentity } from "@/hooks/useDisplayIdentity";
import { AvatarRenderer } from "./avatarRenderer";
import { createDistortedAudio, type DistortedAudio } from "./pitchShift";
import type { AnonymousAvatarConfig } from "./avatarConfig";

const MAX_DURATION_SECONDS = 120;

type TranscribeVoiceFn = (audioBlob: Blob) => Promise<{ transcript: string; recording_path?: string }>;

type Props = {
  // Reuses whatever the existing voice-input flow calls to transcribe audio
  // — pass VoiceRecorderPanel's existing transcription call here rather
  // than duplicating it. This component doesn't call ugq-transcribe-voice
  // directly since its exact request/response contract wasn't available
  // this session.
  transcribeAudio: TranscribeVoiceFn;
  // Sep 2026, NEW: the modal's existing Source Link / Location fields apply
  // to video proposals too (ugq-submit accepts them regardless of
  // input_mode) — without these, values typed into those fields would be
  // silently dropped since this component posts its own submit body.
  sourceUrl?: string | null;
  locationLabel?: string | null;
  // Sep 2026, NEW: when set, this is a RESUBMIT of an existing
  // resubmit_requested video proposal (see ProposalDetailPage.tsx) rather
  // than a brand-new one — submit() calls ugq-resubmit-video with this id
  // instead of ugq-submit, updating the SAME row in place (that's what
  // actually drives its existing video_resubmit_count) rather than creating
  // a second proposal for what's conceptually one question. Recording,
  // transcribing and reviewing all work identically either way — only the
  // final submit target changes.
  resubmitProposalId?: string;
  onSubmitted: (result: {
    proposalId: string;
    status: string;
    framingFlagReason: string | null;
    // Sep 2026, NEW: informational recommendation, independent of status —
    // see ugq-screen's checkVideoFraming / VideoPublishChoice.tsx. Present
    // even when status is "in_review" (never forces a resubmit the way
    // framingFlagReason's "leading" verdict does).
    derogatoryFlagReason: string | null;
    // Anonymous-video feature, NEW: an object URL for the exact public
    // artifact that was just uploaded (avatar video if this recording was
    // anonymous, raw video otherwise) — so the caller can show it back to
    // the proposer for a final look before Publish (see VideoPublishChoice
    // and the plan's "mandatory pre-publish confirmation"). The caller owns
    // revoking this URL when done with it.
    previewVideoUrl: string | null;
  }) => void;
  onCancel: () => void;
};

type Stage = "idle" | "recording" | "processing" | "review" | "submitting" | "resubmit";

export function VideoRecorderPanel({ transcribeAudio, sourceUrl = null, locationLabel = null, resubmitProposalId, onSubmitted, onCancel }: Props) {
  const [stage, setStage] = useState<Stage>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [editedTranscript, setEditedTranscript] = useState("");
  const [rawTranscript, setRawTranscript] = useState("");
  const [resubmitReason, setResubmitReason] = useState<string | null>(null);
  const [recordingAnonymously, setRecordingAnonymously] = useState(false);

  const { identity, ensureAvatarConfig } = useDisplayIdentity();

  const streamRef = useRef<MediaStream | null>(null);
  // "raw" = the true camera+mic recording. Public artifact when identified;
  // archival-only upload when anonymous (see header note).
  const rawRecorderRef = useRef<MediaRecorder | null>(null);
  const rawChunksRef = useRef<Blob[]>([]);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  // Only populated when recording anonymously — the avatar+disguised-voice
  // recording that becomes the public artifact instead of the raw one.
  const avatarRecorderRef = useRef<MediaRecorder | null>(null);
  const avatarChunksRef = useRef<Blob[]>([]);
  const avatarRendererRef = useRef<AvatarRenderer | null>(null);
  const distortedAudioRef = useRef<DistortedAudio | null>(null);
  const avatarConfigRef = useRef<AnonymousAvatarConfig | null>(null);

  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const canvasPreviewRef = useRef<HTMLCanvasElement | null>(null);
  const mirrorRafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rawBlobRef = useRef<Blob | null>(null);
  const publicBlobRef = useRef<Blob | null>(null);
  // Snapshotted once at record start — see header note. Never re-read
  // mid-flow so a mode toggle elsewhere can't change which pipeline this
  // specific recording uses partway through.
  const anonymousAtRecordStartRef = useRef(false);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
      if (mirrorRafRef.current !== null) cancelAnimationFrame(mirrorRafRef.current);
      avatarRendererRef.current?.stop();
      distortedAudioRef.current?.close();
    };
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;

      const isAnonymous = identity?.isAnonymous ?? true; // fail toward the more private path if identity hasn't loaded yet
      anonymousAtRecordStartRef.current = isAnonymous;
      setRecordingAnonymously(isAnonymous);

      rawChunksRef.current = [];
      audioChunksRef.current = [];
      avatarChunksRef.current = [];

      // Raw camera+mic recorder — always runs. Public artifact when
      // identified; archival-only when anonymous.
      const rawRecorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      rawRecorder.ondataavailable = (e) => { if (e.data.size > 0) rawChunksRef.current.push(e.data); };
      rawRecorderRef.current = rawRecorder;

      // Same stream, audio track only — for transcription, always
      // UNDISTORTED regardless of mode, so voice disguise never affects
      // transcript accuracy.
      const audioOnlyStream = new MediaStream(stream.getAudioTracks());
      const audioRecorder = new MediaRecorder(audioOnlyStream, { mimeType: "audio/webm" });
      audioRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      audioRecorderRef.current = audioRecorder;

      if (isAnonymous) {
        const config = await ensureAvatarConfig();
        avatarConfigRef.current = config;

        const distortedAudio = await createDistortedAudio(stream);
        distortedAudioRef.current = distortedAudio;

        const avatarRenderer = new AvatarRenderer(config);
        avatarRenderer.attachAudioSource(distortedAudio.audioContext, distortedAudio.pitchShiftNode);
        avatarRenderer.start();
        avatarRendererRef.current = avatarRenderer;

        if (canvasPreviewRef.current) {
          const ctx2d = canvasPreviewRef.current.getContext("2d");
          // Mirror the avatar canvas into the visible preview canvas each
          // frame — keeps AvatarRenderer's own offscreen canvas as the
          // single source of truth for both the live preview and the
          // recorded stream.
          const mirror = () => {
            if (!canvasPreviewRef.current || !ctx2d) return;
            ctx2d.drawImage(avatarRenderer.canvasElement, 0, 0, canvasPreviewRef.current.width, canvasPreviewRef.current.height);
            mirrorRafRef.current = requestAnimationFrame(mirror);
          };
          mirror();
        }

        const avatarStream = new MediaStream([
          ...avatarRenderer.captureStream(24).getVideoTracks(),
          ...distortedAudio.destinationStream.getAudioTracks(),
        ]);
        const avatarRecorder = new MediaRecorder(avatarStream, { mimeType: "video/webm" });
        avatarRecorder.ondataavailable = (e) => { if (e.data.size > 0) avatarChunksRef.current.push(e.data); };
        avatarRecorderRef.current = avatarRecorder;
        avatarRecorder.start();
      } else if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        await videoPreviewRef.current.play().catch(() => {});
      }

      rawRecorder.start();
      audioRecorder.start();
      setStage("recording");
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => {
        setElapsedSeconds((s) => {
          if (s + 1 >= MAX_DURATION_SECONDS) {
            stopRecording();
            return MAX_DURATION_SECONDS;
          }
          return s + 1;
        });
      }, 1000);
    } catch (e) {
      setError("Couldn't access your camera and microphone. Check permissions and try again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, ensureAvatarConfig]);

  const stopRecording = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    rawRecorderRef.current?.stop();
    audioRecorderRef.current?.stop();
    avatarRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    avatarRendererRef.current?.stop();
    if (mirrorRafRef.current !== null) { cancelAnimationFrame(mirrorRafRef.current); mirrorRafRef.current = null; }
    setStage("processing");

    // MediaRecorder's onstop fires after the last dataavailable event —
    // give recorders a tick to flush before reading the chunk arrays.
    setTimeout(async () => {
      const rawBlob = new Blob(rawChunksRef.current, { type: "video/webm" });
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      rawBlobRef.current = rawBlob;

      if (anonymousAtRecordStartRef.current) {
        publicBlobRef.current = new Blob(avatarChunksRef.current, { type: "video/webm" });
        distortedAudioRef.current?.close();
        distortedAudioRef.current = null;
      } else {
        publicBlobRef.current = rawBlob;
      }

      try {
        const { transcript } = await transcribeAudio(audioBlob);
        setRawTranscript(transcript);
        setEditedTranscript(transcript);
        setStage("review");
      } catch (e) {
        setError("Couldn't transcribe your recording. You can try again.");
        setStage("idle");
      }
    }, 300);
  }, [transcribeAudio]);

  const uploadVideo = useCallback(async (blob: Blob, jwt: string, kind: "public" | "raw_archival") => {
    const form = new FormData();
    form.append("video", blob, "recording.webm");
    form.append("duration_seconds", String(elapsedSeconds));
    form.append("kind", kind);
    const uploadResp = await fetch(`${SUPABASE_URL}/functions/v1/ugq-upload-video`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
      body: form,
    });
    const uploadJson = await uploadResp.json();
    if (!uploadResp.ok || !uploadJson.ok) {
      throw new Error(uploadJson.message ?? "Video upload failed");
    }
    return uploadJson as { video_recording_path: string; video_duration_seconds: number | null };
  }, [elapsedSeconds]);

  const submit = useCallback(async () => {
    if (editedTranscript.trim().length < 20) {
      setError("Question must be at least 20 characters once transcribed/edited.");
      return;
    }
    const jwt = getJwt();
    if (!jwt) {
      setError("Please sign in again.");
      return;
    }
    setStage("submitting");
    setError(null);

    try {
      // 1. Upload the public artifact — the avatar video when this
      //    recording was anonymous, the raw video otherwise. multipart/
      //    form-data — do NOT send a Content-Type header here (the browser
      //    sets its own multipart boundary for FormData bodies); still
      //    needs apikey + Authorization like every other call to this
      //    project's Edge Functions gateway.
      const publicUpload = await uploadVideo(publicBlobRef.current!, jwt, "public");

      // Anonymous-video feature, NEW: also upload the true raw recording as
      // a private, archival-only copy — never referenced by any
      // public-facing playback path (see ugq-upload-video's "kind" field
      // and admin-ugq-raw-video-url, the only reader).
      let videoRawArchivalPath: string | null = null;
      if (anonymousAtRecordStartRef.current && rawBlobRef.current) {
        const archivalUpload = await uploadVideo(rawBlobRef.current, jwt, "raw_archival");
        videoRawArchivalPath = archivalUpload.video_recording_path;
      }

      // 2. Submit — editedTranscript (proposer-reviewed) is raw_question;
      //    rawTranscript (untouched) is video_raw_transcript, which is what
      //    the framing gate in ugq-screen actually checks. A resubmit hits
      //    ugq-resubmit-video (same proposal_id, in place) instead of
      //    ugq-submit (which would create a new proposal) — see the
      //    resubmitProposalId prop comment.
      const submitResp = resubmitProposalId
        ? await fetch(`${SUPABASE_URL}/functions/v1/ugq-resubmit-video`, {
            method: "POST",
            headers: supabaseHeaders(jwt),
            body: JSON.stringify({
              proposal_id: resubmitProposalId,
              raw_question: editedTranscript.trim(),
              video_recording_path: publicUpload.video_recording_path,
              video_duration_seconds: publicUpload.video_duration_seconds,
              video_raw_transcript: rawTranscript.trim(),
              video_raw_archival_path: videoRawArchivalPath,
            }),
          })
        : await fetch(`${SUPABASE_URL}/functions/v1/ugq-submit`, {
            method: "POST",
            headers: supabaseHeaders(jwt),
            body: JSON.stringify({
              raw_question: editedTranscript.trim(),
              input_mode: "video",
              video_recording_path: publicUpload.video_recording_path,
              video_duration_seconds: publicUpload.video_duration_seconds,
              video_raw_transcript: rawTranscript.trim(),
              video_raw_archival_path: videoRawArchivalPath,
              source_url: sourceUrl?.trim() || null,
              location_label: locationLabel?.trim() || null,
            }),
          });
      const submitJson = await submitResp.json();
      if (!submitResp.ok || !submitJson.ok) {
        throw new Error(submitJson.message ?? "Submission failed");
      }

      // Sep 2026: "rejected" reuses the same re-record UI as
      // "resubmit_requested" — both are dead ends without it (nothing else
      // resets `stage` out of "submitting"). Gate 1 can reject a video for
      // reasons unrelated to framing (duplicate, low quality, safety), so
      // the message comes from ugq-submit's own computed `message` rather
      // than framing_flag_reason, which is only meaningful for the leading case.
      if (submitJson.status === "resubmit_requested" || submitJson.status === "rejected") {
        setResubmitReason(
          submitJson.status === "resubmit_requested"
            ? (submitJson.framing_flag_reason ?? "Please try asking this more neutrally.")
            : (submitJson.message ?? "Your question wasn't accepted. You can try re-recording.")
        );
        setStage("resubmit");
        return;
      }

      onSubmitted({
        proposalId: submitJson.proposal_id,
        status: submitJson.status,
        framingFlagReason: submitJson.framing_flag_reason ?? null,
        derogatoryFlagReason: submitJson.derogatory_flag_reason ?? null,
        previewVideoUrl: publicBlobRef.current ? URL.createObjectURL(publicBlobRef.current) : null,
      });
    } catch (e) {
      setError((e as Error).message || "Something went wrong. Please try again.");
      setStage("review");
    }
  }, [editedTranscript, rawTranscript, sourceUrl, locationLabel, resubmitProposalId, onSubmitted, uploadVideo]);

  const reRecord = useCallback(() => {
    setStage("idle");
    setElapsedSeconds(0);
    setResubmitReason(null);
    setRawTranscript("");
    setEditedTranscript("");
    rawBlobRef.current = null;
    publicBlobRef.current = null;
  }, []);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 p-4">
      {error && (
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {(stage === "idle" || stage === "recording") && (
        <div className="flex flex-col gap-3">
          {identity?.isAnonymous && (
            <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Recording anonymously — your voice will be disguised and your avatar will speak in your place. Only you will ever see the raw footage; it's never shown to anyone else.
            </div>
          )}
          <video
            ref={videoPreviewRef}
            muted
            playsInline
            hidden={!!identity?.isAnonymous}
            className="aspect-video w-full rounded-md bg-neutral-900 object-cover"
          />
          <canvas
            ref={canvasPreviewRef}
            width={480}
            height={360}
            hidden={!identity?.isAnonymous}
            className="aspect-video w-full rounded-md bg-neutral-900"
          />
          {stage === "recording" && (
            <p className="text-sm text-neutral-600">
              {elapsedSeconds}s / {MAX_DURATION_SECONDS}s
            </p>
          )}
          <div className="flex gap-2">
            {stage === "idle" ? (
              <button
                type="button"
                onClick={startRecording}
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
              >
                Start recording
              </button>
            ) : (
              <button
                type="button"
                onClick={stopRecording}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white"
              >
                Stop recording
              </button>
            )}
            <button type="button" onClick={onCancel} className="rounded-md px-4 py-2 text-sm text-neutral-600">
              Cancel
            </button>
          </div>
        </div>
      )}

      {stage === "processing" && (
        <p className="text-sm text-neutral-600">Transcribing your question…</p>
      )}

      {stage === "review" && (
        <div className="flex flex-col gap-3">
          <label className="text-sm font-medium text-neutral-900">
            Here's what we heard — edit if needed
          </label>
          <textarea
            value={editedTranscript}
            onChange={(e) => setEditedTranscript(e.target.value)}
            rows={4}
            className="rounded-md border border-neutral-300 p-2 text-sm"
          />
          <p className="text-xs text-neutral-500">
            {recordingAnonymously
              ? "This is what shows as your question text. Your voice was disguised and your face was never shown — only your avatar will be published."
              : "This is what shows as your question text. Your original video and voice stay exactly as recorded either way."}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submit}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
            >
              Submit question
            </button>
            <button type="button" onClick={reRecord} className="rounded-md px-4 py-2 text-sm text-neutral-600">
              Re-record
            </button>
          </div>
        </div>
      )}

      {stage === "submitting" && <p className="text-sm text-neutral-600">Submitting…</p>}

      {stage === "resubmit" && (
        <div className="flex flex-col gap-3">
          <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {resubmitReason}
          </div>
          <button
            type="button"
            onClick={reRecord}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
          >
            Re-record
          </button>
        </div>
      )}
    </div>
  );
}
