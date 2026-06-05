import { describe, expect, it } from 'vitest';

import {
  computeWaveformPeakBins,
  computeWaveformRenderBudget,
  computeWaveformWindowMetrics,
  resolveWaveformSourceUs,
  serializeWaveformPeaks,
  deserializeWaveformPeaks,
  serializeWaveformCacheEntry,
  readWaveformCacheEntry,
  isWaveformCacheEntry,
} from '~/utils/audio/waveform';
import { timeUsToPx } from '~/utils/timeline/geometry';

describe('audio waveform utilities', () => {
  it('aligns a trimmed forward clip to the matching source window', () => {
    const zoom = 50;
    const metrics = computeWaveformWindowMetrics({
      sourceStartUs: 2_000_000,
      sourceDurationUs: 10_000_000,
      timelineDurationUs: 3_000_000,
      speed: 1,
      zoom,
    });

    expect(metrics.reversed).toBe(false);
    expect(metrics.leftPx).toBe(-Math.round(timeUsToPx(2_000_000, zoom)));
    expect(metrics.totalWidthPx).toBe(Math.round(timeUsToPx(10_000_000, zoom)));
  });

  it('aligns a reversed clip so the visible window runs from source end to start', () => {
    const zoom = 50;
    const metrics = computeWaveformWindowMetrics({
      sourceStartUs: 2_000_000,
      sourceDurationUs: 10_000_000,
      timelineDurationUs: 3_000_000,
      speed: -1,
      zoom,
    });

    const sourceAtClipLeftPx = metrics.leftPx + metrics.totalWidthPx;
    const sourceAtClipRightPx = sourceAtClipLeftPx - metrics.clipWidthPx;

    expect(metrics.reversed).toBe(true);
    expect(sourceAtClipLeftPx).toBe(Math.round(timeUsToPx(5_000_000, zoom)));
    expect(sourceAtClipRightPx).toBe(Math.round(timeUsToPx(2_000_000, zoom)));
  });

  it('maps nested timeline positive-speed local time with clip speed', () => {
    const sourceUs = resolveWaveformSourceUs({
      absoluteUs: 11_000_000,
      clipStartUs: 10_000_000,
      clipDurationUs: 2_000_000,
      sourceStartUs: 3_000_000,
      sourceRangeDurationUs: 4_000_000,
      speed: 2,
    });

    expect(sourceUs).toBe(5_000_000);
  });

  it('maps nested timeline negative-speed local time from source range end', () => {
    const sourceUs = resolveWaveformSourceUs({
      absoluteUs: 11_000_000,
      clipStartUs: 10_000_000,
      clipDurationUs: 2_000_000,
      sourceStartUs: 3_000_000,
      sourceRangeDurationUs: 4_000_000,
      speed: -2,
    });

    expect(sourceUs).toBe(5_000_000);
  });

  it('reversed speed at clip start maps to source range end', () => {
    const sourceUs = resolveWaveformSourceUs({
      absoluteUs: 10_000_000,
      clipStartUs: 10_000_000,
      clipDurationUs: 2_000_000,
      sourceStartUs: 3_000_000,
      sourceRangeDurationUs: 4_000_000,
      speed: -2,
    });

    expect(sourceUs).toBe(7_000_000);
  });

  it('reversed speed at clip end maps to source range start', () => {
    const sourceUs = resolveWaveformSourceUs({
      absoluteUs: 12_000_000,
      clipStartUs: 10_000_000,
      clipDurationUs: 2_000_000,
      sourceStartUs: 3_000_000,
      sourceRangeDurationUs: 4_000_000,
      speed: -2,
    });

    expect(sourceUs).toBe(3_000_000);
  });

  it('reversed speed yields positive totalWidthPx', () => {
    const metrics = computeWaveformWindowMetrics({
      sourceStartUs: 0,
      sourceDurationUs: 10_000_000,
      timelineDurationUs: 5_000_000,
      speed: -2,
      zoom: 50,
    });

    expect(metrics.totalWidthPx).toBeGreaterThan(0);
  });

  it('downsamples waveform peaks to visible bins using max amplitude', () => {
    const bins = computeWaveformPeakBins({
      channels: [
        new Float32Array([0.1, -0.7, 0.2, 0.3, 0.8, 0.1]),
        new Float32Array([0.2, 0.4, -0.9, 0.1, 0.2, -0.6]),
      ],
      startIndex: 0,
      endIndex: 6,
      outputBins: 3,
    });

    expect(bins).toHaveLength(3);
    expect(bins[0]).toBeCloseTo(0.7);
    expect(bins[1]).toBeCloseTo(0.9);
    expect(bins[2]).toBeCloseTo(0.8);
  });

  it('keeps source peak count when there are fewer peaks than output bins', () => {
    const bins = computeWaveformPeakBins({
      channels: [new Float32Array([0.2, 0.4])],
      startIndex: 0,
      endIndex: 2,
      outputBins: 100,
      gain: 2,
    });

    expect(bins).toHaveLength(2);
    expect(bins[0]).toBeCloseTo(0.4);
    expect(bins[1]).toBeCloseTo(0.8);
  });

  it('uses a lower render budget for low timeline zoom', () => {
    const budget = computeWaveformRenderBudget({
      cssWidth: 1000,
      devicePixelRatio: 2,
      zoom: 38,
      maxPointsPerChunk: 2048,
    });

    expect(budget.effectiveDevicePixelRatio).toBe(1);
    expect(budget.outputBins).toBe(500);
  });

  it('keeps full css-width bins at detailed timeline zoom while capping device pixel ratio', () => {
    const budget = computeWaveformRenderBudget({
      cssWidth: 1000,
      devicePixelRatio: 3,
      zoom: 60,
      maxPointsPerChunk: 2048,
    });

    expect(budget.effectiveDevicePixelRatio).toBe(2);
    expect(budget.outputBins).toBe(1000);
  });

  it('serializes and deserializes peaks to/from binary ArrayBuffer correctly', () => {
    const originalPeaks = [
      new Float32Array([0.1, 0.2, 0.3, 0.4]),
      new Float32Array([0.5, 0.6, 0.7, 0.8]),
    ];

    const serialized = serializeWaveformPeaks(originalPeaks);
    expect(serialized).toBeInstanceOf(ArrayBuffer);
    expect(serialized.byteLength).toBe(8 + 2 * 4 * 4);

    const deserialized = deserializeWaveformPeaks(serialized);
    expect(deserialized).not.toBeNull();
    expect(deserialized).toHaveLength(2);
    expect(deserialized![0]).toEqual(new Float32Array([0.1, 0.2, 0.3, 0.4]));
    expect(deserialized![1]).toEqual(new Float32Array([0.5, 0.6, 0.7, 0.8]));
  });

  it('returns null for a corrupt waveform buffer instead of throwing', () => {
    // 9 bytes: a valid header claiming 0 channels/0 samples but a 1-byte,
    // non-4-aligned tail. Must be handled gracefully, not throw.
    expect(deserializeWaveformPeaks(new ArrayBuffer(3))).toBeNull();
    const odd = new ArrayBuffer(9);
    new DataView(odd).setUint32(0, 1, true); // channelCount = 1
    new DataView(odd).setUint32(4, 1, true); // samplesCount = 1
    // expected payload is 4 bytes but only 1 present → guarded by length check
    expect(deserializeWaveformPeaks(odd)).toBeNull();
  });

  it('round-trips a fingerprinted cache envelope', () => {
    const peaks = [new Float32Array([0.5, -0.25]), new Float32Array([1, -1])];
    const buffer = serializeWaveformCacheEntry(peaks, { size: 42, lastModified: 1234 });

    expect(isWaveformCacheEntry(buffer)).toBe(true);
    // A bare peak buffer must NOT be mistaken for an envelope.
    expect(isWaveformCacheEntry(serializeWaveformPeaks(peaks))).toBe(false);

    const entry = readWaveformCacheEntry(buffer);
    expect(entry?.fingerprint).toEqual({ size: 42, lastModified: 1234 });
    expect(entry?.peaks[0]).toEqual(new Float32Array([0.5, -0.25]));
    expect(entry?.peaks[1]).toEqual(new Float32Array([1, -1]));
  });

  it('rejects non-envelope buffers from the envelope reader', () => {
    expect(readWaveformCacheEntry(serializeWaveformPeaks([new Float32Array([1])]))).toBeNull();
    expect(readWaveformCacheEntry(new ArrayBuffer(4))).toBeNull();
  });
});
