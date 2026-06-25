/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { useExportConfig } from '~/composables/timeline/export/core/useExportConfig';

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => ({
    timelineFormat: null,
  }),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => ({
    currentFileName: null,
    projectSettings: {
      project: {
        width: 1920,
        height: 1080,
        fps: 30,
        sampleRate: 48000,
      },
    },
  }),
}));

vi.mock('~/timeline/format', () => ({
  createTimelineFormatFromProjectDefaults: () => ({
    width: 1920,
    height: 1080,
    fps: 30,
    resolutionFormat: '1080p',
    orientation: 'landscape',
    aspectRatio: '16:9',
    isCustomResolution: false,
    sampleRate: 48000,
  }),
}));

describe('useExportConfig', () => {
  it('initializes with default values', () => {
    const config = useExportConfig();
    expect(config.exportType.value).toBe('video');
    expect(config.outputFormat.value).toBe('mp4');
    expect(config.videoCodec.value).toBe('avc1.640032');
    expect(config.bitrateMbps.value).toBe(5);
    expect(config.excludeAudio.value).toBe(false);
    expect(config.audioCodec.value).toBe('aac');
    expect(config.audioBitrateKbps.value).toBe(128);
    expect(config.audioChannels.value).toBe(2);
    expect(config.audioSampleRate.value).toBe(48000);
    expect(config.exportWidth.value).toBe(1920);
    expect(config.exportHeight.value).toBe(1080);
    expect(config.exportFps.value).toBe(30);
    expect(config.matchTimeline.value).toBe(true);
  });

  it('ext returns mp4 for video export by default', () => {
    const config = useExportConfig();
    expect(config.ext.value).toBe('mp4');
  });

  it('ext returns webm for webm format', () => {
    const config = useExportConfig();
    config.outputFormat.value = 'webm';
    expect(config.ext.value).toBe('webm');
  });

  it('ext returns mkv for mkv format', () => {
    const config = useExportConfig();
    config.outputFormat.value = 'mkv';
    expect(config.ext.value).toBe('mkv');
  });

  it('ext returns aac for audio export with aac codec', () => {
    const config = useExportConfig();
    config.exportType.value = 'audio';
    config.audioCodec.value = 'aac';
    expect(config.ext.value).toBe('aac');
  });

  it('ext returns opus for audio export with opus codec', () => {
    const config = useExportConfig();
    config.exportType.value = 'audio';
    config.audioCodec.value = 'opus';
    expect(config.ext.value).toBe('opus');
  });

  it('ext returns flac for audio export with flac codec', () => {
    const config = useExportConfig();
    config.exportType.value = 'audio';
    config.audioCodec.value = 'flac';
    expect(config.ext.value).toBe('flac');
  });

  it('ext returns wav for audio export with pcm codec', () => {
    const config = useExportConfig();
    config.exportType.value = 'audio';
    config.audioCodec.value = 'pcm';
    expect(config.ext.value).toBe('wav');
  });

  it('ext returns mp3 for audio export with mp3 codec', () => {
    const config = useExportConfig();
    config.exportType.value = 'audio';
    config.audioCodec.value = 'mp3';
    expect(config.ext.value).toBe('mp3');
  });

  it('bitrateBps converts Mbps to bps', () => {
    const config = useExportConfig();
    config.bitrateMbps.value = 10;
    expect(config.bitrateBps.value).toBe(10_000_000);
  });

  it('bitrateBps clamps to min 0.2 Mbps', () => {
    const config = useExportConfig();
    config.bitrateMbps.value = 0.01;
    expect(config.bitrateBps.value).toBe(200_000);
  });

  it('bitrateBps clamps to max 200 Mbps', () => {
    const config = useExportConfig();
    config.bitrateMbps.value = 500;
    expect(config.bitrateBps.value).toBe(200_000_000);
  });

  it('bitrateBps returns default for non-finite values', () => {
    const config = useExportConfig();
    config.bitrateMbps.value = NaN;
    expect(config.bitrateBps.value).toBe(5_000_000);
  });

  it('audioBitrateBps converts Kbps to bps', () => {
    const config = useExportConfig();
    config.audioBitrateKbps.value = 256;
    expect(config.audioBitrateBps.value).toBe(256_000);
  });

  it('audioBitrateBps clamps to min 8 Kbps', () => {
    const config = useExportConfig();
    config.audioBitrateKbps.value = 1;
    expect(config.audioBitrateBps.value).toBe(8_000);
  });

  it('audioBitrateBps clamps to max 512 Kbps', () => {
    const config = useExportConfig();
    config.audioBitrateKbps.value = 1000;
    expect(config.audioBitrateBps.value).toBe(512_000);
  });

  it('audioBitrateBps returns default for non-finite values', () => {
    const config = useExportConfig();
    config.audioBitrateKbps.value = NaN;
    expect(config.audioBitrateBps.value).toBe(128_000);
  });

  it('normalizedExportWidth rounds to even number', () => {
    const config = useExportConfig();
    config.exportWidth.value = 1921;
    expect(config.normalizedExportWidth.value).toBe(1922);
  });

  it('normalizedExportWidth returns 1920 for invalid value', () => {
    const config = useExportConfig();
    config.exportWidth.value = 0;
    expect(config.normalizedExportWidth.value).toBe(1920);
  });

  it('normalizedExportWidth returns 1920 for negative value', () => {
    const config = useExportConfig();
    config.exportWidth.value = -100;
    expect(config.normalizedExportWidth.value).toBe(1920);
  });

  it('normalizedExportHeight rounds to even number', () => {
    const config = useExportConfig();
    config.exportHeight.value = 1081;
    expect(config.normalizedExportHeight.value).toBe(1082);
  });

  it('normalizedExportHeight returns 1080 for invalid value', () => {
    const config = useExportConfig();
    config.exportHeight.value = 0;
    expect(config.normalizedExportHeight.value).toBe(1080);
  });

  it('normalizedExportFps clamps to min 1', () => {
    const config = useExportConfig();
    config.exportFps.value = 0;
    expect(config.normalizedExportFps.value).toBe(30);
  });

  it('normalizedExportFps clamps to max 240', () => {
    const config = useExportConfig();
    config.exportFps.value = 300;
    expect(config.normalizedExportFps.value).toBe(240);
  });

  it('normalizedExportFps returns 30 for non-finite values', () => {
    const config = useExportConfig();
    config.exportFps.value = NaN;
    expect(config.normalizedExportFps.value).toBe(30);
  });

  it('returns all expected properties', () => {
    const config = useExportConfig();
    expect(config.exportType).toBeDefined();
    expect(config.outputFormat).toBeDefined();
    expect(config.videoCodec).toBeDefined();
    expect(config.bitrateMbps).toBeDefined();
    expect(config.excludeAudio).toBeDefined();
    expect(config.audioCodec).toBeDefined();
    expect(config.audioBitrateKbps).toBeDefined();
    expect(config.audioChannels).toBeDefined();
    expect(config.audioSampleRate).toBeDefined();
    expect(config.exportWidth).toBeDefined();
    expect(config.exportHeight).toBeDefined();
    expect(config.exportFps).toBeDefined();
    expect(config.resolutionFormat).toBeDefined();
    expect(config.orientation).toBeDefined();
    expect(config.aspectRatio).toBeDefined();
    expect(config.isCustomResolution).toBeDefined();
    expect(config.bitrateMode).toBeDefined();
    expect(config.keyframeIntervalSec).toBeDefined();
    expect(config.exportAlpha).toBeDefined();
    expect(config.fastStart).toBeDefined();
    expect(config.includeMetadata).toBeDefined();
    expect(config.metadataTitle).toBeDefined();
    expect(config.metadataDescription).toBeDefined();
    expect(config.metadataAuthor).toBeDefined();
    expect(config.metadataTags).toBeDefined();
    expect(config.matchTimeline).toBeDefined();
    expect(config.customWidth).toBeDefined();
    expect(config.customHeight).toBeDefined();
    expect(config.customFps).toBeDefined();
    expect(config.customAudioSampleRate).toBeDefined();
    expect(config.ext).toBeDefined();
    expect(config.bitrateBps).toBeDefined();
    expect(config.audioBitrateBps).toBeDefined();
    expect(config.normalizedExportWidth).toBeDefined();
    expect(config.normalizedExportHeight).toBeDefined();
    expect(config.normalizedExportFps).toBeDefined();
  });
});
