// public/audio-worklets/pitch-shift-processor.js
// Anonymous-video feature — voice disguise.
//
// Loaded via audioContext.audioWorklet.addModule("/audio-worklets/pitch-shift-processor.js")
// from src/components/ugq/pitchShift.ts. Must be a plain static file (not
// bundled) because AudioWorklet modules run on a separate audio-rendering
// thread with its own module loader, isolated from the page's own JS
// bundle/imports.
//
// Simple grain-based pitch shifter: writes the input into a circular
// buffer, then reads it back with two read heads offset by half a grain and
// moving at `pitchRatio` speed relative to the write head, crossfaded with
// a triangular window to avoid clicks at grain boundaries. This is a
// well-known, lightweight real-time pitch-shifting technique — not
// broadcast-quality (some grainy/robotic artifact is expected, especially
// at larger ratios), which is fine and even desirable here: the goal is
// voice disguise, not fidelity.

const GRAIN_SECONDS = 0.05; // 50ms grain
const BUFFER_SECONDS = 0.2; // circular buffer, generous vs. grain size

class PitchShiftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // < 1 lowers pitch, > 1 raises it. Default: a fixed, moderate
      // lowering — disguises voice without making it hard to understand.
      { name: "pitchRatio", defaultValue: 0.8, minValue: 0.5, maxValue: 1.8 },
    ];
  }

  constructor() {
    super();
    this.bufferSize = Math.max(1, Math.floor(sampleRate * BUFFER_SECONDS));
    this.grainSize = Math.max(1, Math.floor(sampleRate * GRAIN_SECONDS));
    this.buffer = new Float32Array(this.bufferSize);
    this.writeIndex = 0;
    this.readPos = 0;
  }

  interpolate(pos) {
    const buf = this.buffer;
    const n = this.bufferSize;
    const i0 = Math.floor(pos) % n;
    const i1 = (i0 + 1) % n;
    const frac = pos - Math.floor(pos);
    return buf[i0] * (1 - frac) + buf[i1] * frac;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0] && inputs[0][0];
    const output = outputs[0] && outputs[0][0];
    if (!input || !output) return true;

    const pitchParam = parameters.pitchRatio;
    const constantRatio = pitchParam.length === 1;
    const n = this.bufferSize;
    const grain = this.grainSize;

    for (let i = 0; i < input.length; i++) {
      const pitchRatio = constantRatio ? pitchParam[0] : pitchParam[i];

      this.buffer[this.writeIndex] = input[i];
      this.writeIndex = (this.writeIndex + 1) % n;

      const readA = this.readPos;
      const readB = (this.readPos + grain / 2) % n;
      const posInGrain = ((readA % grain) + grain) % grain / grain;
      const winA = 1 - Math.abs(2 * posInGrain - 1);
      const winB = 1 - winA;

      output[i] = this.interpolate(readA) * winA + this.interpolate(readB) * winB;

      this.readPos += pitchRatio;
      if (this.readPos >= n) this.readPos -= n;
      if (this.readPos < 0) this.readPos += n;
    }
    return true;
  }
}

registerProcessor("pitch-shift-processor", PitchShiftProcessor);
