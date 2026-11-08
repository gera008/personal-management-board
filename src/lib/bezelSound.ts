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

/** Length of the Overview sound. */
const CASE_LENGTH_S = 0.32;
/** Relative to the dial click: it should barely be noticed. */
const CASE_LEVEL = 0.7;

/** [frequency Hz, amplitude, decay s]. Nothing below ~400 Hz carries the thud: phone speakers can't play it. */
const CASE_THUD = [
  [210, 0.55, 0.03],
  [430, 1, 0.022],
  [680, 0.6, 0.016],
] as const;
/** The faint ring of the metal case after it shuts. */
const CASE_RING = [
  [1870, 0.07, 0.085],
  [2810, 0.05, 0.065],
  [4120, 0.025, 0.045],
] as const;

/** The dial's center (Overview): a low, damped thud and a faint metallic ring, like shutting a watch case. */
export function renderCaseClose(sampleRate: number, random: () => number = Math.random): Float32Array {
  const out = new Float32Array(Math.round(CASE_LENGTH_S * sampleRate));
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    let v = (random() * 2 - 1) * 0.18 * Math.exp(-t / 0.0016); // the contact, softer than the bezel's
    for (const [f, a, d] of [...CASE_THUD, ...CASE_RING]) v += a * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / d);
    out[i] = v;
  }
  const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  // Fade the last 20 ms so the tail can't end in an audible tick.
  const fade = Math.round(0.02 * sampleRate);
  return out.map((v, i) => (v / peak) * Math.min(1, (out.length - 1 - i) / fade));
}

let ctx: AudioContext | null = null;
let output: GainNode | null = null;
let buffers: AudioBuffer[] = [];
let caseBuffer: AudioBuffer | null = null;

/** Browsers only allow sound after a user gesture, so call this from one. */
export function unlockBezel() {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      output = ctx.createGain();
      output.gain.value = VOLUME;
      output.connect(ctx.destination);
      const rate = ctx.sampleRate;
      const toBuffer = (samples: Float32Array) => {
        const b = ctx!.createBuffer(1, samples.length, rate);
        b.copyToChannel(samples, 0);
        return b;
      };
      // A few takes, so repeated clicks aren't identical.
      buffers = Array.from({ length: 4 }, () => toBuffer(renderClick(rate)));
      caseBuffer = toBuffer(renderCaseClose(rate).map((v) => v * CASE_LEVEL));
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null; // no Web Audio: the dial just stays silent
  }
}

function play(buffer: AudioBuffer | null | undefined, rate = 1) {
  if (!ctx || !output || !buffer) return;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  src.connect(output);
  src.start();
}

export function bezelClick() {
  // Without a gesture yet (wheel only) the context is suspended: drop it rather than save it up.
  if (ctx?.state !== 'running') return;
  play(buffers[Math.floor(Math.random() * buffers.length)], PITCH + (Math.random() - 0.5) * 0.02);
}

/** Always follows a tap on the center, so the context is already unlocked (or about to be). */
export function caseClose() {
  play(caseBuffer);
}
