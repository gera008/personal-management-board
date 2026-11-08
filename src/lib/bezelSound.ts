/**
 * The click of the module dial landing on a new module: one very short
 * metallic tick, like a dive-watch bezel. Synthesized, so there's no audio
 * file to load and it works offline.
 */
const LENGTH_S = 0.03;
const VOLUME = 0.32;
/** Playback speed of the click; above 1 raises its pitch (1.03 is about half a semitone). */
const PITCH = 1.03;
/** Inharmonic partials of small steel parts: [frequency Hz, amplitude, decay s]. */
const PARTIALS = [
  [1180, 0.3, 0.005],
  [2870, 0.55, 0.006],
  [4310, 0.5, 0.0045],
  [6180, 0.34, 0.003],
  [8950, 0.2, 0.002],
] as const;

/** One click: the pawl snapping in, then a quieter bounce 2.6 ms later. */
export function renderClick(sampleRate: number, random: () => number = Math.random): Float32Array {
  const out = new Float32Array(Math.round(LENGTH_S * sampleRate));
  const strike = (at: number, level: number) => {
    for (let i = Math.round(at * sampleRate); i < out.length; i++) {
      const t = i / sampleRate - at;
      let v = (random() * 2 - 1) * 0.7 * Math.exp(-t / 0.0012); // the contact itself
      for (const [f, a, d] of PARTIALS) v += a * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / d);
      out[i] += v * level;
    }
  };
  strike(0, 1);
  strike(0.0026, 0.42);
  const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  return out.map((v) => v / peak);
}

let ctx: AudioContext | null = null;
let output: GainNode | null = null;
let buffers: AudioBuffer[] = [];

/** Browsers only allow sound after a user gesture, so call this from one. */
export function unlockBezel() {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      output = ctx.createGain();
      output.gain.value = VOLUME;
      output.connect(ctx.destination);
      // A few takes, so repeated clicks aren't identical.
      const rate = ctx.sampleRate;
      buffers = Array.from({ length: 4 }, () => {
        const b = ctx!.createBuffer(1, Math.round(LENGTH_S * rate), rate);
        b.copyToChannel(renderClick(rate), 0);
        return b;
      });
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null; // no Web Audio: the dial just stays silent
  }
}

export function bezelClick() {
  if (!ctx || !output || ctx.state !== 'running') return;
  const src = ctx.createBufferSource();
  src.buffer = buffers[Math.floor(Math.random() * buffers.length)];
  src.playbackRate.value = PITCH + (Math.random() - 0.5) * 0.02;
  src.connect(output);
  src.start();
}
