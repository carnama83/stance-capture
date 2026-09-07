// src/components/ugq/avatarRenderer.ts
// Anonymous-video feature — canvas rendering of the user's persistent
// avatar, driven ENTIRELY by audio analysis of the (already voice-disguised)
// mic signal, never by tracking the live camera feed. See the plan's "Key
// technical decision" note: this keeps the public rendering pipeline
// simple, robust (nothing can fail from bad lighting or the face leaving
// frame, because it never looks at the camera at all), and safer for
// anonymity (no risk of real facial mannerisms/tics leaking through).
//
// Mouth shape switches between a small, fixed set of visemes based on the
// mic signal's RMS volume — a coarse but effective and well-precedented
// approach (the same category of technique VTubing/corporate-avatar tools
// use for lightweight lip-sync). Idle motion (blink timer, a slow sway) is
// driven by simple timers, not audio or video, just to keep the avatar
// feeling alive between words.

import type { AnonymousAvatarConfig } from "./avatarConfig";

type MouthShape = "closed" | "small" | "open";

const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = 360;

export class AvatarRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly config: AnonymousAvatarConfig;
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;
  private rafId: number | null = null;
  private blinkTimer: ReturnType<typeof setTimeout> | null = null;
  private blinking = false;
  private swayPhase = 0;
  private running = false;

  constructor(config: AnonymousAvatarConfig) {
    this.config = config;
    this.canvas = document.createElement("canvas");
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
  }

  get canvasElement(): HTMLCanvasElement {
    return this.canvas;
  }

  // Feeds the same (post pitch-shift) audio node the recorder is already
  // using, so what's heard and what's seen stay in sync. Safe to call
  // before or after start().
  attachAudioSource(audioContext: AudioContext, sourceNode: AudioNode) {
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    sourceNode.connect(analyser);
    this.analyser = analyser;
    this.dataArray = new Uint8Array(analyser.frequencyBinCount);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.scheduleBlink();
    const loop = () => {
      if (!this.running) return;
      this.drawFrame();
      this.rafId = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.blinkTimer !== null) clearTimeout(this.blinkTimer);
  }

  // captureStream is not in the DOM lib's HTMLCanvasElement typings in all
  // TS configs — cast defensively rather than widen the global lib target.
  captureStream(fps = 24): MediaStream {
    const canvasWithCapture = this.canvas as HTMLCanvasElement & {
      captureStream(frameRate?: number): MediaStream;
    };
    return canvasWithCapture.captureStream(fps);
  }

  private scheduleBlink() {
    const delay = 2000 + Math.random() * 3000;
    this.blinkTimer = setTimeout(() => {
      this.blinking = true;
      setTimeout(() => { this.blinking = false; }, 140);
      if (this.running) this.scheduleBlink();
    }, delay);
  }

  private currentVolume(): number {
    if (!this.analyser || !this.dataArray) return 0;
    this.analyser.getByteTimeDomainData(this.dataArray);
    let sumSquares = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      const norm = (this.dataArray[i] - 128) / 128;
      sumSquares += norm * norm;
    }
    return Math.sqrt(sumSquares / this.dataArray.length); // RMS, roughly 0..1
  }

  private mouthShapeForVolume(volume: number): MouthShape {
    if (volume > 0.22) return "open";
    if (volume > 0.06) return "small";
    return "closed";
  }

  private drawFrame() {
    const { ctx, canvas, config } = this;
    const w = canvas.width;
    const h = canvas.height;
    this.swayPhase += 0.02;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#eef0ee";
    ctx.fillRect(0, 0, w, h);

    const mouthShape = this.mouthShapeForVolume(this.currentVolume());
    const cx = w / 2 + Math.sin(this.swayPhase) * 4;
    const cy = h / 2 - 10;

    // Shoulders/top.
    ctx.fillStyle = config.topColor;
    ctx.beginPath();
    ctx.moveTo(cx - 95, h);
    ctx.quadraticCurveTo(cx - 95, cy + 75, cx, cy + 62);
    ctx.quadraticCurveTo(cx + 95, cy + 75, cx + 95, h);
    ctx.closePath();
    ctx.fill();

    // Neck.
    ctx.fillStyle = config.skinTone;
    ctx.fillRect(cx - 18, cy + 40, 36, 30);

    // Head.
    ctx.beginPath();
    ctx.ellipse(cx, cy, 58, 68, 0, 0, Math.PI * 2);
    ctx.fillStyle = config.skinTone;
    ctx.fill();

    this.drawHair(cx, cy);

    // Eyes (or a blink line).
    const eyeY = cy - 8;
    if (!this.blinking) {
      ctx.fillStyle = "#2c2c2a";
      ctx.beginPath(); ctx.ellipse(cx - 20, eyeY, 5, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 20, eyeY, 5, 6, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.strokeStyle = "#2c2c2a";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - 26, eyeY); ctx.lineTo(cx - 14, eyeY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + 14, eyeY); ctx.lineTo(cx + 26, eyeY); ctx.stroke();
    }

    // Mouth — the one thing driven by audio.
    const mouthY = cy + 30;
    if (mouthShape === "closed") {
      ctx.strokeStyle = "#7a4f30";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - 14, mouthY); ctx.lineTo(cx + 14, mouthY); ctx.stroke();
    } else {
      ctx.fillStyle = "#a5724a";
      const radius = mouthShape === "small" ? { x: 10, y: 6 } : { x: 13, y: 12 };
      ctx.beginPath();
      ctx.ellipse(cx, mouthY, radius.x, radius.y, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawHair(cx: number, cy: number) {
    const { ctx, config } = this;
    ctx.fillStyle = config.hairColor;
    switch (config.hairStyle) {
      case "bald":
        return;
      case "short":
        ctx.beginPath();
        ctx.ellipse(cx, cy - 30, 60, 40, 0, Math.PI, 2 * Math.PI);
        ctx.fill();
        return;
      case "long":
        ctx.beginPath();
        ctx.ellipse(cx, cy - 25, 62, 45, 0, Math.PI, 2 * Math.PI);
        ctx.fill();
        ctx.fillRect(cx - 62, cy - 20, 20, 90);
        ctx.fillRect(cx + 42, cy - 20, 20, 90);
        return;
      case "curly":
        for (let i = -3; i <= 3; i++) {
          ctx.beginPath();
          ctx.arc(cx + i * 20, cy - 45 + Math.abs(i) * 4, 20, 0, Math.PI * 2);
          ctx.fill();
        }
        return;
    }
  }
}
