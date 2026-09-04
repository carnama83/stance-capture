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

import { useCallback, useEffect, useRef, useState } from "react";
import { SUPABASE_URL, SUPABASE_ANON_KEY, getJwt, supabaseHeaders } from "@/lib/env";

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
  onSubmitted: (result: {
    proposalId: string;
    status: string;
    framingFlagReason: string | null;
    // Sep 2026, NEW: informational recommendation, independent of status —
    // see ugq-screen's checkVideoFraming / VideoPublishChoice.tsx. Present
    // even when status is "in_review" (never forces a resubmit the way
    // framingFlagReason's "leading" verdict does).
    derogatoryFlagReason: string | null;
  }) => void;
  onCancel: () => void;
};

type Stage = "idle" | "recording" | "processing" | "review" | "submitting" | "resubmit";

export function VideoRecorderPanel({ transcribeAudio, sourceUrl = null, locationLabel = null, onSubmitted, onCancel }: Props) {
  const [stage, setStage] = useState<Stage>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [editedTranscript, setEditedTranscript] = useState("");
  const [rawTranscript, setRawTranscript] = useState("");
  const [resubmitReason, setResubmitReason] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const audioChunksRef = useRef<Blob[]>([]);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoBlobRef = useRef<Blob | null>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        await videoPreviewRef.current.play().catch(() => {});
      }

      videoChunksRef.current = [];
      audioChunksRef.current = [];

      const videoRecorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      videoRecorder.ondataavailable = (e) => { if (e.data.size > 0) videoChunksRef.current.push(e.data); };
      videoRecorderRef.current = videoRecorder;

      // Same stream, audio track only — two independent recorders on one
      // getUserMedia() call, not a second recording.
      const audioOnlyStream = new MediaStream(stream.getAudioTracks());
      const audioRecorder = new MediaRecorder(audioOnlyStream, { mimeType: "audio/webm" });
      audioRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      audioRecorderRef.current = audioRecorder;

      videoRecorder.start();
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
  }, []);

  const stopRecording = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    videoRecorderRef.current?.stop();
    audioRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setStage("processing");

    // MediaRecorder's onstop fires after the last dataavailable event —
    // give both recorders a tick to flush before reading the chunk arrays.
    setTimeout(async () => {
      const videoBlob = new Blob(videoChunksRef.current, { type: "video/webm" });
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      videoBlobRef.current = videoBlob;

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
      // 1. Upload the raw video. multipart/form-data — do NOT send a
      //    Content-Type header here (the browser sets its own multipart
      //    boundary for FormData bodies); still needs apikey + Authorization
      //    like every other call to this project's Edge Functions gateway.
      const form = new FormData();
      form.append("video", videoBlobRef.current!, "recording.webm");
      form.append("duration_seconds", String(elapsedSeconds));
      const uploadResp = await fetch(`${SUPABASE_URL}/functions/v1/ugq-upload-video`, {
        method: "POST",
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
        body: form,
      });
      const uploadJson = await uploadResp.json();
      if (!uploadResp.ok || !uploadJson.ok) {
        throw new Error(uploadJson.message ?? "Video upload failed");
      }

      // 2. Submit the proposal — editedTranscript (proposer-reviewed) is
      //    raw_question; rawTranscript (untouched) is video_raw_transcript,
      //    which is what the framing gate in ugq-screen actually checks.
      const submitResp = await fetch(`${SUPABASE_URL}/functions/v1/ugq-submit`, {
        method: "POST",
        headers: supabaseHeaders(jwt),
        body: JSON.stringify({
          raw_question: editedTranscript.trim(),
          input_mode: "video",
          video_recording_path: uploadJson.video_recording_path,
          video_duration_seconds: uploadJson.video_duration_seconds,
          video_raw_transcript: rawTranscript.trim(),
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
      });
    } catch (e) {
      setError((e as Error).message || "Something went wrong. Please try again.");
      setStage("review");
    }
  }, [editedTranscript, rawTranscript, elapsedSeconds, sourceUrl, locationLabel, onSubmitted]);

  const reRecord = useCallback(() => {
    setStage("idle");
    setElapsedSeconds(0);
    setResubmitReason(null);
    setRawTranscript("");
    setEditedTranscript("");
    videoBlobRef.current = null;
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
          <video
            ref={videoPreviewRef}
            muted
            playsInline
            className="aspect-video w-full rounded-md bg-neutral-900 object-cover"
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
            This is what shows as your question text. Your original video and voice stay exactly as recorded either way.
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
