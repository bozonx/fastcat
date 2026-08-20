import { describe, it, expect } from 'vitest';
import type { IAudioEngine } from '~/utils/video-editor/AudioEngine';

/**
 * Shared behavioural contract for every {@link IAudioEngine} implementation.
 *
 * The Web (Web Audio graph) and Tauri (native Rust + IPC) engines are
 * deliberately built on different paradigms, so their *internals* diverge. What
 * must NOT diverge is the externally-observable behaviour both expose through
 * `IAudioEngine` — the transport clock (delegated to the shared AudioScheduler),
 * level metering falling to silence when idle, capability-gated peaks, and
 * tolerant volume setters.
 *
 * Each engine's own spec file owns its module mocks / global setup, then calls
 * this helper from inside its `describe` block so the surrounding `beforeEach`
 * still applies. New cross-engine guarantees belong here, not duplicated in two
 * places where they can drift apart.
 */
export interface AudioEngineContractOptions {
  /** Build a fully-initialised engine ready for playback control. */
  createEngine: () => Promise<IAudioEngine> | IAudioEngine;
}

// AudioScheduler runs on wall-clock time; assertions about the transport clock
// allow a little slack for the elapsed test wall-time between calls.
const CLOCK_TOLERANCE_TICKS = 100_000;

export function runAudioEngineContract(name: string, options: AudioEngineContractOptions) {
  const make = () => Promise.resolve(options.createEngine());

  describe(`${name} — IAudioEngine contract`, () => {
    it('declares capabilities as three booleans', async () => {
      const engine = await make();
      const caps = engine.capabilities;
      expect(typeof caps.scrubPreview).toBe('boolean');
      expect(typeof caps.peaksExtraction).toBe('boolean');
      expect(typeof caps.levelMetering).toBe('boolean');
      engine.destroy();
    });

    it('starts at time zero', async () => {
      const engine = await make();
      expect(engine.getCurrentTimeTicks()).toBe(0);
      engine.destroy();
    });

    it('play anchors the transport clock near the requested start', async () => {
      const engine = await make();
      await engine.play(5_000_000);
      const t = engine.getCurrentTimeTicks();
      expect(t).toBeGreaterThanOrEqual(5_000_000 - CLOCK_TOLERANCE_TICKS);
      expect(t).toBeLessThanOrEqual(5_000_000 + CLOCK_TOLERANCE_TICKS);
      engine.destroy();
    });

    it('stop freezes the transport clock', async () => {
      const engine = await make();
      await engine.play(10_000_000);
      engine.stop();
      const t = engine.getCurrentTimeTicks();
      expect(t).toBeGreaterThanOrEqual(10_000_000 - CLOCK_TOLERANCE_TICKS);
      expect(t).toBeLessThanOrEqual(10_000_000 + CLOCK_TOLERANCE_TICKS);
      engine.destroy();
    });

    it('ignores seek while stopped', async () => {
      const engine = await make();
      engine.seek(30_000_000);
      expect(engine.getCurrentTimeTicks()).toBe(0);
      engine.destroy();
    });

    it('reanchors the clock on seek while playing', async () => {
      const engine = await make();
      await engine.play(0);
      engine.seek(20_000_000);
      const t = engine.getCurrentTimeTicks();
      expect(t).toBeGreaterThanOrEqual(20_000_000 - CLOCK_TOLERANCE_TICKS);
      expect(t).toBeLessThanOrEqual(20_000_000 + CLOCK_TOLERANCE_TICKS);
      engine.destroy();
    });

    it('reports silence from getLevels when not playing', async () => {
      const engine = await make();
      expect(engine.getLevels()).toEqual({ rmsDb: -60, peakDb: -60 });
      engine.destroy();
    });

    it('tolerates out-of-range speed and volume without throwing', async () => {
      const engine = await make();
      await engine.play(0);
      expect(() => engine.setGlobalSpeed(2)).not.toThrow();
      expect(() => engine.setMasterVolume(-5)).not.toThrow();
      expect(() => engine.setMasterVolume(999)).not.toThrow();
      expect(() => engine.setMonitorVolume(-5)).not.toThrow();
      expect(() => engine.setMonitorVolume(999)).not.toThrow();
      engine.destroy();
    });

    it('resolves resumeContext()', async () => {
      const engine = await make();
      await expect(Promise.resolve(engine.resumeContext())).resolves.toBeUndefined();
      engine.destroy();
    });

    it('honours the declared peaksExtraction capability', async () => {
      const engine = await make();
      const result = await engine.extractPeaks(null as unknown as FileSystemFileHandle, 'contract');
      if (engine.capabilities.peaksExtraction) {
        expect(result).not.toBeNull();
      } else {
        expect(result).toBeNull();
      }
      engine.destroy();
    });

    it('is safe to destroy twice', async () => {
      const engine = await make();
      engine.destroy();
      expect(() => engine.destroy()).not.toThrow();
    });
  });
}
