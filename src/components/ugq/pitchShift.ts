// src/components/ugq/pitchShift.ts
// Anonymous-video feature — voice disguise, built on the AudioWorklet at
// public/audio-worklets/pitch-shift-processor.js (see that file for the
// actual algorithm). This module just wires up the Web Audio graph:
// mic track -> pitch-shift worklet -> MediaStreamDestination (for the
// recorder) and, separately, the caller can tap the same worklet node for
// AvatarRenderer's mouth-shape analysis, so what's heard and what's seen
// stay in sync.
//
// A fresh AudioContext is created per call (one per recording session) —
// AudioWorklet modules are registered per-context, so there is no cross-
// session module cache to manage here.

const PITCH_SHIFT_WORKLET_URL = "/audio-worklets/pitch-shift-processor.js";

// < 1 lowers pitch. Fixed rather than user-configurable — the goal is
// reliable disguise, not a voice-effects picker; a moderate, consistent
// shift is enough to obscure a recognizable voice while staying
// intelligible.
const DEFAULT_PITCH_RATIO = 0.8;

export type DistortedAudio = {
  audioContext: AudioContext;
  // Feed this into the public MediaRecorder alongside the avatar canvas's
  // video track.
  destinationStream: MediaStream;
  // Same disguised signal, for AvatarRenderer.attachAudioSource — so the
  // avatar's mouth moves in sync with the voice that's actually recorded,
  // not the original undistorted mic input.
  pitchShiftNode: AudioWorkletNode;
  close: () => void;
};

export async function createDistortedAudio(
  sourceStream: MediaStream,
  pitchRatio: number = DEFAULT_PITCH_RATIO,
): Promise<DistortedAudio> {
  const audioContext = new AudioContext();
  await audioContext.audioWorklet.addModule(PITCH_SHIFT_WORKLET_URL);

  const sourceNode = audioContext.createMediaStreamSource(sourceStream);
  const pitchShiftNode = new AudioWorkletNode(audioContext, "pitch-shift-processor");
  const ratioParam = pitchShiftNode.parameters.get("pitchRatio");
  if (ratioParam) ratioParam.value = pitchRatio;

  const destination = audioContext.createMediaStreamDestination();
  sourceNode.connect(pitchShiftNode);
  pitchShiftNode.connect(destination);

  return {
    audioContext,
    destinationStream: destination.stream,
    pitchShiftNode,
    close: () => { void audioContext.close(); },
  };
}
