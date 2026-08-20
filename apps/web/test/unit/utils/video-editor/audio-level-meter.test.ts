/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';
import { AudioLevelMeter } from '~/utils/video-editor/audio-level-meter';

function createMockAnalyser(fftSize = 2048): AnalyserNode {
  return {
    fftSize,
    connect: vi.fn(),
    disconnect: vi.fn(),
    getFloatTimeDomainData: vi.fn((arr: Float32Array) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = 0.5;
      }
    }),
  } as unknown as AnalyserNode;
}

describe('AudioLevelMeter', () => {
  it('returns silence when no analyser is registered', () => {
    const meter = new AudioLevelMeter();
    const levels = meter.getLevels(undefined, true);
    expect(levels).toEqual({ rmsDb: -60, peakDb: -60 });
  });

  it('returns silence when not active', () => {
    const meter = new AudioLevelMeter();
    const levels = meter.getLevels(undefined, false);
    expect(levels).toEqual({ rmsDb: -60, peakDb: -60 });
  });

  it('returns computed levels when active', () => {
    const meter = new AudioLevelMeter();
    const analyser = createMockAnalyser();
    meter.analyserNodes.set('master', analyser);

    const levels = meter.getLevels(undefined, true);
    // All samples are 0.5, so RMS ~ 0.5, peak = 0.5
    expect(levels.rmsDb).toBeGreaterThan(-10);
    expect(levels.peakDb).toBeGreaterThan(-10);
  });

  it('reuses the analyser buffer across getLevels calls', () => {
    const meter = new AudioLevelMeter();
    const getFloatFn = vi.fn((arr: Float32Array) => {
      for (let i = 0; i < arr.length; i++) arr[i] = 0.5;
    });
    const analyser = {
      fftSize: 2048,
      connect: vi.fn(),
      disconnect: vi.fn(),
      getFloatTimeDomainData: getFloatFn,
    } as unknown as AnalyserNode;
    meter.analyserNodes.set('master', analyser);

    meter.getLevels(undefined, true);
    meter.getLevels(undefined, true);

    // Metering runs on the main thread during playback, so the scratch buffer
    // must not create periodic garbage collection pressure.
    expect(getFloatFn).toHaveBeenCalledTimes(2);
    const call1Arg = getFloatFn.mock.calls[0][0] as Float32Array;
    const call2Arg = getFloatFn.mock.calls[1][0] as Float32Array;
    expect(call1Arg).toBe(call2Arg);
  });

  it('returns track levels when trackId is specified', () => {
    const meter = new AudioLevelMeter();
    const trackAnalyser = createMockAnalyser();
    meter.analyserNodes.set('track-1', trackAnalyser);

    const levels = meter.getLevels('track-1', true);
    expect(levels.rmsDb).toBeGreaterThan(-10);
  });

  it('clears all analysers', () => {
    const meter = new AudioLevelMeter();
    const masterAnalyser = createMockAnalyser();
    const trackAnalyser = createMockAnalyser();
    meter.analyserNodes.set('master', masterAnalyser);
    meter.analyserNodes.set('track-1', trackAnalyser);

    meter.clear();

    expect(meter.analyserNodes.size).toBe(0);
  });
});
