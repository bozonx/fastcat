/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { buildNativeExportOptions } from '~/composables/timeline/export/core/useExportProcess';
import type { ExportOptions } from '~/types/worker-payload';

function baseWebOptions(): ExportOptions & { audioSampleRate: number } {
  return {
    format: 'mp4',
    videoCodec: 'avc1.640032',
    bitrate: 5_000_000,
    audioBitrate: 128_000,
    audio: true,
    audioCodec: 'aac',
    audioSampleRate: 48_000,
    audioChannels: 'stereo',
    width: 1920,
    height: 1080,
    fps: 30,
  };
}

describe('buildNativeExportOptions', () => {
  it('maps basic video+audio options correctly', () => {
    const result = buildNativeExportOptions({
      options: baseWebOptions(),
      rangeStartUs: 0,
      rangeEndUs: 10_000_000,
    });

    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.fps).toBe(30);
    expect(result.startSec).toBe(0);
    expect(result.endSec).toBe(10);
    expect(result.videoCodec).toBe('avc1.640032');
    expect(result.videoBitrateBps).toBe(5_000_000);
    expect(result.format).toBe('mp4');
    expect(result.audioEnabled).toBe(true);
    expect(result.audioCodec).toBe('aac');
    expect(result.audioBitrateBps).toBe(128_000);
    expect(result.audioChannels).toBe(2);
    expect(result.audioSampleRate).toBe(48_000);
    expect(result.videoEnabled).toBe(true);
  });

  it('converts range from microseconds to seconds', () => {
    const result = buildNativeExportOptions({
      options: baseWebOptions(),
      rangeStartUs: 2_500_000,
      rangeEndUs: 7_500_000,
    });

    expect(result.startSec).toBe(2.5);
    expect(result.endSec).toBe(7.5);
  });

  it('maps mono audio channels to 1', () => {
    const result = buildNativeExportOptions({
      options: { ...baseWebOptions(), audioChannels: 'mono' },
      rangeStartUs: 0,
      rangeEndUs: 1_000_000,
    });

    expect(result.audioChannels).toBe(1);
  });

  it('maps stereo audio channels to 2', () => {
    const result = buildNativeExportOptions({
      options: { ...baseWebOptions(), audioChannels: 'stereo' },
      rangeStartUs: 0,
      rangeEndUs: 1_000_000,
    });

    expect(result.audioChannels).toBe(2);
  });

  it('defaults audioChannels to 2 when undefined', () => {
    const opts = baseWebOptions();
    delete opts.audioChannels;
    const result = buildNativeExportOptions({
      options: opts,
      rangeStartUs: 0,
      rangeEndUs: 1_000_000,
    });

    expect(result.audioChannels).toBe(2);
  });

  it('sets videoEnabled=false for audio-only formats', () => {
    for (const format of ['aac', 'opus', 'ogg', 'flac', 'wav', 'pcm', 'mp3'] as const) {
      const result = buildNativeExportOptions({
        options: { ...baseWebOptions(), format },
        rangeStartUs: 0,
        rangeEndUs: 1_000_000,
      });
      expect(result.videoEnabled).toBe(false);
    }
  });

  it('sets videoEnabled=true for video formats', () => {
    for (const format of ['mp4', 'webm', 'mkv'] as const) {
      const result = buildNativeExportOptions({
        options: { ...baseWebOptions(), format },
        rangeStartUs: 0,
        rangeEndUs: 1_000_000,
      });
      expect(result.videoEnabled).toBe(true);
    }
  });

  it('defaults bitrateMode to variable when undefined', () => {
    const opts = baseWebOptions();
    delete opts.bitrateMode;
    const result = buildNativeExportOptions({
      options: opts,
      rangeStartUs: 0,
      rangeEndUs: 1_000_000,
    });

    expect(result.bitrateMode).toBe('variable');
  });

  it('passes through constant bitrateMode', () => {
    const result = buildNativeExportOptions({
      options: { ...baseWebOptions(), bitrateMode: 'constant' },
      rangeStartUs: 0,
      rangeEndUs: 1_000_000,
    });

    expect(result.bitrateMode).toBe('constant');
  });

  it('passes through keyframeIntervalSec', () => {
    const result = buildNativeExportOptions({
      options: { ...baseWebOptions(), keyframeIntervalSec: 2.0 },
      rangeStartUs: 0,
      rangeEndUs: 1_000_000,
    });

    expect(result.keyframeIntervalSec).toBe(2.0);
  });

  it('maps metadata fields to native metadata fields', () => {
    const result = buildNativeExportOptions({
      options: {
        ...baseWebOptions(),
        metadata: {
          title: 'My Title',
          description: 'My Description',
          author: 'My Author',
          tags: 'tag1, tag2',
        },
      },
      rangeStartUs: 0,
      rangeEndUs: 1_000_000,
    });

    expect(result.metadataTitle).toBe('My Title');
    expect(result.metadataDescription).toBe('My Description');
    expect(result.metadataAuthor).toBe('My Author');
    expect(result.metadataTags).toBe('tag1, tag2');
  });

  it('maps missing metadata to null', () => {
    const result = buildNativeExportOptions({
      options: baseWebOptions(),
      rangeStartUs: 0,
      rangeEndUs: 1_000_000,
    });

    expect(result.metadataTitle).toBeNull();
    expect(result.metadataDescription).toBeNull();
    expect(result.metadataAuthor).toBeNull();
    expect(result.metadataTags).toBeNull();
  });

  it('maps empty metadata strings to null', () => {
    const result = buildNativeExportOptions({
      options: {
        ...baseWebOptions(),
        metadata: { title: '', description: '', author: '', tags: '' },
      },
      rangeStartUs: 0,
      rangeEndUs: 1_000_000,
    });

    expect(result.metadataTitle).toBeNull();
    expect(result.metadataDescription).toBeNull();
    expect(result.metadataAuthor).toBeNull();
    expect(result.metadataTags).toBeNull();
  });

  it('passes through exportAlpha', () => {
    const result = buildNativeExportOptions({
      options: { ...baseWebOptions(), exportAlpha: true },
      rangeStartUs: 0,
      rangeEndUs: 1_000_000,
    });

    expect(result.exportAlpha).toBe(true);
  });

  it('passes through fastStart', () => {
    const result = buildNativeExportOptions({
      options: { ...baseWebOptions(), fastStart: false },
      rangeStartUs: 0,
      rangeEndUs: 1_000_000,
    });

    expect(result.fastStart).toBe(false);
  });

  it('maps null audioCodec to null', () => {
    const opts = baseWebOptions();
    delete opts.audioCodec;
    const result = buildNativeExportOptions({
      options: opts,
      rangeStartUs: 0,
      rangeEndUs: 1_000_000,
    });

    expect(result.audioCodec).toBeNull();
  });

  it('handles fractional fps (29.97)', () => {
    const result = buildNativeExportOptions({
      options: { ...baseWebOptions(), fps: 29.97 },
      rangeStartUs: 0,
      rangeEndUs: 1_000_000,
    });

    expect(result.fps).toBe(29.97);
  });

  it('preserves all fields for VP9 WebM alpha export', () => {
    const result = buildNativeExportOptions({
      options: {
        ...baseWebOptions(),
        format: 'webm',
        videoCodec: 'vp09.00.10.08',
        exportAlpha: true,
        audioCodec: 'opus',
      },
      rangeStartUs: 0,
      rangeEndUs: 5_000_000,
    });

    expect(result.format).toBe('webm');
    expect(result.videoCodec).toBe('vp09.00.10.08');
    expect(result.exportAlpha).toBe(true);
    expect(result.audioCodec).toBe('opus');
    expect(result.videoEnabled).toBe(true);
  });
});
