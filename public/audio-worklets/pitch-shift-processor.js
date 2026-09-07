// public/audio-worklets/pitch-shift-processor.js
// Anonymous-video feature — voice disguise.
//
// Loaded via audioContext.audioWorklet.addModule("/audio-worklets/pitch-shift-processor.js")
// from src/components/ugq/pitchShift.ts. Must be a plain static file (not
// bundled) because AudioWorklet modules run on a separate audio-rendering
// thread with its own module loader, isolated from the page's own JS
// bundle/imports.
//
// Sep 2026, REWRITTEN — the original version had a real bug, not just an
// aggressive setting: it kept a single read pointer drifting continuously
// across a large ring buffer at `pitchRatio` speed while the write pointer
// advanced at 1x, so the gap between them grew without bound and wrapped
// around the whole buffer roughly once a second — producing an audible
// jump/glitch at that wraparound, on top of a "grain crossfade" that was
// keyed off the read pointer's own arbitrary phase rather than anything
// related to that wraparound, so it never actually masked it. Net effect:
// intelligible speech went in, a garbled mess came out.
//
// This version uses a standard granular/PSOLA-style pitch shifter instead
// (the same family of technique behind e.g. SuperCollider's PitchShift
// UGen): 4 overlapping "voices", each a short (grainSamples-long) Hann-
// windowed grain. Each voice's read position is RESET, every time its own
// window cycle completes, to a fixed short delay (one grain length) behind
// the CURRENT write pointer — never allowed to drift further than that, so
// there is no long-range wraparound to glitch on. The 4 voices are phase-
// offset by a quarter-cycle each (0%, 25%, 50%, 75% through their window),
// which is the standard spacing at which overlapping Hann windows sum to a
// constant amplitude (divided out below) — this is what actually eliminates
// the audible tremolo/warble a naive 2-voice crossfade produces, not just
// the wraparound bug.

const GRAIN_SECONDS = 0.1; // 100ms grain — smooth for speech without smearing transients too much
const NUM_VOICES = 4; // 75% overlap, phase-spaced a quarter grain apart
const BUFFER_SECONDS = 0.5; // circular delay buffer, generous vs. grain length

class PitchShiftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // < 1 lowers pitch, > 1 raises it. Default: a moderate lowering —
      // disguises voice while staying intelligible once the algorithm
      // itself is clean (see header note on what was actually broken).
      { name: "pitchRatio", defaultValue: 0.82, minValue: 0.5, maxValue: 1.8 },
    ];
  }

  constructor() {
    super();
    this.bufferSize = Math.max(1, Math.floor(sampleRate * BUFFER_SECONDS));
    this.grainSamples = Math.max(1, Math.floor(sampleRate * GRAIN_SECONDS));
    this.buffer = new Float32Array(this.bufferSize);
    this.writeIndex = 0;

    // Phase-offset so the four windows overlap evenly from the very first
    // sample instead of all starting in lockstep (which would silence the
    // output until the first one completes a cycle).
    this.voices = [];
    for (let i = 0; i < NUM_VOICES; i++) {
      this.voices.push({ age: i / NUM_VOICES, readPos: 0 });
    }
  }

  interpolate(pos) {
    const buf = this.buffer;
    const n = this.bufferSize;
    const p = ((pos % n) + n) % n; // normalize negative/overflowing positions into [0, n)
    const i0 = Math.floor(p);
    const i1 = (i0 + 1) % n;
    const frac = p - i0;
    return buf[i0] * (1 - frac) + buf[i1] * frac;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0] && inputs[0][0];
    const output = outputs[0] && outputs[0][0];
    if (!input || !output) return true;

    const pitchParam = parameters.pitchRatio;
    const constantRatio = pitchParam.length === 1;
    const grain = this.grainSamples;

    for (let i = 0; i < input.length; i++) {
      const pitchRatio = constantRatio ? pitchParam[0] : pitchParam[i];

      this.buffer[this.writeIndex] = input[i];

      let sample = 0;
      let windowSum = 0;
      for (const voice of this.voices) {
        // Hann window over this voice's lifecycle: 0 at birth, 1 at the
        // midpoint, back to 0 when it's about to be reset.
        const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * voice.age);
        sample += this.interpolate(voice.readPos) * w;
        windowSum += w;

        voice.readPos += pitchRatio;
        voice.age += 1 / grain;
        if (voice.age >= 1) {
          voice.age -= 1;
          // Re-anchor to a bounded, recent delay behind the CURRENT write
          // pointer — this is what keeps the read position from ever
          // drifting far enough to wrap around the buffer (see header note).
          voice.readPos = this.writeIndex - grain;
        }
      }

      // Normalize by the actual window sum rather than a hardcoded constant
      // — self-correcting during the brief startup ramp before all 4
      // voices have completed at least one cycle.
      output[i] = windowSum > 0 ? sample / windowSum : 0;

      this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    }
    return true;
  }
}

registerProcessor("pitch-shift-processor", PitchShiftProcessor);
