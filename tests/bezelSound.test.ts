import { describe, expect, it } from 'vitest';
import { renderCaseClose, renderClick } from '../src/lib/bezelSound';

describe('bezel click', () => {
  const rate = 48000;
  // Seeded, so the noise in the click is the same on every run.
  let seed = 7;
  const click = renderClick(rate, () => (seed = (seed * 16807) % 2147483647) / 2147483647);
  const energy = (from: number, to: number) => click.slice(Math.round(from * rate), Math.round(to * rate)).reduce((s, v) => s + v * v, 0);

  it('is a short click at full scale', () => {
    expect(click.length).toBe(1440); // 30 ms
    expect(Math.max(...click.map(Math.abs))).toBeCloseTo(1, 5);
  });

  it('dies away quickly', () => {
    expect(energy(0.02, 0.03)).toBeLessThan(energy(0, 0.01) / 500);
  });

  it('is bright, like metal rather than wood', () => {
    // First difference weights high frequencies: a 500 Hz thud scores 0.002, a 2.4 kHz tone 0.1.
    let diff = 0;
    let sum = 0;
    for (let i = 1; i < 480; i++) {
      diff += (click[i] - click[i - 1]) ** 2;
      sum += click[i] ** 2;
    }
    expect(diff / sum).toBeGreaterThan(0.1);
  });
});

describe('case close (Overview)', () => {
  const rate = 48000;
  let seed = 11;
  const sound = renderCaseClose(rate, () => (seed = (seed * 16807) % 2147483647) / 2147483647);
  const energy = (from: number, to: number) => sound.slice(Math.round(from * rate), Math.round(to * rate)).reduce((s, v) => s + v * v, 0);

  it('stays under half a second and within full scale', () => {
    expect(sound.length / rate).toBeLessThan(0.5);
    expect(Math.max(...sound.map(Math.abs))).toBeLessThanOrEqual(1);
  });

  it('is a thud with a faint tail, not a chime', () => {
    expect(energy(0.1, 0.25)).toBeGreaterThan(0);
    expect(energy(0.1, 0.25)).toBeLessThan(energy(0, 0.05) / 50);
  });

  it('fades to silence at the end', () => {
    expect(Math.abs(sound[sound.length - 1])).toBeLessThan(1e-6);
  });
});
